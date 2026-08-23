# Google Sheets Webhook: Apps Script Requirements

## 1. Purpose

Implement a Google Apps Script Web App HTTPS webhook for storing text notes in Google Sheets.
The system is for a single user with low concurrent requests (<= 5 simultaneous requests).

## 2. Functional Requirements

### 2.1 Webhook Endpoint

The Apps Script Web App exposes an HTTPS `POST` endpoint accepting JSON:

```json
{
  "token": "<secret>",
  "text": "<note text>",
  "type": "<type identifier>",
  "id": "<optional unique request ID>"
}
```

#### Required Fields
* `token` (string): Authentication secret.
* `text` (string): Note content (non-empty, max 1000 characters).
* `type` (string): Type identifier (non-empty, max 200 characters).

#### Optional Fields
* `id` (string): Unique request identifier for idempotency (max 100 characters).

#### Response Format

Success (HTTP 200):
```json
{
  "ok": true
}
```

Failure (HTTP 400 or 500):
```json
{
  "ok": false,
  "error": "<error description>"
}
```

### 2.2 Authentication

Every request requires authentication via a shared secret token.

The token must:
1. Be stored in Google Apps Script Script Properties.
2. Be compared against the client-supplied token.
3. Be a minimum of 256 random bits.
4. Never appear in source code, logs, or responses.

Reject requests if:
1. Token is missing or invalid.
2. Request body is malformed JSON.
3. Any required field is missing.

### 2.3 Input Validation

The webhook must validate:
1. Request contains valid JSON.
2. `token` is a non-empty string.
3. `text` is a non-empty string, max 1000 characters.
4. `type` is a non-empty string, max 200 characters.
5. `id` (if present) is a non-empty string, max 100 characters.
6. Request body size is under 10 KB.

Ignore unknown JSON fields.

### 2.4 Timestamp

The script generates the timestamp during processing.
Timestamps are stored in UTC in ISO 8601 format (e.g., `2025-08-18T14:32:45Z`).
The script project uses an explicitly configured timezone for logs (e.g., `Europe/Bucharest`).

### 2.5 Google Sheet Storage

#### Sheet Identification
* Target spreadsheet name is stored in Script Properties.
* Target worksheet name is stored in Script Properties.

#### Auto-Creation
If the spreadsheet does not exist, the script:
1. Creates a spreadsheet with the configured name.
2. Initializes it with standard column headers.
3. Sets the spreadsheet owner to the script runner's account.
4. Caches the new spreadsheet ID in `SPREADSHEET_ID` in Script Properties.

#### Sheet Format
The worksheet contains these columns in order:

| Timestamp (UTC) | Text | type |
|---|---|---|

* **Timestamp (UTC)**: ISO 8601 string.
* **Text**: Note content.
* **type**: Type identifier.

A hidden helper worksheet `_metadata` stores IDs for idempotency checks.

#### Writing Rows
Each request appends one row. The script must not overwrite existing rows.
Use `LockService.getScriptLock()` around the write section to prevent race conditions.
Do not hold the lock during validation or logging.

### 2.6 Idempotency

If the client supplies an `id`:
1. Check `id` in `_metadata` worksheet.
2. If ID exists, return success without appending a row.
3. If ID is new, record ID in `_metadata` and append row.
Use `LockService` to handle concurrency during checks.

### 2.7 Type Field

Store the required `type` parameter unchanged in the `type` column.
The implementation must not hard-code allowed types.

### 2.8 Error Handling

#### Request and Validation Failures
Return HTTP 400 for:
* Missing or invalid token.
* Missing or empty required fields.
* Oversized fields or request body.
* Malformed JSON.

Example:
```json
{ "ok": false, "error": "text exceeds 1000 characters" }
```

#### Infrastructure Failures
If the spreadsheet is inaccessible:
1. Return HTTP 500.
2. Log the failure (do not expose token or full note text).

Example:
```json
{ "ok": false, "error": "unable to access spreadsheet" }
```

#### Exceptions
Catch all top-level exceptions and return a generic HTTP 500 error.
Log detailed diagnostics to Apps Script logs instead of exposing them to clients.

### 2.9 Retry Logic

On transient sheet errors (e.g., quota limits), retry up to 2 times with exponential backoff
(1s, then 3s).
Do not retry on authentication or validation failures.
Log retry attempts.

### 2.10 Quota Limits

On Sheets API quota limits (HTTP 429), return HTTP 500 with message:
`"Google Sheets API quota exhausted, please try again later"`.

### 2.11 One-Time Self-Bootstrapping (HTTP GET)

Support browser-based initialization on initial deployment:

1. **Unconfigured State**:
   * If `WEBHOOK_TOKEN` is missing, `doGet(e)` runs the `setup()` routine.
   * `setup()` generates a random token and sets default properties.
   * Return an HTML page with the generated token and instructions.
   * Warn the user that the token is stored securely and cannot be shown again.

2. **Configured State**:
   * If `WEBHOOK_TOKEN` is present, subsequent `GET` requests return "Access Denied".

## 3. Configuration Requirements

Configuration is stored in Script Properties.

| Property | Example Value | Purpose |
|---|---|---|
| `WEBHOOK_TOKEN` | `<random 256-bit>` | Authentication secret |
| `SPREADSHEET_NAME` | `My Notes` | Google Sheet file name |
| `SHEET_NAME` | `Notes` | Worksheet tab name |
| `TIMEZONE` | `Europe/Bucharest` | Timezone for logging |

Fallbacks:
* `WEBHOOK_TOKEN`: Fail if missing.
* `SPREADSHEET_NAME`: Default to `"Notes"`.
* `SHEET_NAME`: Default to `"Notes"`.
* `TIMEZONE`: Default to `UTC`.

## 4. Google Apps Script Best Practices

### 4.1 Minimal Permissions

Only request required scopes:
* **Sheets API** (read/write spreadsheets)
* **Drive API** (create files if missing)

### 4.2 Separation of Concerns

Organize code into single-responsibility functions:

* `doPost(e)`: HTTP POST handler.
* `doGet(e)`: HTTP GET handler (setup/bootstrap).
* `getConfig()`: Load Script Properties.
* `setup()`: Initialize properties and generate token.
* `validateRequest(body, config)`: Validate fields and formats.
* `appendEntry(sheet, row)`: Write row with lock.
* `getOrCreateSpreadsheet(name)`: Locate or create spreadsheet.
* `getOrCreateSheet(ss, name)`: Locate or create worksheet with headers.
* `generateRandomToken()`: Generate 256-bit secure token.

### 4.3 Logging Strategy

Use Apps Script Logger to track requests, failures, and retries.
**Never log the token or complete note text.**

### 4.4 Concurrency Protection

Use `LockService.getScriptLock()` for sheet writes:
```javascript
const lock = LockService.getScriptLock();
lock.waitLock(5000);
try {
  appendEntry(...);
} finally {
  lock.releaseLock();
}
```

### 4.5 Explicit Timezone

Use `Utilities.formatDate()` with explicit timezones for logging.

### 4.6 Avoid Deprecated APIs

Do not use deprecated Apps Script services.

## 5. Security Requirements

### 5.1 Transport Security

Webhook is accessible only over HTTPS.

### 5.2 Token Security

* Store exclusively in Script Properties.
* Generate randomly (minimum 256 bits).
* Never hard-code or log the token.

### 5.3 Authentication Model

The script uses shared-token verification. Anyone with the URL and token can append entries.

### 5.4 Input Size Limits

* Text: Max 1000 characters.
* Type: Max 200 characters.
* ID: Max 100 characters.
* Body: Max 10 KB.

### 5.5 Error Messages

Do not expose stack traces, API error details, property keys, or raw payloads in HTTP responses.

## 6. Deployment Requirements

### 6.1 Initial Setup

1. **Deploy Web App**:
   * Deploy project as "Web app".
   * Execute as "Me", Access: "Anyone".
2. **Self-Bootstrap**:
   * Navigate to Web App URL in browser.
   * Copy the generated `WEBHOOK_TOKEN`.
3. **Configure Options**: Optionally set custom Script Properties in Project Settings.
4. **Test**: Send a test entry and verify the row in Sheets.

### 6.2 Redeployment

To update code, update the existing deployment version.

### 6.3 Manual Testing Checklist

#### Valid Requests
* Simple/formatted/Unicode/multiline text.
* Maximum length text (1000 characters) and minimum length text (1 character).
* Custom type identifiers.

#### Invalid Requests
* Missing, invalid, or empty tokens.
* Missing, empty, or oversized text/type fields.
* Malformed JSON payloads.

#### Operational Tests
* Auto-creation of missing spreadsheets/worksheets.
* Concurrency handling for simultaneous writes.
* Initial and subsequent browser GET requests.

## 7. GitHub Storage and Deployment Flow

### 7.1 Repository Structure

See [python-client-requirements.md](python-client-requirements.md).

### 7.2 Deployment Process

Manage deployments using the `clasp` CLI:

```bash
npm install -g @google/clasp
clasp clone <scriptId>
clasp pull
clasp push
clasp deploy --description "webhook update"
```

### 7.3 Secret Management

Do not commit `WEBHOOK_TOKEN` or spreadsheet IDs to GitHub.
