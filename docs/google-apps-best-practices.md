Sure, here is a Markdown document summarizing the best practices for writing Google Apps Script based on the content
from `webhook-requirements.md`:

# Google Apps Script Best Practices

## Minimal Permissions

- **Request Only Necessary Services**: Only request Google services required for operation (e.g., Sheets API and Drive
  API), not Gmail or Calendar.
- **Do Not Request Unnecessary Scopes**: Avoid requesting unnecessary permissions to minimize potential security risks.

## Separation of Concerns

- **Organize Code into Functions**: Break down the code into focused functions with a single responsibility.
- **Keep Functions Small and Testable**: Each function should perform a specific task, making it easier to test and
  debug.

## Logging Strategy

- **Use Apps Script Logger**: Log important information for operational diagnostics.
- **Log Relevant Details**: Record details like request accepted/rejected status, validation failure reasons, type
  identifiers, retry attempts, spreadsheet write success/failure, and configuration errors.
- **Avoid Logging Sensitive Data**: Never log the webhook token or complete note text (may log the first 50 characters
  for debugging if needed).
- **Log to Apps Script Logs**: Detailed diagnostic information should be written to Apps Script logs instead of exposing
  them to the client.

## Concurrency Protection

- **Use LockService**: For critical sections that modify shared resources, use `LockService.getScriptLock()` to prevent
  race conditions.
- **Acquire and Release Locks Properly**: Acquire the lock before performing the operation and release it immediately
  afterward without holding it while validating or logging.

## Explicit Timezone

- **Use Utilities.formatDate ()**: Import and use a timezone library (or manually specify timezone using
  `Utilities.formatDate()`).

## Avoid Deprecated APIs

- **Use Current APIs**: Use current Apps Script APIs instead of deprecated services like `DocsList` or old
  SpreadsheetApp methods.

## Token Security

- **Store in Script Properties**: Store the webhook token in Script Properties only.
- **Generate Randomly and Securely**: Generate it randomly (256 bits minimum).
- **Never Hard-code or Expose Tokens**: Never hard-code tokens in source code, logs, or responses.
- **Do Not Rotate for Low-Security Setup**: For a personal, low-security setup, token rotation is not needed.

## Authentication Model

- **Publicly Callable Web App**: The deployed Web App is publicly callable but enforces token-based authentication to
  ensure only authorized users can submit entries.
- **Publicly Callable Web App**: The deployed Web App is publicly callable but enforces token-based authentication to
  ensure only authorized users can submit entries.

## Input Size Limits

- **Enforce Reasonable Limits**: Enforce reasonable limits on input fields such as text length and request body size to
  prevent accidental or malicious abuse.
- **Max Lengths**:
    - Text: Max 1000 characters
    - Type: Max 200 characters
    - Request Body: Max 10 KB
    - ID (if used): Max 100 characters

## Error Handling

- **Return Generic Errors**: Do not expose stack traces or sensitive information in error messages to the client.
- **Log Detailed Errors**: Log detailed errors to Apps Script logs for admin debugging instead of exposing them to the
  client.
- **Error Response Format**:
  ```json
  { "ok": false, "error": "<error description>" }
  ```

## Security Best Practices

- **Review and Grant Permissions**: When deploying the script, review and grant permission to access Google Sheets and
  Drive as needed.
- **Use Script Properties for Sensitive Data**: Store sensitive information only in Apps Script Script Properties in
  Google's servers.
