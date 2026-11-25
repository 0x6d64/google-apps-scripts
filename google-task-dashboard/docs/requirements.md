# Google Tasks Dashboard

Living document. No version number — edit in place.

## Purpose

Track Google Tasks health over time. Apps Script ingests tasks periodically,
stores aggregate metrics in a Google Sheet, HTML dashboard plots trends.
Personal use, single user, all task lists aggregated (no per-list breakdown).

## Components

- **Apps Script**: reads task lists, aggregates metrics, appends snapshot row
  to Sheet. Serves dashboard via `doGet()`. Time-driven trigger every 3h.
- **Google Sheet**: append-only storage. No logic.
- **HTML dashboard**: reads Sheet data, renders interactive time-series chart.
  `Index.html`, `Styles.html`, `JavaScript.html` (data, KPIs, chart) and
  `Landscape.html` (background landscape).

## Auth

Personal use only. Apps Script has Tasks scope. Dashboard viewable by
account owner (Google login required). Deployment URL obscurity + Google
auth = sufficient security.

---

## Requirements

### Metrics (per snapshot)

- `timestamp`, `open`, `completed`, `overdue`, `overdue_severity`,
  `subtasks_open`, `subtasks_completed`
- `open`: incomplete tasks, excluding due-date >6mo in future (undated tasks
  always included)
- `overdue`: open tasks with a due date whose effective overdue deadline has
  passed. Because the Tasks API does not expose the time-of-day component, the
  effective deadline is 21:00 on the due calendar date, using the Apps Script
  project timezone (`Europe/Bucharest` in `appsscript.json`).
- Tasks due today are not overdue before 21:00; tasks due on an earlier
  calendar date are overdue throughout the current day. Tasks without a due
  date are never overdue.
- `overdue_severity`: `Σ sqrt(days_overdue)` across overdue open tasks, with
  `days_overdue` calculated from the effective 21:00 deadline and fractional
  days retained (sublinear penalty, dampens outliers)
- Stacked/chart decomposition: `on_time_open = open - overdue` (mutually
  exclusive with `overdue`, avoids double-counting)

### Apps Script backend

- Auto-create Sheet on first run if `SPREADSHEET_ID` property missing;
  header row: `timestamp, open, completed, overdue, overdue_severity,
  subtasks_open, subtasks_completed`
- Auto-install 3h trigger on first run if `AUTO_SYNC_ENABLED` unset (default
  `'true'`); `setTriggerEnabled(bool)` toggles trigger + property
- `ingestTaskMetrics()` — live pull from Tasks API, append row. Aborts (no
  snapshot row written) if any task list fails to load, so partial data never
  lands in the sheet.
- `getDashboardData()` — read Sheet only, no Tasks API call
- Auto-delete (see below); `dryRunAutoDelete()` from the script editor logs
  what the next run would delete, without changing anything
- `downsampleLastYearToHourly()` — collapse last-365-day rows using the
  configured age-based downsampling policy, latest-wins
- During `ingestTaskMetrics()`, calculate the top 20 overdue open tasks
  and store them in a dedicated "Top Overdue" sheet in the same Google Sheets
  file. Include task ID, task list ID, task list name, title, due date,
  overdue duration, individual severity, and parent task ID. Sheet is retained
  for human inspection and future extensibility.
- `getDashboardData()` reads the top 5 overdue tasks from the Top Overdue
  sheet (display limit) for dashboard rendering. If no overdue tasks exist,
  the section is hidden. Sheet may contain up to 20 tasks.
- Top Overdue sheet updates on every `ingestTaskMetrics()` call; clears all
  prior data rows and writes the fresh top 20.
- `pruneDataOlderThan1Year()` — collapse >365-day rows to 1/calendar-day
  (UTC); abort if >80% of rows would be deleted; return stats
  (`totalBefore/After/Pruned/durationMs`)

### Auto-delete of old completed tasks

- Switch in the Danger Zone, script property `AUTO_DELETE_OLD_ENABLED`, off
  by default; enabling asks for confirmation
- When on, the 3h trigger and "Ingest From Tasks" delete tasks completed more
  than 8 weeks ago, oldest first, at most 50 per run. The first-load ingest
  never deletes (it runs without the lock)
- A parent is only deleted when every subtask it still has is deleted in the
  same run, subtasks first
- Nothing is deleted if any task list fails to load
- Stops early to stay within the Apps Script 6-minute limit
- `Counters` sheet (`key, value, updated_at`): `deleted_completed_units` and
  `deleted_subtask_units` (priority-weighted), `deleted_task_count`,
  `last_run_deleted_count`. An unreadable value stops the ingest
- Snapshots store `completed = present + deleted_completed_units` (same for
  `subtasks_completed`), so completion statistics survive deletion
- Counters are written before the snapshot. If a run dies between deleting and
  writing them, that interval's completions can be lost
- A deleted task that is restored would be counted twice

### Concurrency & locking

- All mutation operations (`ingestTaskMetrics`, `compressSheetData` / prune /
  downsample, `syncNow`) use
  `LockService.getScriptLock()` for true mutual exclusion across all execution
  contexts (manual triggers, automated cron, maintenance operations).
- Lock acquisition uses `tryLock(timeoutMs)` with two timeout tiers:
  - **Interactive operations** (user-clicked): 5000ms
  - **Automated triggers** (background cron): 10000ms
- On lock timeout, interactive operations return `{success: false, error: "..."}`;
  automated triggers skip silently and retry on the next scheduled cycle (3h).
- Lock is released in a `finally` block after `SpreadsheetApp.flush()` to
  ensure all Sheet writes are committed while the lock is still held.
- Internal logic functions (e.g., `ingestTaskMetricsInternal()`) are unlocked
  and assume the caller holds the lock, preventing reentrancy issues.

### Dashboard — KPIs

- Cards: Open, Completed, Overdue, Overdue Severity (1 decimal, backend
  value unaffected)
- The Completed card shows completions within the selected range, with the
  stored total (including deleted tasks) in small text
- Velocity: 24h / 3d / 7d completion throughput. Sum positive deltas only
  (ignore drops from purge/delete). Use actual elapsed time between
  snapshots, not fixed interval.
- Top Overdue section: displays the top 5 most severe overdue tasks from the
  Top Overdue sheet (which stores up to 20). Each task shows
  title, overdue duration, and individual severity. Section is hidden when no
  overdue tasks are available.
- Backlog ETA card uses status colors: green (<=14 days), yellow (<=30 days),
  red (>30 days).
- Backlog ETA card: shown only if `completion_rate > addition_rate` and
  `open > 0`; else hidden / "Cannot estimate". Recalculates on range change.
  The value is labelled as days left.
- `tasks_added = max(0, open_end - open_start + completed_in_window)`;
  `addition_rate = tasks_added / elapsed_days`.
- Snapshot age and sheet-fetch age shown separately, both self-updating
  every 10s without backend calls. Resolution: minutes <1h, decimal hours
  1–24h (e.g. "1.2 hr ago"), whole days ≥24h.

### Dashboard — chart

- Primary chart: stacked area (Overdue → On-Time Open → Completed, in that
  order) + Severity as independent line on secondary axis
- Series toggle checkboxes control visibility of all 4 series independently
- Completed is drawn relative to the selected range: it starts at 0 and adds
  positive changes only. For "All" it therefore ends below the card's total
- Range filter: 1D / 3D / 7D / 14D / 30D / All, client-side (no backend call)
- Downsampling: long ranges binned to ~50 buckets for render only; KPIs use
  full data
- Rolling average / trend line (optional toggle): dotted, reduced opacity.
  Window size scales with row count. For stacked series (Overdue, Open,
  Completed) the average must use the **same cumulative stacking** as the
  raw series — sum raw per-series averages, don't restack already-stacked
  values (see gotcha below). Severity average stays independent.

### Dashboard — actions & Danger Zone

- View Sheet (link), Launch Google Tasks (link), Fetch Data From Sheet
  (Sheet only), Ingest From Tasks (Tasks API + append + refresh)
- Danger Zone: collapsed by default, ordered by destructive impact
  (highest→lowest): Downsample Last Year → Prune Old Data (>1y). The
  auto-delete switch sits above these buttons
- Auto-fetch (Sheet only, never Tasks API): toggle + interval (15/30/60min),
  default on. Pauses when tab hidden. On refocus, fetch immediately if
  interval elapsed while hidden, then resume timer.
- Confirmation dialogs + result stat modals for destructive/bulk actions
- A failed auto-sync toggle restores the checkbox; a failed refresh after
  maintenance is shown in the status banner

### Dashboard — background landscape

- Decorative, behind all content; weather reflects completion pace and light
  reflects time of day
- Details in `design-brief-background/landscape-extension-design-brief.md`

### Responsive / UI

- <768px: hide KPI cards, header buttons use responsive stacking layout
- Header buttons wrap to further rows instead of overflowing
- All header buttons: consistent min-height, centered content, no
  layout shift from label wrapping
- Danger Zone arrow: 90° rotation (→ collapsed, ↓ expanded), no text
  selection cursor on summary row

---

## Implementation notes (gotchas)

- **Velocity**: naive `newest - oldest` breaks across purges (count can
  drop). Always sum positive deltas between consecutive snapshots only.
- **Weighted task-priority velocity** (`!`, `!!`, `!!!`, `!!!!` prefixes):
  weight = prefix_count + 1 (no prefix → 1, `!` → 2, `!!` → 3, `!!!` → 4,
  `!!!!` → 5). Calculated live during ingestion by summing
  `getTaskWeight(title)` for each task. Weights are stored in the snapshot
  rows themselves, so historical weighted velocity survives reloads;
  pre-weighting snapshots remain unweighted.
- Subtask counts (`subtasks_open`, `subtasks_completed`) are stored
  alongside the aggregates; the Top Overdue sheet carries a `parent` column.
- **Stacked average double-counting**: when accumulating a running
  `stackBase` across layers, add the *raw* per-layer average each time —
  not the already-stacked cumulative value. Adding the stacked value back
  into the base compounds every prior layer on each subsequent layer.
- **Chart instance reuse**: recreate the ComboChart instance (clear
  container, `new google.visualization.ComboChart(...)`) on every render
  rather than reusing one across draws with changing series/column counts.
  Reuse can leave stale series config cached, so toggles only visibly apply
  after an unrelated structural change (e.g. adding trend columns).
- **Auto-fetch never triggers Tasks API** — only reads Sheet via
  `getDashboardData()`. Keeps background polling free.
- Historical Sheet rows are immutable snapshots; deleting/purging tasks
  never rewrites past rows, only affects the next snapshot's counts.

## Local preview

`python preview/build.py` builds the real frontend with a mocked backend
into `preview/preview.html`. See `preview/README.md`.

## Deployment

- Deploy with `./deploy.sh`. It stamps the git commit hash (suffix `-dirty` if `webhook/`
  has uncommitted changes) and build time into `webhook/Version.js`, runs `clasp push`,
  and restores the placeholder afterwards.
- The deployed build is shown in the dashboard footer and returned by `getBuildInfo()`.
- Commit before deploying so the stamped hash matches the deployed code.
