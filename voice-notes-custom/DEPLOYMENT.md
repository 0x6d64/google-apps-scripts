# Deployment Guide

## Files
- `Config.gs` — Configuration management
- `Utils.gs` — Shared helpers
- `Calendar.gs` — Voice note parsing + calendar event creation
- `Sheet.gs` — Webhook validation + sheet logging
- `Router.gs` — HTTP entry points

## Setup

1. In Apps Script editor, delete any existing files from old project.
2. Create new files with the names above, paste contents.
3. Run `setup()` from the function dropdown:
   - Generates `SHARED_SECRET`
   - Logs the secret (copy it now)
   - Initializes defaults for `SPREADSHEET_NAME`, `SHEET_NAME`, `TIMEZONE`

4. Deploy as web app (Deploy > New deployment > Web app)
   - Execute as: your account
   - Who has access: Anyone

5. Copy the deployment URL.

## Usage

### Calendar (Pebble watch)
Send GET request:
```
https://your-deployment-url/exec?secret=YOUR_SECRET&text=status%20fixed%20the%20bug
```

Or POST JSON:
```json
{
  "secret": "YOUR_SECRET",
  "text": "status fixed the bug"
}
```

### Sheet (direct webhook)
Send POST JSON:
```json
{
  "token": "YOUR_SECRET",
  "text": "Meeting notes",
  "type": "note"
}
```

## Behavior

- **Calendar events**: Parses natural language (in 30 minutes, tomorrow at 3pm, noon, etc.)
- **Status events**: Prefix with "status" → creates calendar event 5 min ago, 1 min duration, marked free, red. Also appends to sheet.
- **Direct sheet entries**: POST with `token` field → adds row with timestamp (UTC), text, type
- Single `SHARED_SECRET` protects both endpoints

## Response

All endpoints return JSON:
```json
{"ok": true}
```

or

```json
{"ok": false, "error": "description"}
```
