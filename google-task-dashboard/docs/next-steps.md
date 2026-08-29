# Next implementation items

## How to work with this document
When editing this doc, use the following guidelines:

**How to plan or refine items:**
- ingest the section "feature requests"
- for each item: create a new numbered section in "Done and planned items" 
  using the template below
- mark the item with the status `📋 **planned**`
- remove the item from "feature requests"

**How to document an implemented item:**
- find the appropriate section in "Done and planned items"
- document the changes done in the section "Changes", be very brief
- check if the section "Files" needs to be updated, update if needed
- change the status from "planned" to "DONE".

**Template for a new section:**

```markdown
### 1. [summary of the feature]

[status icon] **[status]**

**Implementation:** [add implementation details]

**Changes:**
- [list changes here once implemented]

**Files:** [files that are planned to be changed or were changed]

**Effort:** [effort as tshirt size: S, M, L, XL]
```

## Done and planned items
### 1. Display task addition and completion counts alongside backlog ETA

✅ **DONE**

**Implementation:** Backlog ETA card displays raw completion + addition numbers when completion_rate > addition_rate and open > 0. Counts update on range change, using actual elapsed time between snapshots.

**Changes:**
- Added `backlogCountsNote` display element in Index.html
- Added `getWindowRows()` helper to filter snapshots to time window
- Added `calculateTasksAdded()` function using formula: `(open_start - open_end + completed)`
- Refactored `calculateAdditionRate()` to reuse helpers
- Updated `updateBacklogEstimate()` to calculate and display counts conditionally

**Files:** Index.html, JavaScript.html

**Effort:** S ✓

---

### 2. Auto-refresh dashboard after any destructive sheet action

✅ **DONE**

**Implementation:** Every action modifying the Google Sheet (ingest, purge, delete old, downsample, prune) automatically fetches latest data from Sheet without user clicking "Fetch Data From Sheet".

**Changes:**
- Added `refreshDashboardData()` helper that calls `getDashboardData()` (Sheet only, never Tasks API)
- Updated `handlePruneOldData()` to call `refreshDashboardData()` after success
- Updated `handleDownsampleLastYear()` to call `refreshDashboardData()` after success
- Other destructive actions (delete old, purge, sync) already had refresh logic

**Files:** JavaScript.html

**Effort:** S ✓

---

### 3. Weight task metrics by priority prefix in task title

✅ **DONE**

**Implementation:** Parse task `title` (the main summary line; not `notes`) for `!` prefix at the beginning only. No prefix = weight 1, `!` = weight 2, `!!` = weight 3, `!!!` = weight 4, `!!!!` = weight 5. Apply weights to stored snapshot values at ingestion time: `open`, `completed`, `overdue`, `overdue_severity`. Derived metrics (addition rate, completion rate, velocity) are computed client-side from snapshot deltas and naturally reflect weights once weighted snapshots are present. Historical snapshots store unweighted aggregates — visible metric jump at first weighted ingestion expected and accepted.

**Changes:**
- Added `getTaskWeight(title)` function in Code.js to extract prefix weight
- Modified metric accumulation in `ingestTaskMetrics()` to apply weights: `totalOpen += weight`, `totalCompleted += weight`, `totalOverdue += weight`, `totalOverdueSeverity += weight * sqrt(daysOverdue)`
- Added `getTaskWeight(title)` function in JavaScript.html (mirrors backend for consistency)

**Files:** Code.js, JavaScript.html

**Effort:** M ✓

---

### 4. Persist dashboard UI preferences to localStorage

📋 **planned**

**Implementation:** Save user preferences to browser localStorage to restore state across sessions: range filter (1D/3D/7D/14D/30D/All), series visibility toggles (Open/Overdue/Completed/Severity/Trend), auto-fetch interval, auto-trigger enabled state. Load and apply saved values on page init. No performance gain — UX convenience only.

**Changes:**
- [pending implementation]

**Files:** JavaScript.html

**Effort:** S

---

### 5. Adaptive historical snapshot downsampling

📋 **planned**

**Implementation:** Replace the current uniform hourly downsampling with a
configurable age-based policy. Define three categories: Recent (0–3 days,
maximum 1 sample per `RECENT_INTERVAL_MINUTES`), Near-term (>3–7 days, maximum 1
sample per `NEAR_TERM_INTERVAL_MINUTES`), and Historical (>7–365 days, maximum 1
sample per `HISTORICAL_INTERVAL_HOURS`). Use the following explicit parameters:

* `RECENT_MAX_AGE_DAYS = 3`
* `RECENT_INTERVAL_MINUTES = 30`
* `NEAR_TERM_MAX_AGE_DAYS = 7`
* `NEAR_TERM_INTERVAL_MINUTES = 60`
* `HISTORICAL_MAX_AGE_DAYS = 365`
* `HISTORICAL_INTERVAL_HOURS = 3`

Within each rolling interval, retain the latest snapshot and do not create or
interpolate missing data. Data older than `HISTORICAL_MAX_AGE_DAYS` is not
affected. Read-only rows within the affected `HISTORICAL_MAX_AGE_DAYS` range
where practical, leaving older rows untouched. Preserve chronological ordering
and return before/after/removal statistics.

**Changes:**

* [pending implementation]

**Files:** requirements.md, Code.js, Index.html

**Effort:** M

---

### 6. Rework overdue calculation

📋 **Planned**

**Implementation:** Replace the current timestamp-based overdue calculation
with calendar-date-based overdue handling. Google Tasks does not expose the
time-of-day component of due dates through the Tasks API, so a dated task is
considered overdue starting at 21:00 on its due calendar date, using the Apps
Script project timezone. Apply this definition consistently to the aggregate
overdue count, overdue severity, and individual overdue tasks.

**Changes:**

- Define the effective overdue deadline as 21:00 on the task's due date.
- Use the Apps Script project timezone for date and time comparisons.
- Treat tasks due today as not overdue before 21:00.
- Treat tasks due on earlier calendar dates as overdue.
- Keep tasks without a due date out of overdue calculations.
- Rework `overdue` calculation to use the effective deadline.
- Rework `overdue_severity` calculation to use the new overdue duration.
- Ensure individual task severity uses the identical calculation.
- Validate due today before/at/after 21:00, yesterday, future dates, and
  undated tasks.

**Files:** requirements.md, Code.js

**Effort:** M


### 7. Add top 3 overdue tasks

📋 **Planned**

**Implementation:** During the existing Tasks API ingestion, identify the
three currently open tasks with the greatest overdue duration. Use the
overdue calculation defined in item 6. Calculate individual overdue severity
using the same `sqrt(days_overdue)` formula as the aggregate metric. Store the
resulting Top 3 as non-authoritative current state in script-level
`CacheService` with a 6-hour expiration. The dashboard reads the cache
without making additional Tasks API requests.

**Changes:**

- Maintain the three most overdue tasks during ingestion.
- Include task ID, task list ID, task list name, title, due date, overdue
  duration, and individual severity.
- Store Top 3 data in script-level `CacheService`.
- Read Top 3 data as part of the dashboard data request.
- Hide the Top 3 section when cache data is unavailable or no overdue tasks
  exist.
- Do not add Top 3 task data to the historical snapshot sheet.
- Keep Top 3 overdue calculations consistent with the aggregate overdue
  metrics.

**Files:** requirements.md, Code.js, JavaScript.html

**Effort:** M


## Feature requests
