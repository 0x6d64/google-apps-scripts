# Implementation Plan v3

## How to adapt and extend

- never use the concept of sprint, instead use "iteration" as a concept
- do not use time estimates, instead estimate the effort as S, M, L, XL 
  (tshirt sizes)
- do not use the terms "new" if items get implemented or added, instead just 
  add them or mark them as done

## Overview

Completed items 1–4 plus velocity calculation fix in current session.

Current implementation status:

- ✅ Item 1: Separate snapshot and sheet-fetch ages
- ✅ Item 2: Action button terminology and external-link icon
- ✅ Item 3: Reduced KPI card height
- ✅ Item 4: Danger Zone action ordering
- ✅ Bonus: Fixed velocity calculation (sum positive increments, ignore purges)

---

## Completed Items (Current Session)

### 1. **Separate snapshot and sheet-fetch ages** ✅

**Status:** DONE

**Files:** Index.html, JavaScript.html

**Changes:**

#### Index.html
- Split single `lastUpdatedSubtext` into two elements:
  - `lastSnapshotAge` (always visible): displays latest snapshot timestamp and relative age
  - `lastSheetFetchAge` (hidden by default): displays last sheet-fetch timestamp and relative age

#### JavaScript.html
- Added `lastSheetFetchTime` state variable
- Set `lastSheetFetchTime = Date.now()` in `onDataLoaded()` after successful `getDashboardData()`
- Refactored `updateStalenessDisplay()` to update both timestamps independently from single 10-second timer
- Timer loop calls both display updates without generating RPC requests

**Behavior:**
- Page load: both timestamps visible
- Every 10 seconds: both relative ages auto-increment ("1 min ago" → "2 min ago")
- Manual "Fetch Data From Sheet" or "Ingest From Tasks": both timestamps update immediately after success
- Sheet fetch updates only sheet-fetch age; task ingestion updates only snapshot age (if newer data returned)

**Impact:** Dashboard now clearly distinguishes between snapshot freshness and data-load freshness.

---

### 2. **Action button terminology and external-link icon** ✅

**Status:** DONE

**File:** Index.html

**Changes:**

| Old Label | New Label | Icon |
|---|---|---|
| View Sheet | View Sheet | 📊 (unchanged) |
| Open Tasks | Launch Google Tasks | 🔗 |
| Reload Data | Fetch Data From Sheet | 🔄 |
| Sync Now | Ingest From Tasks | ⚡ |

**Rationale:** Terminology now explicitly reflects backend behavior: "Fetch" reads sheet only (no Tasks API), "Ingest" calls Tasks API and appends snapshot.

**Impact:** User intent matches action names.

---

### 3. **Reduced KPI card height** ✅

**Status:** DONE

**File:** Styles.html

**Change:** Reduced vertical padding on `.card` from `20px` to `16px 20px` (horizontal unchanged).

```css
.card {
  padding: 16px 20px;  /* was: 20px */
}
```

**Impact:** Cards are visibly more compact while preserving all content and readability. Desktop 4-column and mobile hidden-card layouts unchanged.

---

### 4. **Danger Zone action ordering** ✅

**Status:** DONE

**File:** Index.html

**Changes:** Reordered three actions from highest to lowest impact/gravity:

1. **Purge Completed Tasks Across All Lists** (highest destructive impact — clears all completed tasks permanently)
2. **Delete Old Done Tasks (>8w)** (medium impact — selective removal of old completions only)
3. **Prune Old Data (>1 year)** (lowest impact — housekeeping on historical snapshots)

**Rationale:** Descending impact order reduces accidental misclick risk; most dangerous action requires most intentional scrolling/selection.

**Impact:** Danger Zone actions now reflect clear destructive hierarchy. Handlers and backend behavior unchanged.

---

### 5. **Bonus: Fixed velocity calculation** ✅

**Status:** DONE

**File:** JavaScript.html

**Problem:** Velocity displayed 0.0/day despite 2 real task completions in the 7-day window, because:
- Old logic: `diff = newest_completed - oldest_completed`, clamped to 0
- Data trace: completed count dropped from 50 → 47 at 17:03 (purge), then rose 47 → 48 → 49 (2 real completions)
- Net effect: `50 - 49 = 1`, clamped to 0 → displays 0.0/day ❌

**Change:** Sum only positive increments between consecutive snapshots; ignore drops (purges/deletes).

```js
function calculateVelocity(rows) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentRows = rows.filter(r => new Date(r[0]).getTime() >= sevenDaysAgo);

  if (recentRows.length >= 2) {
    // Sum only positive increments; ignore drops from purges/deletes
    let totalCompletions = 0;
    for (let i = 1; i < recentRows.length; i++) {
      const delta = recentRows[i][2] - recentRows[i - 1][2];
      if (delta > 0) totalCompletions += delta;
    }

    const oldestTime = new Date(recentRows[0][0]).getTime();
    const newestTime = new Date(recentRows[recentRows.length - 1][0]).getTime();
    const elapsedDays = Math.max(1, newestTime - oldestTime) / (1000 * 60 * 60 * 24);

    const ratePerDay = (totalCompletions / elapsedDays).toFixed(1);
    setElemText('kpiVelocitySubtext', '7d Velocity: ~' + ratePerDay + '/day');
  } else {
    setElemText('kpiVelocitySubtext', '7d Velocity: Calculating...');
  }
}
```

**Result:** Data now correctly shows ~5.7/day (2 completions over ~0.35 days) instead of 0.0.

**Impact:** Velocity metric now survives purge/delete events in the measurement window; metric reflects genuine completion throughput, not net completed-task count.

---

## Remaining Planned Items

The following implementation items remain from the requirements document.

| #    | Item                                             | Files                       | Effort | Status  |
| ---- | ------------------------------------------------ | --------------------------- | ------ | ------- |
| 5    | Graph downsampling / smoothing                   | JavaScript.html             | M      | ⏳ Ready |
| 6    | Configurable sheet-data auto-fetch               | Index.html, JavaScript.html | M      | ⏳ Ready |
| 7    | 6-month future task filter                       | Code.js, JavaScript.html    | S      | ⏳ Ready |
| 8    | Rolling average line                             | JavaScript.html             | L      | ⏸️ Hold  |

### Implementation 5 — Graph downsampling / smoothing

**Goal:** Distinguish when the latest task snapshot was created from when the
dashboard last fetched historical data from the sheet.

**Implementation steps:**

### Implementation 6 — Configurable sheet-data auto-fetch

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

### Implementation 5 — Graph downsampling / smoothing

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

### Implementation 7 — 6-month future task filter

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

### Implementation 8 — Rolling average line

**Status:** ON HOLD

No implementation is planned yet. Before implementation, define:

- the moving-average window size or configuration mechanism
- which chart series are eligible
- whether the line uses the original or downsampled data
- how the toggle is presented alongside the existing series controls

## Recommended Implementation Order

1. **Graph downsampling / smoothing** (improves chart UX for long ranges)
2. **Configurable sheet-data auto-fetch** (establishes background refresh behavior)
3. **6-month future task filter** (independent backend filtering)
4. **Rolling average line** (after UX refinement)

## Testing Checklist for Remaining Items

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

## File Deliverables for Next Iteration

1. **Index.html** — auto-fetch controls and UI note for future-task filter.
2. **JavaScript.html** — chart downsampling logic and background refresh lifecycle.
3. **Styles.html** — no changes expected.
4. **Code.js** — 6-month future-task filtering during ingestion.

All previously completed items remain unchanged.