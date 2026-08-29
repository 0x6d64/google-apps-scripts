# Implementation Plan: Unified Calendar + Sheet Bridge

## Overview

Merge voice-note calendar bridge (Pebble watch) and sheetpost webhook into
single Apps Script project. Single shared secret protects both endpoints.

## Files

### Config.gs

- Read `SHARED_SECRET`, `SPREADSHEET_NAME`, `SHEET_NAME`, `TIMEZONE` from script
  properties
- `getConfig()` returns merged config object
- `setup()` generates `SHARED_SECRET` once (replaces separate WEBHOOK_TOKEN and
  CALENDAR_SECRET)

### Utils.gs

- No changes. Reuse existing helpers: `jsonResponse()`, `nowUtcIso()`,
  `generateRandomToken()`, `withRetry()`, `isQuotaError()`,
  `quotaAwareMessage()`

### Calendar.gs

- Move all calendar parsing logic: `parseWhen()`, `parseDay()`, `parseTime()`,
  `cleanTitle()`, `makeStatusTitle()`, `fmt()`
- New function `handleCalendarEvent(secret, text)` → validates secret, parses
  event, creates Calendar entry. If `isStatus === true`, also append to sheet
  (timestamp, title, "status"). Returns `{ok, error, when, title}`

### Sheet.gs

- Move all sheet logic: `validateRequest()`, `getOrCreateSpreadsheet()`,
  `getOrCreateSheet()`, `removeBlankDefaultSheet()`, `appendEntry()`
- New function `handleSheetWebhook(token, text, type)` → validates token against
  shared secret, checks text/type lengths, appends row. Returns `{ok, error}`

### Router.gs (new)

- `doGet(e)` → call `Calendar.handleCalendarEvent()`, return JSON response
- `doPost(e)` → parse body, dispatch:
    - `body.token` present → `Sheet.handleSheetWebhook()`
    - else (body.secret present) → `Calendar.handleCalendarEvent()`
    - Return JSON response

## Constants

- Move calendar event duration config to Config.gs or top of Calendar.gs:
  `DEFAULT_EVENT_MINUTES`, `STATUS_EVENT_MINUTES`, `STATUS_EVENT_COLOR`,
  `STATUS_EVENT_PREFIX`

## Auth

- Single `SHARED_SECRET` in script properties
- Calendar handlers validate `secret` field
- Sheet handlers validate `token` field
- Both against same `getConfig().sharedSecret`

## Status event flow

1. Watch sends "status fixed bug" via GET
2. Calendar handler parses, detects status prefix
3. Creates Calendar event (5 min ago, 1 min duration, transparent, red)
4. Calls sheet append: (timestamp, "Fixed bug", "status")
5. Returns `{ok: true, when, title}`

## Deployment

1. Run `setup()` manually from editor → generates `SHARED_SECRET`, logs it
2. Deploy web app
3. Watch app hits GET with `?secret=...&text=...`
4. CLI hits POST with `{token: ..., text: ..., type: ...}`
