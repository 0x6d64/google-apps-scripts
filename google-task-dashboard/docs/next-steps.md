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

✅ **Done**

**Implementation:** Replaced timestamp-based overdue calculation with 
calendar-date-based overdue handling. Tasks are overdue starting at 
OVERDUE_HOUR (configurable constant, default 21:00) on their due calendar 
date, using the account's timezone from Apps Script project settings. 
Applied consistently to aggregate overdue count and severity.

**Changes:**

- Define effective overdue deadline as OVERDUE_HOUR:00 on task's due date (YYYY-MM-DD).
- Read timezone from `Session.getScriptTimeZone()` with fallback to `DEFAULT_TIMEZONE`.
- `OVERDUE_HOUR` is a module-level constant (line 11, currently 21).
- Helper function `getOverdueDeadline(dueDateStr, timezone, overdueHour)` 
  calculates UTC deadline by iterating UTC hours 0–23 and finding which maps 
  to OVERDUE_HOUR in target timezone.
- Tasks due today are not overdue before 21:00; overdue at/after 21:00.
- Tasks due on earlier calendar dates are overdue.
- Tasks without due date excluded from overdue count.
- Severity recalculates per snapshot: `weight * sqrt(daysOverdue)` from 
  deadline to snapshot time, drifting forward as snapshots age.
- No property storage; timezone auto-detected from account.

**Test cases covered:**
- Today before 21:00 → not overdue
- Today at/after 21:00 → overdue (severity ≥ 0)
- Yesterday → overdue with severity ≥ 1
- Earlier dates → overdue with increasing severity
- No due date → excluded

**Files:** Code.js

**Effort:** M


### 7. Add top overdue tasks

📋 **Planned**

**Implementation:** During the existing Tasks API ingestion, identify the
10 currently open tasks with the greatest overdue duration. Use the overdue
calculation defined in item 6. Calculate individual overdue severity using the
same `sqrt(days_overdue)` formula as the aggregate metric. Store the Top 10 in
a dedicated sheet in the same Google Sheets file, replacing the previous
cache-based approach. The sheet is human-readable and exposes the current
overdue task ranking. The dashboard reads the Top 10 from the sheet as part
of the dashboard data request and displays only the Top 3.

**Changes:**

- Maintain the 10 most overdue tasks during ingestion.
- Include task ID, task list ID, task list name, title, due date, overdue
  duration, and individual severity.
- Store the Top 10 in a dedicated sheet in the same Google Sheets file.
- Replace the previous `CacheService` storage (if it exists) with sheet storage.
- Read the Top 10 from the sheet as part of the dashboard data request.
- Display only the Top 3 overdue tasks on the dashboard as defined by the
  requirements.
- Expose the full Top 10 in the sheet for human readers.
- Hide the Top 3 section when the sheet contains no overdue tasks.
- Keep Top 10 overdue calculations consistent with the aggregate overdue
  metrics.

**Files:** requirements.md, Code.js, JavaScript.html

**Effort:** M


## Feature requests
