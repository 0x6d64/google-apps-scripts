# Implementation Plan v2: Updated Status (Items 1, 2, 4, 10 Complete)

## How to adapt and extend

- never use the concept of sprint, instead use "iteration" as a concept
- do not use time estimates, instead estimate the effort as S, M, L, XL 
  (tshirt sizes)
- do not use the terms "new" if items get implemented or added, instead just 
  add them or mark them as done

## Overview

This document tracks completion of planned features. Items 1, 2, 4, 10 have been implemented.

Current implementation status:

- ✅ Items 1-5 (earlier sprint): Button layout, collapse icon, mobile cards hide, fractional days, 3-window velocity
- ✅ Item 6: 3-day range pill
- ✅ Item 7: Graph smoothing (skeleton)
- ✅ Items 1, 2, 4, 10

---

## Completed Items (This Sprint)

### 1. **Visual Fix: Folding Button Cursor Blinking** ✅

**Status:** DONE

**File:** Styles.html

**Change:** Added `user-select: none;` to `.danger-zone-summary`

```css
.danger-zone-summary {
  cursor: pointer;
  font-size: 14px;
  color: var(--danger);
  display: flex;
  justify-content: space-between;
  align-items: center;
  list-style: none;
  user-select: none;  /* ← Prevents text selection cursor */
}
```

**Impact:** Eliminates blinking text cursor when clicking danger zone header.

---

### 2. **Danger Zone: Start Folded (Not Expanded by Default)** ✅

**Status:** DONE

**File:** Index.html

**Change:** Removed `open` attribute from `<details>` tag

**Before:**

```html
<details class="danger-zone-details" open>
```

**After:**

```html
<details class="danger-zone-details">
```

**Impact:** Danger zone now starts collapsed. User must click to expand. Arrow rotation works correctly (was already in place).

---

### 4. **Relative Age Auto-Update ("13 min ago" → "14 min ago")** ✅

**Status:** DONE

**Files:** JavaScript.html

**Changes:**

#### 4a. Store snapshot timestamp globally

```javascript
let lastSnapshotTime = null;

function updateKPIsAndStaleness() {
  // ... existing code ...
  const lastDate = new Date(latest[0]);
  if (!isNaN(lastDate.getTime())) {
    lastSnapshotTime = lastDate.getTime();  // ← Store timestamp
    updateStalenessDisplay();
  }
}
```

#### 4b. Refactored display updater

```javascript
function updateStalenessDisplay() {
  if (!lastSnapshotTime) return;

  const diffMins = Math.floor((Date.now() - lastSnapshotTime) / 60000);
  const timeAgoStr = formatTimeAgo(diffMins);
  const tzAbbr = getLocalTimezoneLabel();
  const lastDate = new Date(lastSnapshotTime);

  setElemText('lastUpdatedSubtext',
    'Last snapshot: ' + lastDate.toLocaleString() + ' ' + tzAbbr + ' (' + timeAgoStr + ')');
}

function formatTimeAgo(minutes) {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' min ago';
  return Math.floor(minutes / 60) + ' hr ago';
}
```

#### 4c. Added 10-second timer in init

```javascript
function setupStalenessUpdateTimer() {
  stalenessUpdateTimer = setInterval(() => {
    if (lastSnapshotTime) {
      updateStalenessDisplay();
    }
  }, 10 * 1000); // Update every 10 seconds
}

function init() {
  // ... existing code ...
  setupStalenessUpdateTimer();  // ← Called from init
}
```

**Behavior:**

- Page load: "Last snapshot: ... (Just now)"
- Every 10 seconds: "1 min ago" → "2 min ago" → ... increments automatically
- No API calls, no fetching
- When user clicks "Sync Now" or auto-refresh triggers (future): `updateKPIsAndStaleness()` updates both timestamp and display immediately

**Impact:** Dashboard staleness always current within 10-second window. Improves perceived freshness without backend load.

---

### 10. **Button: Open Google Tasks List** ✅

**Status:** DONE

**File:** Index.html

**Change:** Added link button in `.header-actions`

```html
<a href="https://calendar.google.com/calendar/u/0/r/tasks" target="_blank" 
   class="btn btn-secondary" title="Open Google Tasks in Google Calendar">
  <span class="btn-icon">✓</span> Open Tasks
</a>
```

**Location:** In header toolbar, between "View Sheet" and "Reload Data"

**Behavior:**

- Clicks open Google Calendar Tasks view in new tab
- No RPC call, pure hyperlink
- Mobile-friendly: button stacks/wraps like others

**Impact:** One-click access to Google Tasks from dashboard.

---

## Remaining Planned Items

The following implementation items are planned from the requirements document.

| #    | Item                                             | Files                       | Effort | Status  | Implementation notes                                         |
| ---- | ------------------------------------------------ | --------------------------- | ------ | ------- | ------------------------------------------------------------ |
| 3    | Separate snapshot and sheet-fetch ages           | Index.html, JavaScript.html | M      | ⏳ Ready | Track the two timestamps independently and update both from the same client-side timer |
| 5    | Action button terminology and external-link icon | Index.html, JavaScript.html | S      | ⏳ Ready | Rename actions consistently and change the Google Tasks external-link icon to 🔗 |
| 6    | Reduced KPI card height                          | Styles.html                 | S      | ⏳ Ready | Reduce vertical padding/spacing without removing KPI information |
| 7    | Danger Zone action ordering                      | Index.html                  | S      | ⏳ Ready | Arrange actions from highest impact/gravity to lowest        |
| 8    | Configurable sheet-data auto-fetch               | Index.html, JavaScript.html | M      | ⏳ Ready | Add a configurable interval and toggle; suspend polling while tab is unfocused |
| 9    | 90-degree Danger Zone arrow rotation             | Styles.html, Index.html     | S      | ⏳ Ready | Make collapsed state point right and expanded state point down |
| 10   | Graph downsampling / smoothing                   | JavaScript.html             | M      | ⏳ Ready | Reduce rendered points for long ranges while preserving trend visibility |
| 11   | 6-month future task filter                       | Code.js, JavaScript.html    | S      | ⏳ Ready | Exclude tasks due more than 6 months ahead and explain the filtering in the UI |
| 12   | Rolling average line                             | JavaScript.html             | L      | ⏸️ Hold  | Keep on hold until the chart UX has a clear window/series/toggle definition |

### Implementation 3 — Separate snapshot and sheet-fetch ages

**Goal:** Distinguish when the latest task snapshot was created from when the
dashboard last fetched historical data from the sheet.

**Implementation steps:**

1. Add separate client-side state for:
   - latest snapshot timestamp
   - latest sheet-fetch timestamp
2. Set the sheet-fetch timestamp whenever `getDashboardData()` returns
   successfully, including initial load, manual fetch, and refreshes after
   maintenance operations.
3. Continue deriving the snapshot timestamp from the newest returned metric
   row.
4. Render both timestamps and their relative ages in the header area.
5. Refactor the existing staleness timer so one timer loop updates both relative
   age displays.
6. Keep the timer client-side only; it must not generate RPC/API requests.
7. Update both displays immediately after a successful data fetch rather than
   waiting for the next timer tick.

**Acceptance checks:**

- A sheet fetch updates the sheet-fetch age but does not change the snapshot
  timestamp unless the returned data contains a newer snapshot.
- A newly ingested snapshot updates the snapshot age after the new data is
  fetched.
- Both relative ages continue to advance while the page remains open.
- No additional backend request is generated by the age timer.

### Implementation 5 — Action button terminology and external-link icon

**Implementation steps:**

1. Rename `Reload Data` to `Fetch Data From Sheets`.
2. Rename `Sync Now` to `Ingest From Tasks`.
3. Rename `Open Tasks` to `Launch Google Tasks`.
4. Change the external-link icon on the Google Tasks action to `🔗`.
5. Keep the existing button handlers and backend function names unless a
   rename is necessary for correctness.
6. Update tooltips/descriptions so they match the new labels and continue to
   explain the difference between sheet fetch and task ingestion.

**Acceptance checks:**

- Visible labels match the requirements exactly.
- The Google Tasks action still opens the external Google Tasks page.
- The sheet-fetch action never invokes the Tasks API.
- The task-ingest action still performs a real task ingestion.

### Implementation 6 — Reduced KPI card height

**Implementation steps:**

1. Reduce vertical padding on `.card`.
2. Reduce unnecessary vertical spacing between the KPI label, value, and
   supporting text.
3. Preserve the existing typography hierarchy and all four KPI values.
4. Verify that the reduced height does not introduce clipping or wrapping
   problems on mobile/desktop layouts.

**Acceptance checks:**

- All KPI content remains visible.
- The cards are visibly shorter than the current implementation.
- The four-card desktop layout remains intact.
- The mobile layout remains compatible with the existing hidden-card behavior.

### Implementation 7 — Danger Zone action ordering

**Implementation steps:**

1. Reorder the three existing Danger Zone actions by impact/gravity.
2. Treat permanent deletion of all completed tasks as the highest-impact
   action.
3. Place selective deletion of old completed tasks below the full purge.
4. Place historical data pruning as the lowest-impact maintenance action.
5. Preserve each action's existing confirmation and backend behavior.

**Acceptance checks:**

- The three actions appear in a clearly descending impact order.
- The destructive full purge remains visually distinguishable.
- No handler/backend behavior changes as a result of the reorder.

### Implementation 8 — Configurable sheet-data auto-fetch

**Goal:** Periodically refresh the dashboard from the Google Sheet without
calling the Google Tasks API.

**Implementation steps:**

1. Add an auto-fetch toggle to the dashboard controls.
2. Add a configurable interval setting with a safe default.
3. Use the existing `getDashboardData()` RPC for background fetches.
4. Ensure background fetches only read sheet data and never call
   `ingestTaskMetrics()`, `syncNow()`, or the Tasks API.
5. Use the Page Visibility API to pause polling while the tab is not visible.
6. Resume polling when the tab becomes visible again.
7. Reset/restart the interval after a successful fetch so the next fetch is
   measured from the latest completed fetch.
8. Reuse the existing loading/error notification mechanisms, while avoiding
   disruptive notifications for normal background refreshes.
9. Keep the feature disabled by default unless the requirements are explicitly
   changed to enable it by default.
10. Choose a default interval that bounds the sheet-read request volume and
    record that daily request volume in the implementation documentation.

**Acceptance checks:**

- With auto-fetch disabled, no periodic sheet requests occur.
- With auto-fetch enabled and the tab focused, requests occur at the selected
  interval.
- With the tab unfocused, polling stops.
- Returning to the tab resumes polling without invoking the Tasks API.
- Manual actions continue to work while auto-fetch is enabled.
- The latest sheet-fetch age is updated after every successful background fetch.

### Implementation 9 — 90-degree Danger Zone arrow rotation

**Implementation steps:**

1. Represent the collapsed arrow as pointing right (`→`).
2. Represent the expanded arrow as pointing down (`↓`).
3. Change the CSS rotation from 180 degrees to 90 degrees.
4. Update the markup/icon if required so the starting glyph supports the
   intended orientation cleanly.
5. Preserve the existing transition and collapsed-by-default behavior.

**Acceptance checks:**

- Collapsed: arrow points right.
- Expanded: arrow points down.
- Transition is visually smooth.
- No text-selection cursor is introduced on the summary.

### Implementation 10 — Graph downsampling / smoothing

**Implementation steps:**

1. Keep the underlying `rawData` unchanged.
2. Apply downsampling only to the data passed to the chart renderer.
3. Enable downsampling for long date ranges, especially 14 days and above.
4. Use a deterministic bin/aggregation approach that preserves the overall
   trend and does not alter KPI values.
5. Preserve the semantic split between On-Time Open, Overdue, Completed, and
   Overdue Severity.
6. Ensure date-range changes and series toggles operate correctly on the
   downsampled result.
7. Keep short ranges sufficiently detailed to avoid unnecessary point
   reduction.

**Acceptance checks:**

- KPI values remain unchanged by downsampling.
- Long ranges render with fewer chart points.
- Short ranges retain their existing visual detail.
- Stacking and the dual-axis severity overlay remain correct.
- Interactive range and series controls continue to work.

### Implementation 11 — 6-month future task filter

**Implementation steps:**

1. Define a cutoff at the snapshot time plus 6 months.
2. During task ingestion, exclude open tasks whose due date is beyond that
   cutoff from the `open` and `overdue` metric calculations.
3. Keep tasks without a due date included in the open count.
4. Keep the existing overdue calculation unchanged for tasks whose due date
   is within the supported window.
5. Add a small dashboard note explaining that far-future tasks are excluded
   from the open-task metric.
6. Ensure the displayed metric decomposition remains internally consistent.

**Acceptance checks:**

- An open task due more than 6 months in the future is excluded from `open`.
- A task due within 6 months is counted normally.
- Tasks without due dates are still counted as open.
- Overdue and severity values are unaffected for genuinely overdue tasks.

### Implementation 12 — Rolling average line

**Status:** ON HOLD

No implementation is planned yet. Before implementation, define:

- the moving-average window size or configuration mechanism
- which chart series are eligible
- whether the line uses the original or downsampled data
- how the toggle is presented alongside the existing series controls

## Recommended Implementation Order

1. **Separate snapshot and sheet-fetch ages**
2. **Action button terminology**
3. **Reduced KPI card height**
4. **Danger Zone action ordering**
5. **90-degree Danger Zone arrow rotation**
6. **Configurable sheet-data auto-fetch**
7. **6-month future task filter**
8. **Graph downsampling / smoothing**
9. **Rolling average line** (after UX refinement)

The first five items are small, mostly UI-focused changes and establish the
updated dashboard terminology and status presentation. The auto-fetch feature
should follow because it establishes the sheet-refresh behavior that the two
timestamp displays depend on. The future-task filter and graph downsampling
are independent backend/chart changes and can then be implemented separately.

## Testing Checklist for Planned Items

### Snapshot and sheet-fetch ages

- [ ] Initial load shows both timestamps.
- [ ] Both relative ages update from the same client-side timer.
- [ ] Timer activity does not produce RPC requests.
- [ ] Manual sheet fetch updates the sheet-fetch timestamp.
- [ ] Task ingestion followed by fetch updates the snapshot timestamp.

### Action labels

- [ ] Button text matches the requirements.
- [ ] `Fetch Data From Sheets` does not call the Tasks API.
- [ ] `Ingest From Tasks` does call the Tasks API.
- [ ] `Launch Google Tasks` opens the external Tasks view.
- [ ] The external-link icon is `🔗`.

### KPI cards

- [ ] Cards are visibly shorter.
- [ ] Labels, values, and supporting text remain readable.
- [ ] Desktop and mobile layouts remain usable.

### Danger Zone

- [ ] Actions appear in descending impact/gravity order.
- [ ] Full purge remains the most prominent destructive action.
- [ ] Arrow points right when collapsed.
- [ ] Arrow points down when expanded.
- [ ] Arrow transition is 90 degrees.

### Configurable sheet-data auto-fetch

- [ ] Toggle can enable/disable polling.
- [ ] Interval can be configured.
- [ ] Polling stops while the tab is hidden.
- [ ] Polling resumes when the tab is visible.
- [ ] Background polling never calls the Tasks API.
- [ ] Sheet-fetch age updates after successful polling.
- [ ] Default interval/request volume is documented.

### 6-month future-task filter

- [ ] Tasks due >6 months in the future are excluded.
- [ ] Tasks due within 6 months are included.
- [ ] Tasks without due dates remain included.
- [ ] Overdue and severity calculations remain correct.

### Graph downsampling

- [ ] Long ranges render fewer points.
- [ ] Short ranges retain sufficient detail.
- [ ] Stacking remains correct.
- [ ] Severity remains on the secondary axis.
- [ ] Range and series controls still work.

## File Deliverables for the Next Iteration

1. **Index.html** — updated labels, snapshot/sheet age elements, KPI/control
   presentation, Danger Zone ordering, auto-fetch controls, and UI note for
   the future-task filter.
2. **JavaScript.html** — timestamp handling, auto-fetch lifecycle, background
   refresh behavior, chart downsampling, and UI text updates.
3. **Styles.html** — compact KPI cards and 90-degree Danger Zone arrow behavior.
4. **Code.js** — 6-month future-task filtering during ingestion.

All other completed functionality remains unchanged.