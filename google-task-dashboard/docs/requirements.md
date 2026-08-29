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

## Auth

Personal use only. Apps Script has Tasks scope. Dashboard viewable by
account owner (Google login required). Deployment URL obscurity + Google
auth = sufficient security.

---

## Requirements

### Metrics (per snapshot)

- `timestamp`, `open`, `completed`, `overdue`, `overdue_severity`
- `open`: incomplete tasks, excluding due-date >6mo in future (undated tasks
  always included)
- `overdue`: open tasks with `due < now`
- `overdue_severity`: `Σ sqrt(days_overdue)` across overdue open tasks,
  fractional days retained (sublinear penalty, dampens outliers)
- Stacked/chart decomposition: `on_time_open = open - overdue` (mutually
  exclusive with `overdue`, avoids double-counting)

### Apps Script backend

- Auto-create Sheet on first run if `SPREADSHEET_ID` property missing;
  header row: `timestamp, open, completed, overdue, overdue_severity`
- Auto-install 3h trigger on first run if `AUTO_SYNC_ENABLED` unset (default
  `'true'`); `setTriggerEnabled(bool)` toggles trigger + property
- `ingestTaskMetrics()` — live pull from Tasks API, append row
- `getDashboardData()` — read Sheet only, no Tasks API call
- `syncAndClearTasks()` — ingest snapshot, then clear all completed tasks
  (all lists)
- `deleteTasksCompletedOlderThan(cutoffWeeks=8)` — delete completed tasks
  older than cutoff, keep recent ones, re-ingest after
- `downsampleLastYearToHourly()` — collapse last-365-day rows to ≤1/rolling-
  60min-window, latest-wins
- `pruneDataOlderThan1Year()` — collapse >365-day rows to 1/calendar-day
  (UTC); abort if >80% of rows would be deleted; return stats
  (`totalBefore/After/Pruned/durationMs`)

### Dashboard — KPIs

- Cards: Open, Completed, Overdue, Overdue Severity (1 decimal, backend
  value unaffected)
- Velocity: 24h / 3d / 7d completion throughput. Sum positive deltas only
  (ignore drops from purge/delete). Use actual elapsed time between
  snapshots, not fixed interval.
- Backlog ETA card: shown only if `completion_rate > addition_rate` and
  `open > 0`; else hidden / "Cannot estimate". Recalculates on range change.
- Snapshot age and sheet-fetch age shown separately, both self-updating
  every 10s without backend calls. Resolution: minutes <1h, decimal hours
  1–24h (e.g. "1.2 hr ago"), whole days ≥24h.

### Dashboard — chart

- Primary chart: stacked area (Overdue → On-Time Open → Completed, in that
  order) + Severity as independent line on secondary axis
- Series toggle checkboxes control visibility of all 4 series independently
- Range filter: 3D / 7D / 14D / 30D / All, client-side (no backend call)
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
  (highest→lowest): Purge Completed → Delete Old Done (>8w) → Downsample
  Last Year → Prune Old Data (>1y)
- Auto-fetch (Sheet only, never Tasks API): toggle + interval (15/30/60min),
  default on. Pauses when tab hidden. On refocus, fetch immediately if
  interval elapsed while hidden, then resume timer.
- Confirmation dialogs + result stat modals for destructive/bulk actions

### Responsive / UI

- <768px: hide KPI cards, header buttons use responsive stacking layout
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
  `getTaskWeight(title)` for each completed task. Weighted velocity available
  only for current session (most recent ingestion); historical snapshots
  silently fall back to unweighted velocity since spreadsheet stores only
  aggregate completed count, not per-task weights. No schema changes.
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
