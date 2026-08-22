# Google Sheets Webhook — Apps Script Requirements

## 1. Purpose

Implement a Google Apps Script Web App that exposes an HTTPS webhook for storing text notes in a Google Sheet.

External clients (Bash script, Pebble, or other applications) can submit text entries with a type identifier and authentication token. Each accepted request appends one row to the target spreadsheet.

The system is designed for personal use by a single admin user. Concurrent request volume is expected to be low (≤ 5 simultaneous requests from 1 human + 2–3 automated scripts).

---

## 2. Functional requirements

### 2.1 Webhook endpoint

The Apps Script Web App shall expose an HTTPS `POST` endpoint accepting JSON in this form:

```json
{
  "token": "<secret>",
  "text": "<note text>",
  "type": "<type identifier>",
  "id": "<optional unique request ID>"
}
```

#### Required fields
- `token` (string): authentication secret
- `text` (string): the note content, non-empty, max 1000 characters
- `type` (string): type identifier, non-empty, max 200 characters

#### Optional fields
- `id` (string): unique request identifier for idempotency (see section 2.7)

#### Response format

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

Every request shall be authenticated using a shared secret token.

The token shall:

1. be stored in Google Apps Script Script Properties (not hard-coded)
2. be compared with the token supplied by the client
3. be sufficiently long and random (minimum 256 bits)
4. never appear in source code, logs, or responses

Requests shall be rejected if:

1. token is missing
2. token is invalid (does not match the configured token)
3. request body is malformed JSON
4. any required field is missing

### 2.3 Input validation

The webhook shall validate:

1. request contains valid JSON
2. `token` is a non-empty string
3. `text` is a non-empty string, max 1000 characters
4. `type` is a non-empty string, max 200 characters
5. `id` (if present) is a non-empty string, max 100 characters
6. request body is reasonable in size (recommend max 10 KB total)

Unknown JSON fields shall be ignored.

### 2.4 Timestamp

The Apps Script shall generate the timestamp at the moment it processes the request.

The client cannot override or supply the timestamp.

Timestamps shall be stored in **UTC** as ISO 8601 format (e.g., `2025-08-18T14:32:45Z`).

The Apps Script project and spreadsheet shall use an explicitly configured timezone for logging and debugging (e.g., `Europe/Bucharest` for Romanian time).

### 2.5 Google Sheet storage

#### Sheet identification

The target spreadsheet shall be identified using a **sheet name** (not spreadsheet ID), stored in Script Properties.

The target worksheet shall be identified using a **sheet name**, stored in Script Properties.

#### Auto-creation

If the configured spreadsheet does not exist, the Apps Script shall:

1. create a new spreadsheet with the configured name
2. initialize it with the standard column headers (see below)
3. set the spreadsheet owner to the Google account running the script
4. update the `SPREADSHEET_ID` in Script Properties with the newly created sheet's ID (for caching)

#### Sheet format

The worksheet shall contain exactly these columns in this order:

| Timestamp (UTC) | Text | type |
|---|---|---|

- **Timestamp (UTC)**: ISO 8601 datetime, e.g., `2025-08-18T14:32:45Z`
- **Text**: the note content as received
- **type**: the type identifier as received

The workbook shall also contain a _metadata sheet for storing ids (used for idempotency checks).

#### Writing rows

Each accepted webhook request shall append exactly one row.

The Apps Script shall not overwrite existing rows.

The Apps Script shall use `LockService.getScriptLock()` around the critical section that writes to the spreadsheet to prevent race conditions during concurrent requests.

The lock shall not be held while performing unrelated work (e.g., validation, logging).

### 2.6 Idempotency (optional)

If the client supplies an `id` field (unique request identifier):

1. the Apps Script shall store this ID in a hidden helper sheet called `_metadata`
2. if the same `id` is received again, the Apps Script shall return success without creating a duplicate row
3. the implementation should use `LockService` to avoid race conditions during ID checking

Idempotency is **optional**. If the client does not supply an `id`, each request creates a new row (idempotency is not guaranteed).

### 2.7 type field

`type` is a required parameter.

The value shall be stored unchanged in the `type` column.

Examples: `pebble`, `desktop`, `terminal`, `phone`, `mobile`, `web`.

The implementation shall not hard-code any particular type value.

### 2.8 Error handling

#### Malformed requests and validation failures

The script shall validate input and return a descriptive error response (HTTP 400) for:

- missing or invalid token
- missing required fields (`text`, `type`)
- empty or oversized fields
- malformed JSON

Examples of error responses:

```json
{ "ok": false, "error": "missing token" }
{ "ok": false, "error": "text exceeds 1000 characters" }
{ "ok": false, "error": "malformed JSON" }
```

#### Spreadsheet and infrastructure failures

If the spreadsheet cannot be created or accessed:

1. return HTTP 500 with error message
2. log the failure with context (but never expose the token or complete note text)
3. optionally retry (see section 2.9)

Examples:

```json
{ "ok": false, "error": "unable to access spreadsheet" }
{ "ok": false, "error": "Google Sheets API quota exhausted, please try again later" }
```

#### Unexpected exceptions

The top-level request handler shall catch all unexpected exceptions and return a generic HTTP 500 error without exposing stack traces or internal state.

Detailed diagnostic information shall be written to Apps Script logs (not exposed to the client).

### 2.9 Retry logic

If a write to the spreadsheet fails due to transient errors (e.g., quota exhaustion, temporary API unavailability):

1. the Apps Script shall retry up to **2 times** with exponential backoff (1 second, then 3 seconds)
2. if all retries are exhausted, return HTTP 500 with a descriptive error
3. do not retry on authentication failure or validation errors

Logs shall record retry attempts and failures.

### 2.10 Google Sheets API quota

The Google Sheets API allows approximately **500 requests per 100 seconds** per user per project. For a personal script with ≤ 5 concurrent requests, quota exhaustion is unlikely under normal use. If exhausted:

1. Apps Script will return error code 429 (too many requests)
2. the webhook shall catch this and return HTTP 500 with the message `"Google Sheets API quota exhausted, please try again later"`
3. the client can retry after a delay (suggest 60 seconds)

### 2.11 One-time self-bootstrapping (HTTP GET)

The Web App shall support automated, web-based self-bootstrapping when a user first accesses the deployed Web App URL in their browser (HTTP `GET` request):

1. **Initial Access (Unconfigured State)**:
   - If `WEBHOOK_TOKEN` is not yet configured in Script Properties, the `doGet(e)` entry point shall automatically trigger the `setup()` routine.
   - The setup routine shall generate a secure, random `WEBHOOK_TOKEN` (see section 2.2 / 5.2) and write default values for other missing properties (see section 3) into Script Properties.
   - The Web App shall return a clean, user-friendly HTML dashboard containing the newly generated `WEBHOOK_TOKEN` in an easy-to-copy element, along with instructions on next steps (e.g., setting up local environment variables).
   - This page must display a clear warning that the token is stored securely and cannot be recovered or displayed again from this URL.

2. **Subsequent Access (Configured State)**:
   - If a `WEBHOOK_TOKEN` is already configured, any subsequent `GET` requests must be blocked for security.
   - The Web App shall render an "Access Denied" HTML page, informing the user that the webhook is already configured and that the token cannot be displayed or regenerated via the URL.

---

## 3. Configuration requirements

Configuration shall be stored in **Google Apps Script Script Properties** and kept separate from application logic.

Required properties:

| Property           | Example value            | Purpose                                                  |
|--------------------|--------------------------|----------------------------------------------------------|
| `WEBHOOK_TOKEN`    | `<random 256-bit token>` | authentication secret                                    |
| `SPREADSHEET_NAME` | `My Notes`               | name of the Google Sheet (auto-created if missing)       |
| `SHEET_NAME`       | `Notes`                  | name of the worksheet within the spreadsheet             |
| `TIMEZONE`         | `Europe/Bucharest`       | timezone for logging and display (storage is always UTC) |

Fallback behavior if properties are missing:

| Property           | Fallback behavior                              |
|--------------------|------------------------------------------------|
| `WEBHOOK_TOKEN`    | script will not function; admin must configure |
| `SPREADSHEET_NAME` | default to `"Notes"`                           |
| `SHEET_NAME`       | default to `"Notes"`                           |
| `TIMEZONE`         | default to `UTC` (no display formatting)       |

---

## 4. Google Apps Script best practices

### 4.1 Minimal permissions

Request only the Google services required for operation:

- **Sheets API** (to read/write to spreadsheets)
- **Drive API** (to create new spreadsheets if needed)

Do not request Gmail, Calendar, or other unrelated scopes.

### 4.2 Separation of concerns

Organize code into focused functions with single responsibilities:

| Function                                       | Purpose                                        |
|------------------------------------------------|------------------------------------------------|
| `doPost(e)`                                    | HTTP POST entry point                          |
| `doGet(e)`                                     | HTTP GET entry point for self-bootstrapping    |
| `getConfig()`                                  | load Script Properties                         |
| `setup()`                                      | initialize Script Properties & generate token  |
| `validateRequest(body, config)`                | validate JSON and required fields              |
| `appendEntry(sheet, row)`                      | append row to worksheet under a script lock    |
| `getOrCreateSpreadsheet(name)`                 | find or auto-create Google Spreadsheet          |
| `getOrCreateSheet(spreadsheet, sheetName)`     | find or auto-create worksheet with standard headers |
| `generateRandomToken()`                        | generate cryptographically secure random token |

Keep functions small and testable.

### 4.3 Logging strategy

Use Apps Script Logger for operational diagnostics. Log entries shall record:

- request accepted / rejected
- validation failure reason (e.g., "empty text field")
- type identifier (safe to log)
- retry attempts
- spreadsheet write success / failure
- configuration errors

**Never log:**

- webhook token
- complete note text (may log first 50 characters for debugging if needed)
- stack traces to the client

Example:

```javascript
Logger.log(`Request accepted: type=${type}, text_length=${text.length}`);
Logger.log(`Validation failed: ${reason}`);
Logger.log(`Retry attempt 1/2 after transient error`);
```

### 4.4 Concurrency protection

For the critical section that appends to the spreadsheet:

1. acquire `LockService.getScriptLock()`
2. perform the append operation
3. release the lock immediately
4. do not hold the lock while validating or logging

Example:

```javascript
const lock = LockService.getScriptLock();
lock.waitLock(5000); // wait up to 5 seconds
try {
  appendEntry(...);
} finally {
  lock.releaseLock();
}
```

### 4.5 Explicit timezone

The Apps Script shall import and use a timezone library (or manually specify timezone using `Utilities.formatDate()`).

Example with Utilities:

```javascript
const dateStr = Utilities.formatDate(
  new Date(),
  'UTC',
  "yyyy-MM-dd'T'HH:mm:ss'Z'"
);
```

For display in the spreadsheet: timestamps are always stored in UTC. The presentation layer (or a separate script) can format these as Romanian time if needed.

### 4.6 Avoid deprecated APIs

Use current Apps Script APIs. Avoid deprecated services like `DocsList` or old SpreadsheetApp methods.

---

## 5. Security requirements

### 5.1 Transport security

The webhook shall only be accessible via the HTTPS Apps Script Web App URL (never plain HTTP).

### 5.2 Token security

- stored in Script Properties only
- generated randomly (256 bits minimum)
- never hard-coded in source
- never logged or exposed in responses
- not rotated (low-security personal setup)

### 5.3 Authentication model

The deployed Web App is publicly callable, but the application enforces token-based authentication:

> Anyone who obtains the webhook URL and valid token can submit entries.

The system relies on secrecy of the token. Treat it like a password.

### 5.4 Input size limits

Enforce reasonable limits to prevent accidental or malicious abuse:

- text: max 1000 characters
- type: max 200 characters
- request body: max 10 KB
- `id` (if used): max 100 characters

### 5.5 Error messages

Do not expose:

- stack traces
- Google Sheets API error codes or details
- configured property names or values
- complete request payloads

Return generic errors to the client; log detailed errors to Apps Script logs for admin debugging.

---

## 6. Deployment requirements

### 6.1 Initial setup

1. **Create the Google Sheet manually** (or let the Apps Script auto-create it):
   - Recommended: create manually to ensure you own it and have the correct name.
   - Sheet name: as configured in `SHEET_NAME` property (defaults to `"Notes"`).

2. **Create the Apps Script project**:
   - Open Google Sheet → "Extensions" → "Apps Script".
   - Or create a standalone project at script.google.com.

3. **Deploy as Web App**:
   - In Apps Script editor, click "Deploy" → "New deployment".
   - Type: "Web app".
   - Execute as: "Me" (your Google account).
   - Who has access: "Anyone".
   - Click "Deploy", authorize Google services (Sheets and Drive), and **copy the Web App URL** (the deployment URL).

4. **Self-Bootstrap Setup**:
   - Open your browser and navigate to the copied Web App URL (HTTP `GET` request).
   - The Web App will automatically run the setup routine to initialize Script Properties with default settings and generate a secure `WEBHOOK_TOKEN`.
   - **Copy the generated token now.** For security reasons, it is stored securely in your Script Properties and will never be displayed or regenerated from this URL again (subsequent GET requests return "Access Denied").

5. **Configure Custom Script Properties (Optional)**:
   - If you need to change the default spreadsheet name, worksheet name, or timezone from the defaults:
     - In the Apps Script editor, go to "Project Settings" → "Script Properties".
     - Edit `SPREADSHEET_NAME`, `SHEET_NAME`, or `TIMEZONE` as needed.

6. **Test the endpoint**:
   - Use the Python client, Bash client, or `curl` to send a test note using the copied `WEBHOOK_TOKEN`.
   - Verify a new row with the UTC timestamp appears in the spreadsheet.

### 6.2 Redeployment

If you modify the Apps Script code:

1. make changes in the editor
2. click "Deploy" → update existing deployment
3. select the current Web App deployment
4. click "Deploy"
5. test with a fresh webhook request

### 6.3 Manual testing checklist

Testing shall cover:

#### Valid requests (7 tests)

1. valid token, standard text, valid type → row created
2. valid token, text with spaces and punctuation → stored correctly
3. valid token, text with Unicode characters (ă, é, 中文, etc.) → stored correctly
4. valid token, multi-line text (newlines) → stored correctly
5. valid token, text at max length (1000 chars) → accepted
6. valid token, very short text (1 char) → accepted
7. valid token, custom type identifier → stored as-is

#### Invalid requests (9 tests)

1. missing token → reject with error
2. incorrect token → reject with error
3. missing text field → reject with error
4. empty text field → reject with error
5. text exceeds 1000 characters → reject with error
6. missing type field → reject with error
7. empty type field → reject with error
8. malformed JSON → reject with error
9. type exceeds 200 characters → reject with error

#### Operational tests (6 tests)

1. spreadsheet does not exist before first request → auto-create with headers
2. worksheet does not exist before first write → auto-create with headers
3. submit 2–3 sequential requests → each creates exactly one row
4. submit 2–3 near-simultaneous requests (within 1 second) → all rows created without duplication or corruption
5. initial HTTP `GET` request when `WEBHOOK_TOKEN` is unconfigured → triggers automated setup, generates a random token, initializes script properties, and displays the HTML setup complete page with the generated token
6. subsequent HTTP `GET` request when `WEBHOOK_TOKEN` is already configured → returns the HTML "Access Denied" page without displaying or regenerating the token

**Test method**: use `curl`, the browser, or the client tools to submit requests. Verify results by opening the Google Sheet and inspecting rows/properties.

**Expected result for all valid tests**: exactly one new row with UTC timestamp, text, and type.

---

## 7. GitHub storage and deployment flow

### 7.1 Repository structure

see [./python-client-requirements.md](python-client-requirements.md)

### 7.2 Deployment process

Use `clasp` CLI

`clasp` is the official Google Apps Script CLI. Setup:

```bash
# install clasp globally
npm install -g @google/clasp

# clone a project from GitHub
git clone <your-repo>
cd sheetpost

# link clasp to your Apps Script project
clasp clone <scriptId>  # or clasp create
```

Then to deploy:

```bash
# pull latest from Google
clasp pull

# make local changes, commit to GitHub
git add .
git commit -m "update webhook logic"

# push to Google
clasp push

# deploy as Web App
clasp deploy --description "webhook update"
```

### 7.3 Secret management

**IMPORTANT**: never commit `WEBHOOK_TOKEN` or spreadsheet IDs to GitHub.

1. tokens and IDs are stored only in Apps Script Script Properties (in Google's servers)
2. do not add a `.env` file or `secrets.json` to the repository
3. the `../README.md` shall document how to generate and configure the token (via the setup function or Apps Script UI)
4. GitHub does not need to know the token; each deployed instance has its own

---

## Assumptions made for personal single-user setup

- **No user authentication required** for the Web App itself (app-level token auth is sufficient).
- **No audit trail or user attribution** beyond the `type` field.
- **No rate limiting or quota monitoring** beyond Google's API limits; the system is for light personal use.
- **No backup or disaster recovery** beyond Google's built-in backup (Google Sheets data is persistent).
- **Timezone for logging only**: timestamps are always stored in UTC; display formatting is optional.
- **Idempotency is optional**: clients can supply an `id` field for deduplication, but it is not required.
- **Token does not rotate**: this is a personal, low-security setup; token rotation is not needed.
- **Single spreadsheet and worksheet**: the script targets one specific sheet; no multi-sheet or multi-spreadsheet routing.
