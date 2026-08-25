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
| 8    | Rolling average line                             | JavaScript.html             | M      | ✅ Ready |
| 9    | Danger Zone: hourly downsample of last-year data | Index.html, JavaScript.html, Code.js | M | ✅ Ready |

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

**Status:** DESIGN PHASE (research complete, ready for implementation design)

**Goal:** Add a toggle button that overlays rolling average lines on top of
the existing stacked area chart. Rolling averages should be visually distinct
and window size should adapt to the selected date range.

**UI approach:**

1. Add a toggle pill or checkbox in the Series control group (alongside
   On-Time Open, Overdue, Completed, Severity toggles).
2. Label: "Rolling Average" or "Trend Line".
3. When toggled ON: overlay rolling average for every currently visible series.
4. When toggled OFF: hide all rolling average lines.
5. Visual distinction: dotted line, reduced opacity (e.g., 0.6 alpha), or
   both. Recommend: **dotted + 60% opacity** to distinguish from raw data
   while maintaining readability.
6. Reuse the same color scheme as the underlying series (blue for On-Time
   Open, red for Overdue, green for Completed, purple for Severity).

**Adaptive window sizing:**

Rolling average window should scale with the selected date range. Research
on best practices:

**Industry standard: Heuristic binning**

Most charting libraries and analytics platforms use this rule:
- Window size ≈ `ceil(total_points / 50)` to `ceil(total_points / 100)`
- This ensures the smoothed line has sufficient granularity to convey trend
  without over-fitting noise.
- At 50 points/range, window ≈ 1; at 500 points/range, window ≈ 5–10.

**Alternative: Calendar-aware sizing**

- 3-day range: window = 12 snapshots (= 6 hours if snapshots every 30 min) or 3 snapshots if hourly.
- 7-day range: window = 12–24 snapshots (≈ 6–12 hours).
- 14-day range: window = 24–48 snapshots (≈ 12–24 hours).
- 30-day range: window = 48–96 snapshots (≈ 24–48 hours).
- All-range: window = 168 snapshots (≈ 1 week).

**Recommendation: Adaptive grid-based window**

Use a simple bucketing rule that works for any snapshot cadence:

```
windowSize = ceil(dataPoints / 50)  // aim for ~50 buckets in the line
windowSize = Math.max(2, Math.min(windowSize, 168))  // clamp: min 2, max 168 (1 week)
```

Rationale:
- Scales automatically with range selection (3D → 7D → 30D → All).
- Insensitive to snapshot cadence (whether 5-min, 30-min, 1-hour snapshots).
- Max clamping (168) prevents over-smoothing on all-time ranges.
- Min clamping (2) ensures meaningful averaging even on tiny ranges.

**Example:** Your data (25 rows in last 24h):
- Window = ceil(25 / 50) = 1 → clamped to 2 → rolling average over 2 snapshots.
- Smooth but retains noise. Acceptable for short ranges.

- 30-day range (~720 rows if 2/hour):
- Window = ceil(720 / 50) = 15 → rolling average over 15 snapshots.
- Heavy smoothing, trend clearly visible.

**Implementation approach:**

1. Compute window size dynamically in `renderCharts()` based on currently
   displayed data points and selected range.
2. Apply rolling average function to each series (on-time open, overdue,
   completed, severity).
3. Use simple moving average (SMA): `avg[i] = sum(data[i:i+window]) / window`.
   Centered window optional; leading/trailing windows acceptable.
4. Pass averaged data to chart alongside raw data.
5. Render averaged data as dotted, 60% opacity lines on top of stacked areas.
6. Series controls (toggle On-Time Open, etc.) apply to both raw and average
   simultaneously (no separate toggles per series).

**Open questions to resolve before implementation:**

1. **Centered vs. leading/trailing window?**
   - Centered: `avg[i] = mean(data[i - window/2 : i + window/2])` — smooth
     but lags perceived trend by 0 (center-aligned).
   - Trailing: `avg[i] = mean(data[i - window : i])` — lags by window/2,
     standard in time-series.
   - Recommendation: **Trailing** (standard; easier to reason about "momentum
     so far").

2. **How to handle series toggle with rolling average?**
   - When user unchecks "On-Time Open," hide both raw and average lines for
     that series.
   - Single toggle button controls all series together (no per-series
     enable/disable for rolling avg).

3. **Label & placement?**
   - Recommend adding to the Series pill group alongside severity toggle.
   - Label: "Smooth" or "Rolling Avg" or "Trend Line".
   - Placement: after Severity toggle (all four are data toggles, rolling avg
     is a display modifier).

**Acceptance checks:**

- Toggle button appears in Series control group.
- When ON, rolling average lines overlay all visible series with dotted +
  60% opacity appearance.
- When OFF, rolling average lines are hidden.
- Window size adapts to selected date range (3D, 7D, 14D, 30D, All).
- Toggling individual series (e.g., unchecking Severity) hides both raw and
  average lines for that series.
- Rolling average does not affect KPI values (chart only, no backend changes).
- On short ranges (e.g., 3D with few snapshots), rolling avg still renders
  visibly (even if window = 2).
- Performance is acceptable (averaging is O(n), negligible overhead).

### Implementation 9 — Danger Zone: hourly downsample of last-year data

**Status:** READY FOR IMPLEMENTATION

**Goal:** Add a Danger Zone button that downsamples the last 365 days of
snapshot rows to a maximum of 1 entry per hour, permanently reducing sheet
row count for that range.

**Relationship to existing items:** Distinct from item "Prune Old Data
(>1 year)," which targets rows *older* than 1 year and downsamples to 1
entry/day. This new button targets the *last* year and downsamples to a
finer 1 entry/hour resolution.

**Decision: Aggregation approach = Latest**

Keep the last snapshot recorded within each 60-minute window; discard all
others. This preserves real observed values exactly, removes intra-hour
erratic corrections/noise, and avoids manufacturing synthetic numbers that
were never actually observed.

**Decision: Binning strategy = Rolling 60-minute window**

Each snapshot's hour is defined as the 60-minute span ending at that
snapshot's timestamp. For example, a snapshot at `2026-08-25T14:30:15Z` has
window `[13:30:15, 14:30:15]`. The latest snapshot within that window is
kept; all others in the window are discarded.

**Rationale:** This directly implements the stated goal: "remove artifacts
from erratic corrections during the hour" by operating on actual 60-minute
spans from each snapshot, not calendar boundaries. Adaptive to your sync
distribution and independent of clock alignment.

**Implementation approach:**

```
sort all snapshots in the last 365 days by timestamp (ascending)
result = []
for each snapshot S:
  window_start = S.timestamp - 60 minutes
  window_end = S.timestamp
  if no snapshot in result already covers [window_start, window_end]:
    add S to result
  else:
    replace the existing snapshot in that window with S (S is later, so it's the latest)
return result
```

Or equivalently (simpler):

```
sort all snapshots in the last 365 days by timestamp (ascending)
keep = {}  // map: window_end_timestamp → snapshot
for each snapshot S:
  window_end = S.timestamp
  keep[window_end] = S  // always keep the latest per window_end
return values(keep)
```

Note: The second approach assumes one snapshot per unique `timestamp`. If
multiple snapshots share the exact same timestamp, use the second to break
ties or dedup first.

**Implementation steps:**

1. Add a button in the Danger Zone titled "Downsample Last Year (1/hour)" or
   similar, with btn-secondary styling (like other housekeeping actions).
2. Button calls a backend RPC handler (e.g., `downsampleLastYearToHourly()`).
3. Handler identifies all rows with `timestamp >= now - 365 days`.
4. Handler applies the rolling 60-minute binning logic above.
5. Handler deletes all non-survivor rows from the sheet (irreversible).
6. Handler returns success/failure and count of rows deleted.
7. Frontend shows a confirmation dialog before calling (standard for Danger Zone).
8. On success, notify user with row-count feedback (e.g., "Deleted 2847 rows,
   kept 8760").

**Danger Zone placement:** Insert after "Prune Old Data (>1 year)" since
both are permanent data-reduction actions. Order from highest to lowest
destructive impact remains:
1. Purge Completed Tasks Across All Lists
2. Delete Old Done Tasks (>8w)
3. Downsample Last Year (1/hour)  ← NEW
4. Prune Old Data (>1 year)

**Acceptance checks:**

- After running, the last 365 days contain at most 1 row per rolling
  60-minute window.
- Rows older than 365 days are unaffected by this action.
- Latest snapshot in each 60-minute window is retained; all others deleted.
- The action requires the same confirmation-dialog flow as other Danger Zone actions.
- User receives feedback on how many rows were deleted.
- Existing chart rendering and KPI calculations continue to work against the
  reduced dataset.

## Recommended Implementation Order

1. **Graph downsampling / smoothing** (improves chart UX for long ranges)
2. **Configurable sheet-data auto-fetch** (establishes background refresh behavior)
3. **6-month future task filter** (independent backend filtering)
4. **Danger Zone: hourly downsample of last-year data** (ready; insert after Prune Old Data in Danger Zone)
5. **Rolling average line** (non-destructive, chart-only enhancement)

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

1. **Index.html** — auto-fetch controls, UI note for future-task filter, and
   Danger Zone button for hourly downsample (pending approach decision).
2. **JavaScript.html** — chart downsampling logic, background refresh
   lifecycle, and confirmation handler for hourly downsample.
3. **Styles.html** — no changes expected.
4. **Code.js** — 6-month future-task filtering during ingestion, and hourly
   downsample backend logic (pending approach decision).

All previously completed items remain unchanged.