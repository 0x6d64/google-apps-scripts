# Implementation Plan v3

## How to adapt and extend

- never use the concept of sprint, instead use "iteration" as a concept
- do not use time estimates, instead estimate the effort as S, M, L, XL 
  (tshirt sizes)
- do not use the terms "new" if items get implemented or added, instead just 
  add them or mark them as done

## Overview

Completed items 1–4 plus velocity fix, and items 5, 6, 10, 12, 13 in current session.

Current implementation status:

- ✅ Item 1: Separate snapshot and sheet-fetch ages
- ✅ Item 2: Action button terminology and external-link icon
- ✅ Item 3: Reduced KPI card height
- ✅ Item 4: Danger Zone action ordering
- ✅ Bonus: Fixed velocity calculation (sum positive increments, ignore purges)
- ✅ Item 5: Graph downsampling / smoothing
- ✅ Item 6: Configurable sheet-data auto-fetch
- ✅ Item 7: 6-month future task filter
- ✅ Item 8: Rolling average line
- ✅ Item 9: Danger Zone: hourly downsample of last-year data
- ✅ Item 10: Overdue Severity: 1 decimal place formatting
- ✅ Item 11: Estimated backlog completion date
- ✅ Item 12: Consistent action-button sizing
- ✅ Item 13: Higher-resolution elapsed-time display

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

### 5. **Graph downsampling / smoothing** ✅

**Status:** DONE

**Files:** JavaScript.html

**Changes:**

- Added `downsampleData()` function that bins snapshot rows into ~50 buckets and keeps the latest row in each bucket.
- Integrated downsampling into `buildDecomposedDataTable()` before adding rows to the chart.
- Downsampling preserves trend visibility while reducing rendered points for large datasets.
- Scales automatically: no manual configuration needed; works transparently.

**Impact:** Charts remain responsive and readable even on all-time ranges with thousands of snapshots. Trend is preserved; visual clutter reduced.

---

### 6. **Configurable sheet-data auto-fetch** ✅

**Status:** DONE

**Files:** Index.html, JavaScript.html

**Changes:**

**Index.html:**
- Added auto-fetch toggle in Danger Zone (enabled by default).
- Added interval selector with options: 15, 30 (selected), 60 minutes.
- Descriptive label and help text explaining that updates pause when tab is hidden.

**JavaScript.html:**
- Added state variables: `autoFetchEnabled` (true by default), `autoFetchIntervalMs` (30min default), `autoFetchTimer`.
- Implemented `setupAutoFetch()`: wires up toggle and interval selector to event handlers.
- Implemented `startAutoFetch()` / `stopAutoFetch()`: manage background timer.
- Implemented `performAutoFetch()`: silently calls `getDashboardData()` (sheet-only, no Tasks API).
- Implemented `setupPageVisibilityHandler()`: uses Page Visibility API to pause polling when tab is hidden, resume when visible.
- Auto-fetch starts on page load if enabled (default behavior).

**Behavior:**
- Enabled on page load; fetches sheet data every 30 minutes by default.
- Pauses when browser tab not visible (reduces unnecessary requests).
- Resumes when tab becomes visible.
- User can toggle on/off or change interval at any time.
- No disruptive notifications for background refreshes.

**Impact:** Dashboard stays fresh without manual clicks; respects browser visibility for efficiency.

---

### 10. **Overdue Severity: 1 decimal place formatting** ✅

**Status:** DONE

**Files:** JavaScript.html, Styles.html

**Changes:**

**JavaScript.html:**
- Updated KPI display in `updateKPIsAndStaleness()`: formatted severity with `.toFixed(1)`.
- Added Google Charts NumberFormatter in `drawStackedLineComboChart()`: applies `#.0` format to severity column when rendered.

**Impact:** Severity displays as (e.g.) `70.2` instead of `70.23`, reducing visual clutter while maintaining precision. Consistent across KPI card and chart tooltips.

---

### 12. **Consistent action-button sizing** ✅

**Status:** DONE

**Files:** Styles.html

**Changes:**

**Styles.html:**
- Updated `.btn` class:
  - Added `justify-content: center` (horizontal centering).
  - Added `min-height: 40px` (consistent minimum height).
  - Changed gap from `6px` to `8px` for better spacing.
  - Added `line-height: 1.2` for consistent text wrapping.
  - Added `text-align: center` for label alignment.
  - Adjusted padding to `8px 16px` (vertical reduction for compact layout).

**Impact:** All header action buttons are uniform in height and content alignment, regardless of label length or text wrapping. Improved visual consistency.

---

### 13. **Higher-resolution elapsed-time display** ✅

**Status:** DONE

**Files:** JavaScript.html

**Changes:**

**JavaScript.html:**
- Updated `formatTimeAgo()` function:
  - Sub-1h: minute resolution (e.g., "15 min ago").
  - 1h+: decimal hour resolution (e.g., "1.2 hr ago", "2.4 hr ago").
  - 24h+: day format (e.g., "1 day ago", "2 days ago").

**Impact:** "Last updated" timestamps show granular information for hours (decimal precision) while staying simple for short durations (minutes). Users can see exactly when the last refresh occurred without rounding ambiguity.

---

### 7. **6-month future task filter** ✅

**Status:** DONE

**Files:** Code.js, Index.html

**Changes:**

**Code.js:**
- Modified `ingestTaskMetrics()` function:
  - Added 6-month cutoff calculation: `sixMonthsCutoff = now + 6 months`.
  - Refactored open-task logic to exclude tasks due beyond the cutoff.
  - Tasks without due dates are always counted as open.
  - Tasks with due dates within 6 months are counted normally.
  - Overdue and severity calculations unchanged (only apply to tasks in the past).

**Index.html:**
- Added explanatory note after KPI cards explaining that far-future tasks are excluded from the open-task count.
- Note clarifies that tasks without due dates are always included.

**Behavior:**
- A task due 200 days in the future is counted.
- A task due 250 days in the future is excluded.
- A task with no due date is always counted.
- Overdue count and severity remain accurate for genuinely overdue tasks.

**Impact:** Open-task metrics now reflect realistic near-term workload. Far-future tasks (beyond 6 months) no longer inflate the backlog, allowing users to focus on achievable near-term priorities. Metric decomposition remains consistent (on-time + overdue = open).

---

### 8. **Rolling average line** ✅

**Status:** DONE

**Files:** Index.html, JavaScript.html

**Changes:**

**Index.html:**
- Added "Trend Line" toggle pill in Series control group (after Severity toggle).
- Toggle ID: `toggleRollingAvg`; unchecked by default.

**JavaScript.html:**
- Added `calculateRollingAverage()` function: computes trailing window SMA for a data column.
  - Window size calculated dynamically: `Math.max(2, Math.min(ceil(dataPoints / 50), 168))`.
  - Adapts to selected range (3D → 7D → 30D → All); clamped between 2 and 168.
- Refactored `drawStackedLineComboChart()`:
  - Detects `toggleRollingAvg` state.
  - When enabled, dynamically adds rolling average columns to the data table.
  - Calculates rolling average for each visible series (On-Time Open, Overdue, Completed, Severity).
  - Renders rolling averages as dotted lines (`lineDashStyle: [5, 5]`) with 60% opacity.
  - Reuses series colors; no separate control per series.
  - Series visibility toggles apply to both raw and averaged data simultaneously.

**Visual Design:**
- Dotted lines with 60% opacity for easy distinction from raw data.
- Same color scheme as underlying series (blue, red, green, purple).
- No additional legend items; legend shows series names only.

**Behavior:**
- Toggle OFF: only raw data lines shown (default).
- Toggle ON: raw data + rolling average overlay displayed.
- Window size auto-scales with data points.
- Works with all range filters (3D, 7D, 14D, 30D, All).
- Toggling individual series (e.g., unchecking Severity) hides both raw and averaged lines.

**Impact:** Users can now visualize trend lines overlaid on raw data to see underlying momentum without manual smoothing. Particularly useful for long date ranges where raw data is noisy. Performance impact negligible (O(n) computation).

---

### 11. **Estimated backlog completion date** ✅

**Status:** DONE

**Files:** Index.html, JavaScript.html, Styles.html

**Changes:**

**JavaScript.html:**
- Added `calculateAdditionRate(rows, rangeDays)`: Computes tasks added per day over the selected window using formula `(open_start - open_end + completed_in_period) / days_elapsed`.
- Added `calculateCompletionsInWindow(windowRows)`: Sums positive completion deltas (ignores purges/deletes).
- Added `calculateCompletionRate(rows, rangeDays)`: Computes tasks completed per day over the selected window.
- Added `calculateDaysToCompletion(currentOpen, completionRate, additionRate)`: Computes days until backlog reaches zero: `current_open / (completion_rate - addition_rate)`.
  - Handles edge cases: returns `"0"` if current_open ≤ 0, `"Cannot estimate"` if completion_rate ≤ addition_rate.
  - Formats result as integer if ≥ 1 day, else 1 decimal place.
- Added `updateBacklogEstimate(rows)`: Updates the backlog ETA card in the UI. Called from `updateKPIsAndStaleness()` after velocity calculation.

**Index.html:**
- Added new "Backlog ETA" card (card-purple) with ID `backlogEstimateCard`.
- Card displays:
  - Value: `backlogEstimateValue` (days to completion or message).
  - Subtext: `backlogEstimateNote` (explains basis: "Based on rates over past X days").
- Card hidden by default; shown only when estimate is computable.

**Styles.html:**
- Added `.card-purple::before { background: #a142f4; }` for the new card's accent color.

**Calculation Details:**
- Uses rates computed over the selected date range (3D, 7D, 14D, 30D, or All).
- **Completion rate:** Sum of positive completion deltas / elapsed days (survives purges).
- **Addition rate:** (open_start - open_end + completions) / elapsed days.
- **Net rate:** Completion rate - Addition rate.
- **Days to zero:** current_open / net_rate.

**Edge Cases:**
- Current open = 0: Card hidden (no estimate needed).
- Completion rate ≤ Addition rate: Shows "Cannot estimate" (backlog stable or growing).
- Insufficient data (< 2 snapshots in window): Card hidden.

**Behavior:**
- Estimate updates whenever:
  - Data is loaded (`onDataLoaded`)
  - Range filter changes (`setRangeFilter` triggers `updateChartVisibility` → `renderCharts` → `updateKPIsAndStaleness`).
- Uses same window logic as chart range filters.
- Transparent about uncertainty: labeled "Backlog ETA" and includes note on basis.

**Impact:** Users gain actionable insight into how long to clear their backlog at current pace. Particularly useful for capacity planning and prioritization decisions. Explicit handling of edge cases prevents misleading estimates.

---

### 9. **Danger Zone: hourly downsample of last-year data** ✅

**Status:** DONE

**Files:** Code.js, Index.html, JavaScript.html

**Changes:**

**Code.js:**
- Added `downsampleLastYearToHourly()` function following the same pattern as `pruneDataOlderThan1Year()`:
  - Identifies all rows with `timestamp >= now - 365 days`.
  - Sorts candidate rows ascending by timestamp.
  - Applies rolling 60-minute window logic: iterates chronologically, tracking a window anchor timestamp; if the next snapshot falls within 60 minutes of the anchor, the previously kept row is marked for deletion and replaced by the newer one (latest-wins); if it falls outside the window, a new window starts.
  - Same safety guardrails as pruning: aborts if fewer than 10 total rows, aborts if more than 80% of rows would be removed.
  - Batch-deletes rows bottom-to-top to avoid index shifting.
  - Returns `{success, totalBefore, totalAfter, totalRemoved, percentageRemoved, durationMs, message}`.
  - Rows older than 365 days are untouched (left to `pruneDataOlderThan1Year`).
  - Uses the existing `acquireSyncLock()` / `releaseSyncLock()` mechanism to prevent concurrent maintenance operations.

**Index.html:**
- Added "Downsample Last Year (1/hour)" button (📉 icon, btn-secondary styling) in Danger Zone.
- Placed between "Delete Old Done Tasks (>8w)" and "Prune Old Data (>1 year)", matching the planned impact ordering.

**JavaScript.html:**
- Added `handleDownsampleLastYear()`: shows confirmation dialog explaining the action is irreversible, calls `downsampleLastYearToHourly()` RPC, and shows success/error feedback via notification and status banner.
- Added `showDownsampleResultModal()`: displays a result modal with rows before/after/removed, percentage removed, and execution time (mirrors `showPruneResultModal()`).
- Registered `btnDownsampleLastYear` in `setButtonsDisabled()` so it disables during any in-flight maintenance operation.
- Exposed `handleDownsampleLastYear` in the public `DashboardApp` API.

**Binning logic (rolling 60-minute window, latest-wins):**
- Snapshot's window is the 60-minute span ending at its own timestamp.
- If a later snapshot falls within 60 minutes of the currently kept snapshot, the older one is discarded and the newer one is kept (implements "Latest" aggregation decided earlier).
- If a later snapshot falls outside the window, it starts a new window and is kept.

**Behavior:**
- Requires explicit confirmation before running (irreversible).
- On success: shows row-count feedback (e.g., "Removed 1,842 rows, reduced to 1/hour"), refreshes dashboard data.
- On failure: shows error without altering data.
- Only touches the last 365 days; older rows are unaffected.

**Impact:** Users can now compact the last year of granular snapshot data down to at most one row per rolling hour, removing intra-hour correction noise while preserving genuine hourly trend data. Reduces sheet size and improves chart rendering performance for the most data-dense period.

---

## All Planned Items — Status Summary

All items from the requirements document have been implemented.

| #    | Item                                             | Files                       | Effort | Status  |
| ---- | ------------------------------------------------ | --------------------------- | ------ | ------- |
| 5    | Graph downsampling / smoothing                   | JavaScript.html             | M      | ✅ DONE |
| 6    | Configurable sheet-data auto-fetch               | Index.html, JavaScript.html | M      | ✅ DONE |
| 7    | 6-month future task filter                       | Code.js, JavaScript.html    | S      | ✅ DONE |
| 8    | Rolling average line                             | JavaScript.html             | M      | ✅ DONE |
| 9    | Danger Zone: hourly downsample of last-year data | Index.html, JavaScript.html, Code.js | M | ✅ DONE |
| 10   | Overdue Severity: 1 decimal place formatting     | JavaScript.html, Styles.html | S      | ✅ DONE |
| 11   | Estimated backlog completion date                | JavaScript.html, Index.html | M      | ✅ DONE |
| 12   | Consistent action-button sizing                  | Styles.html, Index.html     | S      | ✅ DONE |
| 13   | Higher-resolution elapsed-time display           | JavaScript.html             | S      | ✅ DONE |

The implementation notes below are retained for historical reference and
design rationale.

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

### Implementation 10 — Overdue Severity: 1 decimal place formatting

**Status:** READY FOR IMPLEMENTATION

**Goal:** Display Overdue Severity with exactly 1 digit after the decimal
separator in both the KPI card and the graph, while backend data remains
unchanged.

**Rationale:** Reduces visual clutter and improves readability. A 2-decimal
format (e.g., 70.00) provides false precision for this metric.

**Implementation approach:**

1. In the KPI card display (`updateKPIsAndStaleness()`), format the severity
   value: `severity.toFixed(1)`.
2. In the chart data preparation, format severity values: `severity.toFixed(1)`.
3. Backend `Code.js` and Google Sheet data remain unchanged (no rounding).
4. Frontend only performs display-time formatting when rendering text or
   chart labels.

**Implementation steps:**

1. Find all places where `overdue_severity` is displayed in text (KPI card).
2. Find all places where severity values are prepared for the chart.
3. Apply `.toFixed(1)` to convert to string with 1 decimal place.
4. Ensure rounding follows JavaScript's standard banker's rounding (round
   half to even), or explicitly choose `Math.round(value * 10) / 10` if
   standard rounding is preferred.

**Acceptance checks:**

- KPI card displays severity as (e.g.) `70.2` not `70.23`.
- Chart labels and tooltips display severity as (e.g.) `70.2`.
- Backend data remains unchanged.
- Rounding is applied consistently across all displays.

### Implementation 11 — Estimated backlog completion date

**Status:** READY FOR IMPLEMENTATION

**Goal:** Display an estimate of days from now until the open-task backlog
reaches zero, calculated from current open-task count, task completion rate,
and task-addition rate over the selected historical window.

**Methodology:**

The estimate uses three inputs:
1. **Current open count:** Latest `open` metric.
2. **Completion rate:** Tasks closed per day, from velocity calculation
   (existing; uses 7-day window or selected range).
3. **Addition rate:** Tasks added per day, calculated as
   `(open_today - open_history_start + completed_in_period) / days_elapsed`.

Formula:
```
days_to_zero = current_open / (completion_rate - addition_rate)
```

If `completion_rate <= addition_rate`, display "∞" or "Cannot estimate" (backlog growing or stable).

**Presentation:**

- Display in a new KPI card or sub-section of the dashboard.
- Label: "Backlog at current pace: ~X days" or "Est. completion: ~X days".
- Explicitly note it is an estimate (e.g., footnote: "Based on historical
  rates over [selected range]").
- Only display estimate if `completion_rate > addition_rate` and current
  `open > 0`.

**Implementation steps:**

1. Calculate `addition_rate` from the selected historical window.
2. Reuse existing velocity/completion rate calculation (already computed).
3. Compute days-to-zero: `current_open / (completion_rate - addition_rate)`.
4. Format result as an integer or 1 decimal place.
5. Add a new card or row in the KPI section with the estimate.
6. Include a small note explaining it is based on historical rates.

**Acceptance checks:**

- Estimate is displayed prominently (new card or section).
- Clearly labeled as an estimate.
- Uses completion and addition rates calculated from the selected range.
- Handles edge cases: completion rate ≤ addition rate (show "Cannot estimate").
- Handles zero open tasks (hide estimate or show "0 days").
- Estimate updates when date range changes.

### Implementation 12 — Consistent action-button sizing

**Status:** READY FOR IMPLEMENTATION

**Goal:** All header action buttons have identical height and aligned content,
regardless of label text length or line-wrapping.

**Current problem:** Button labels vary in length; long labels wrap to 2+ lines,
causing uneven button heights and misaligned content.

**Implementation approach:**

1. Define a minimum button height (e.g., `min-height: 44px` for touch targets;
   or `40px` for desktop).
2. Use `display: flex; align-items: center; justify-content: center;` to center
   all content vertically and horizontally within the button.
3. Set `flex-direction: column` to stack icon and label vertically if wrapping occurs.
4. Apply consistent `padding` (e.g., `8px 12px`) to all buttons.
5. Set `white-space: nowrap;` to prevent wrapping, OR allow wrapping with
   consistent line-height (e.g., `line-height: 1.2`).
6. Test with long labels to ensure all buttons align at the same baseline.

**CSS rule:**

```css
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;  /* space between icon and label */
  min-height: 40px;  /* or 44px for touch */
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 14px;
  line-height: 1.2;
  text-align: center;
  transition: all 0.2s ease;
}
```

**Acceptance checks:**

- All buttons in the header action group have the same height.
- Button content (icon + label) is vertically centered.
- Long labels wrap cleanly without breaking button layout.
- Touch target is at least 44px (mobile a11y).
- Visual alignment is consistent across all buttons.

### Implementation 13 — Higher-resolution elapsed-time display

**Status:** READY FOR IMPLEMENTATION

**Goal:** Display relative age ("last updated X ago") with higher resolution
for values ≥ 1 hour, using decimal hours (e.g., "1.2 hours ago" instead of
rounding down to "1 hour ago"). Minute resolution continues for sub-1-hour values.

**Implementation approach:**

Refactor `formatTimeAgo()` to return different precision based on elapsed time:

```javascript
function formatTimeAgo(minutes) {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' min ago';
  
  const hours = minutes / 60;
  if (hours < 24) {
    // 1 decimal place for hours ≥ 1h
    return hours.toFixed(1) + ' hr ago';
  }
  
  const days = hours / 24;
  return Math.floor(days) + ' day' + (days >= 2 ? 's' : '') + ' ago';
}
```

**Example outputs:**

- 15 minutes elapsed: "15 min ago"
- 45 minutes elapsed: "45 min ago"
- 61 minutes elapsed: "1.0 hr ago"
- 72 minutes elapsed: "1.2 hr ago"
- 90 minutes elapsed: "1.5 hr ago"
- 2 hours 24 minutes elapsed: "2.4 hr ago"
- 26 hours elapsed: "1 day ago"
- 48 hours elapsed: "2 days ago"

**Implementation steps:**

1. Locate the existing `formatTimeAgo()` function in JavaScript.html.
2. Replace the hour/day logic with the new precision-based logic above.
3. Update calls to this function (used in both timestamp displays).
4. Test with various elapsed times to confirm output matches expectations.

**Acceptance checks:**

- Sub-1-hour times show minute resolution (e.g., "15 min ago").
- 1-hour+ times show 1 decimal place (e.g., "1.2 hr ago").
- Times ≥ 24 hours show day format (e.g., "1 day ago", "2 days ago").
- No hardcoded references to specific minute/hour thresholds outside the
  function.

## Implementation Order (as executed)

1. ✅ **Higher-resolution elapsed-time display**
2. ✅ **Overdue Severity: 1 decimal place formatting**
3. ✅ **Consistent action-button sizing**
4. ✅ **Graph downsampling / smoothing**
5. ✅ **Configurable sheet-data auto-fetch**
6. ✅ **6-month future task filter**
7. ✅ **Rolling average line**
8. ✅ **Estimated backlog completion date**
9. ✅ **Danger Zone: hourly downsample of last-year data**

## Testing Checklist for Completed Items

### Configurable sheet-data auto-fetch

- [ ] Toggle can enable/disable polling.
- [ ] Interval can be configured (15/30/60 minutes).
- [ ] Polling stops while the tab is hidden.
- [ ] Polling resumes when the tab is visible.
- [ ] Background polling never calls the Tasks API.
- [ ] Sheet-fetch age updates after successful polling.

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

### Rolling average line

- [ ] Toggle shows/hides dotted trend lines for all visible series.
- [ ] Window size adapts to selected range.
- [ ] Series visibility toggles apply to both raw and averaged lines.

### Estimated backlog completion date

- [ ] Card hidden when open count is 0.
- [ ] Card hidden/shows "Cannot estimate" when backlog is stable or growing.
- [ ] Estimate updates when range filter changes.

### Danger Zone: hourly downsample of last-year data

- [ ] Confirmation dialog appears before running.
- [ ] Rows older than 365 days are untouched.
- [ ] At most 1 row per rolling 60-minute window remains in the last year.
- [ ] Result modal shows rows before/after/removed and duration.
- [ ] Button disables during in-flight maintenance operations.

## File Deliverables Summary

1. **Index.html** — auto-fetch controls, UI note for future-task filter, 
   Danger Zone buttons (downsample + existing), KPI card for backlog 
   completion estimate, rolling-average toggle, and button layout adjustments.
2. **JavaScript.html** — chart downsampling logic, background refresh 
   lifecycle, rolling average toggle and calculation, confirmation handler 
   for hourly downsample, severity formatting (1 decimal), elapsed-time 
   formatting (higher resolution), and backlog completion-date calculation.
3. **Styles.html** — consistent button sizing, minimum heights, flexbox 
   alignment, and card-purple styling for the backlog estimate card.
4. **Code.js** — 6-month future-task filtering during ingestion, and hourly 
   downsample backend logic (`downsampleLastYearToHourly()`).

### User supplied requirements
- change request: when the tab is not in focus, it does not do a data fetch 
  from the google sheet. but once it regains focus, the fetch shall happen 
  immediately if the timer ran out  in the meantime (e.g. when the tab was 
  sleeping for 31 minutes and it fetches every 30min: do a fetch on focus gain)
- calculate 3 velocities
- add weights:
  - No prefix   → weight 1
  - !           → weight 2
  - !!          → weight 4
  - !!!         → weight 8
- Correct stacked average lines: Rolling-average lines shall use the same cumulative stacking logic as the corresponding stacked series, so each average line aligns with its associated stacked boundary and dynamically respects series visibility; the severity average remains an independent secondary-axis average.
- 