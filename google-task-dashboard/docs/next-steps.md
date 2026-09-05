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

📋 **Planned**

**Implementation:** Save user preferences to browser localStorage to restore state across sessions: range filter (1D/3D/7D/14D/30D/All), series visibility toggles (Open/Overdue/Completed/Severity/Trend), auto-fetch interval, auto-trigger enabled state. Load and apply saved values on page init. No performance gain — UX convenience only.

**Changes:**
- [pending implementation]

**Files:** JavaScript.html

**Effort:** S

---

### 5. Adaptive historical snapshot downsampling

📋 **Planned**

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

✅ **DONE**

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

**Effort:** M ✓

---

### 8. Copyable 7-day day-summary text field

📋 **Planned**

**Implementation:** Text field at bottom of dashboard, copy button included. Lines formatted `YYYY-MM-DD: open/overdue/completed/overdue_severity` with a `Delta:` sub-line vs prior day. Current day shown as "today so far". Data computed during ingestion loop, not client-side. If persistence beyond existing snapshots is needed, add a dedicated sheet storing 14 days; UI shows most recent 7. Retention (14) and displayed count (7) are configurable constants.

**Changes:**
- [pending implementation]

**Files:** requirements.md, Code.js, Index.html, JavaScript.html

**Effort:** M

---

### 9. ETA/velocity status coloring (green/yellow/red)

✅ **DONE**

**Implementation:** Threshold-based status on Backlog ETA card: ETA ≤14d good/green, >14d and ≤30d caution/yellow, >30d warning/red. Same thresholds drive velocity coloring: velocity implying ETA ≤14d is green, implying caution range is yellow, otherwise red. Thresholds as named constants, reused for both ETA and velocity.

**Changes:**
- Added `ETA_THRESHOLD_GOOD = 14`, `ETA_THRESHOLD_CAUTION = 30` constants in JavaScript.html.
- Updated `updateBacklogEstimate()` to calculate status class: `status-good` (≤14), `status-caution` (≤30), `status-warning` (>30).
- Applied status class to backlog ETA card and value element; cascading color via CSS.
- Updated 24h velocity display to calculate implied ETA from velocity and apply same status coloring to velocity span.
- Added CSS classes `.status-good` (green), `.status-caution` (yellow), `.status-warning` (red) with foreground color override.

**Files:** Index.html, JavaScript.html

**Effort:** S ✓

---

### 10. Replace timestamp debounce with LockService mutex

📋 **Planned**

**Implementation:** Replace the fake timestamp-based `acquireSyncLock()` cooldown with a real `LockService.getScriptLock()` mutual exclusion lock. Use `tryLock(timeoutMs)` with explicit timeout checks and structured error returns (no exceptions), matching existing `{success, error}` response shape. Split `ingestTaskMetrics()` into an unlocked internal version to avoid reentrancy risk when `deleteOldCompletedTasks()` calls it post-deletion. Apply locking to all mutation entry points: `ingestTaskMetrics()`, `deleteOldCompletedTasks()`, `compressSheetData()` (prune/downsample). Use two timeout tiers: 5s for interactive operations (user-clicked), 10s for automated triggers (auto-sync cron).

**Implementation details:**
- Create `withScriptLock(timeoutMs, callback)` helper: acquires lock via `tryLock()`, executes callback in try/finally, calls `SpreadsheetApp.flush()` before release, returns structured response on timeout.
- Split `ingestTaskMetrics()` into:
  - `ingestTaskMetricsInternal()` — actual logic, assumes caller holds the lock, no locking wrapper.
  - `ingestTaskMetrics()` — thin public wrapper calling `withScriptLock(TIMEOUT_INTERACTIVE_MS, ingestTaskMetricsInternal)`.
- Update `deleteOldCompletedTasks()` to call `ingestTaskMetricsInternal()` (not the wrapper) for its post-deletion snapshot refresh.
- Wrap `deleteOldCompletedTasks()`, `compressSheetData()` bodies with `withScriptLock()`.
- Define constants: `TIMEOUT_INTERACTIVE_MS = 5000`, `TIMEOUT_TRIGGER_MS = 10000`.
- Auto-trigger: on lock timeout, log and skip silently (retry next cycle in 3 hours) rather than fail the user-facing call.
- Remove old debounce code: `acquireSyncLock()`, `releaseSyncLock()`, `LAST_SYNC_PROP_KEY`, `SYNC_LOCK_COOLDOWN_MS`.

**Changes:**
- [pending implementation]

**Files:** Code.js

**Effort:** M

---

## Feature requests

- at the bottom of the dashboard: add a text field that can be copied from 
  (offer a copy button). in that text field, add a "day summary" for the 
  last 7 days.
  - the format shall be: YYYY-MM-DD: 20/5/10/23.3 
    (open/overdue/completed/overdue_severity). 
    Delta: +2/-1/+1/+4
  - the current day shall also get an entry but with the date "today so far"
  - purpose: get a quick history
  - the data needed shall be calculated in the ingestion loop (since its 
    triggered automatically)
  - if historical data needs to be stored separately: an additional sheet in 
    the data sheet can be created
  - if a sheet is created, historical data for 14d shall be stored and then 
    the UI shall show the most recent 7 items
  - the values 7 and 14 shall be configurable
- we want to give the ETA a status/rating: 
  - if its 14 or lower: thats considered good/green
  - if its >14: thats caution/yellow
  - if its >30: thats warning/red
  - the status shall be marked in the ETA card
  - the boundaries above shall also influence the velocity: if the velocity 
    is such that the ETA is 14 or lower: velocity is good, if its slower so 
    that ETA is in the caution range: its yellow, below that its red
  - the velocity number shall also be color coded in the card
