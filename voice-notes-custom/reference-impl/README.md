# Voice-note parser with status checkin

This variant of the Apps Script code has the following features on top of the
base version:

## Status keyword

**Purpose:** creating quick "what did I do at this time" events in the calendar
for later review.

**How to create:** Start your message with the keyword "status".

**Format of status events:** Events start at `now - 5 minutes` with a duration
of 1 minute. This is so that they don't get show on the pebble timeline as
upcoming or currently running events.

Status events get a prefix that is configurable (📍 followed by space by
default). This enables the user to later use a search to get a list of all
status messages in a specific period. Status events get a custom color (can be
configured or set to `null` for no special color) and are marked as
"Free" (instead of "Busy").

**Parsing details:** Any punctuation immediately after status gets dropped, so
`status:`, `status.` and `Status?` are all valid triggers.
