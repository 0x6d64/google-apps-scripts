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

## Feature requests

- when ingesting tasks from the Tasks API, the descriptions shall be parsed. I
  want to use a prefix of `!` characters to mark a task as more important, the
  tasks marked like that shall count as 2, 3, 4, ... tasks. the logic shall be
  as follows: no prefix: counts as 1. Prefix `!`: counts as 2. Prefix `!!`:
  counts as 3, and so on (up to 4 times the `!` prefix that counts as 5). the
  prefix shall only be found if its at the beginning of the description. the
  prefix shall influence all metrics (including overdue and completion rate).