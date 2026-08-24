# Implementation Plan v2: Planned Features & Enhancements

## Overview

This document outlines feasibility, effort, and implementation approach for all remaining features in the "Planned" section of requirements.

Current implementation status:
- ✅ Items 1-4: Button layout, collapse icon, mobile cards hide, fractional days
- ✅ Item 5: 3-window velocity (24h, 3d, 7d)
- ✅ Item 6: 3-day range pill added
- ✅ Item 7: Graph smoothing (skeleton)

---

## Remaining Planned Items

### 1. **Visual Fix: Folding Button Cursor Blinking**

**Issue:** Summary element shows blinking text cursor on click.

**Feasibility:** ✅ **Yes — 2 min**

**Scope:** CSS-only fix

**Implementation:**
- Add `user-select: none;` to `.danger-zone-summary`
- Already present in `.trigger-toggle-label`, apply same to summary

**File:** Styles.html

**Code:**
```css
.danger-zone-summary {
  cursor: pointer;
  font-size: 14px;
  color: var(--danger);
  display: flex;
  justify-content: space-between;
  align-items: center;
  list-style: none;
  user-select: none;  /* ← Add this */
}
```

---

### 2. **Danger Zone: Start Folded (Not Expanded by Default)**

**Issue:** `<details open>` attribute makes section expanded on page load.

**Feasibility:** ✅ **Yes — 1 min**

**Scope:** HTML-only change

**Implementation:**
- Remove `open` attribute from `<details class="danger-zone-details">`
- Users click to expand first time

**File:** Index.html

**Current:**
```html
<details class="danger-zone-details" open>
```

**Change to:**
```html
<details class="danger-zone-details">
```

**Impact:** Arrow rotates correctly (was already implemented in item 1). Collapsed by default.

---

### 3. **Auto-Refresh from Sheet: Configurable Polling (30 min interval)**

**Issue:** User wants optional background polling of sheet data every 30 minutes, toggleable on dashboard.

**Feasibility:** ✅ **Yes — 15 min**

**Scope:** Frontend only (JavaScript + small HTML control)

**Implementation:**

#### 3a. HTML Changes
Add toggle control in header or status area:
```html
<label class="auto-refresh-toggle" title="Enable automatic data refresh every 30 minutes">
  <input type="checkbox" id="toggleAutoRefresh" onchange="DashboardApp.handleAutoRefreshToggle(this.checked)">
  Auto-Refresh (30 min)
</label>
```

**Location:** After status banner, or in header toolbar (TBD based on UX preference)

#### 3b. JavaScript Changes
Add module state & timer:
```javascript
let autoRefreshEnabled = false;
let autoRefreshTimer = null;
const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function handleAutoRefreshToggle(enabled) {
  autoRefreshEnabled = enabled;
  
  if (enabled) {
    // Start timer
    autoRefreshTimer = setInterval(() => {
      console.log('[AUTO-REFRESH] Fetching data...');
      fetchData(); // Existing function
    }, AUTO_REFRESH_INTERVAL_MS);
    
    showNotification('Auto-refresh enabled\nUpdating every 30 min', '🔄', 'info', 2000);
  } else {
    // Stop timer
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    showNotification('Auto-refresh disabled', '🛑', 'info', 1500);
  }
}
```

#### 3c. CSS (if using header placement)
```css
.auto-refresh-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  margin: 0 12px;
}

.auto-refresh-toggle input {
  margin: 0;
  cursor: pointer;
}
```

**Behavior:**
- Default: OFF (no polling)
- User toggles ON → 30-min interval starts
- Each interval: `fetchData()` (existing RPC, no changes needed)
- Toggle OFF → interval stopped, no more polls
- Page reload → state resets to OFF (no persistence)

---

### 4. **Relative Age Auto-Update ("13 min ago" → "14 min ago")**

**Issue:** Staleness display doesn't update without re-fetching. User wants "xx ago" to increment every 10-30 seconds without triggering data fetch.

**Feasibility:** ✅ **Yes — 10 min**

**Scope:** Frontend only (JavaScript timer)

**Implementation:**

#### 4a. Refactor Staleness Display
Store last snapshot timestamp separately:
```javascript
let lastSnapshotTime = null; // ISO string

function updateKPIsAndStaleness() {
  // ... existing code ...
  const lastDate = new Date(latest[0]);
  lastSnapshotTime = lastDate.getTime(); // Store timestamp
  updateStalenessDisplay(); // Call display updater
}

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

#### 4b. Auto-Update Timer
```javascript
let stalernessUpdateTimer = null;

function init() {
  // ... existing init code ...
  
  // Update "xx ago" text every 10 seconds
  stalenessUpdateTimer = setInterval(() => {
    if (lastSnapshotTime) {
      updateStalenessDisplay();
    }
  }, 10 * 1000); // 10 seconds
}

// Clean up on unload (optional)
window.addEventListener('beforeunload', () => {
  if (stalenessUpdateTimer) clearInterval(stalenessUpdateTimer);
});
```

**Behavior:**
- Page load → fetch data → `lastSnapshotTime` set → display shows "Just now"
- Every 10 seconds → `updateStalenessDisplay()` recalculates "xx ago" without fetching
- User clicks "Sync Now" or auto-refresh triggers → `updateKPIsAndStaleness()` updates both time and display
- Display is always current (within 10-second window)

---

### 5. **Graph Smoothing / Downsampling (Large Date Ranges)**

**Issue:** 30d, all-time views show dense charts if many snapshots exist (e.g., hourly ingestion).

**Feasibility:** ✅ **Yes — 25 min**

**Scope:** Frontend only (JavaScript downsampling algorithm)

**Implementation:**

#### 5a. Downsampling Function
```javascript
function downSampleData(rows, targetPointCount = 150) {
  if (rows.length <= targetPointCount) return rows;
  
  // Bin-based downsampling: divide into buckets, keep last point per bucket
  const bucketSize = Math.ceil(rows.length / targetPointCount);
  const sampled = [];
  
  for (let i = 0; i < rows.length; i += bucketSize) {
    const bucketEnd = Math.min(i + bucketSize, rows.length);
    const bucket = rows.slice(i, bucketEnd);
    
    if (bucket.length > 0) {
      // Keep last point in bucket (most recent in time range)
      sampled.push(bucket[bucket.length - 1]);
    }
  }
  
  return sampled.length > 0 ? sampled : [rows[rows.length - 1]];
}
```

#### 5b. Apply Downsampling in Chart Function
```javascript
function drawStackedLineComboChart() {
  const chartContainer = document.getElementById('mainChart');
  if (!chartContainer) return;
  
  let filteredRows = filterDataByRange(rawData.rows, activeRangeDays);
  
  // Apply downsampling for large datasets
  let targetPoints = 150; // Default
  if (activeRangeDays === 'all') {
    targetPoints = 100; // Aggressive for all-time
  } else if (activeRangeDays >= 30) {
    targetPoints = 150; // Moderate for 30d
  } else {
    // 7d or less: no downsampling (show all detail)
    targetPoints = filteredRows.length;
  }
  
  filteredRows = downSampleData(filteredRows, targetPoints);
  
  // ... rest of chart building code (use filteredRows) ...
}
```

**Behavior:**
- 7d range or less: All points plotted (detail preserved)
- 14d range: ~150 points max (every 2-3 points kept)
- 30d range: ~150 points max (every 6-10 points kept, depends on snapshot frequency)
- All-time: ~100 points max (significant decimation)
- Effect: Chart renders faster, less visual clutter, trend still visible

---

### 6. **Relative Time Window Configuration (Configurable Throughput Window)**

**Status:** ⚠️ **Deferred — Already Implemented (Item 5)**

The requirements asked for "configurable throughput window" but item 5 replaced this with **fixed 3-window display** (24h, 3d, 7d). This is now locked in place and doesn't need user configuration.

**No further action needed.**

---

### 7. **3-Day Range Filter Pill**

**Status:** ✅ **Done — Item 3**

Already added to range filter group. Currently active alongside 7D, 14D, 30D, All.

---

### 8. **Fractional Days in Overdue Severity**

**Status:** ✅ **Done — Item 4**

`Math.floor()` removed from daysOverdue calculation in `Code.js` line 145.

---

### 9. **Rolling Average Line (Advanced Visualization)**

**Issue:** User wants optional "thin" rolling average overlay on chart for smoothed trend visibility on longer timeframes.

**Feasibility:** ⚠️ **Yes, but requires refinement — 30 min + UX decision**

**Scope:** Frontend only (JavaScript) + minimal UI control

**Considerations:**
- Which series to average? (Open, Overdue, Completed, Severity?)
- Window size? (3-point, 7-point, adaptive?)
- Should it be a separate toggle or auto-enabled on 30d+ ranges?
- Color scheme (muted, distinct?)
- Will clutter chart if applied to all series

**Implementation (Sketch):**

```javascript
// Calculate N-point moving average
function calculateMovingAverage(values, windowSize = 7) {
  if (windowSize < 1) windowSize = 1;
  const averaged = [];
  
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(values.length, i + Math.ceil(windowSize / 2));
    const window = values.slice(start, end);
    
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    averaged.push(avg);
  }
  
  return averaged;
}
```

**Recommendation:** 
- Add as **optional toggle** (not on by default) to avoid clutter
- Apply to **Severity series only** (higher SNR, smoother decay trend visible)
- Use 7-point window + muted purple (#c9a1f4 or similar)
- Only enable toggle on 14d+ ranges (meaningful smoothing)

**Status:** Hold for future — requires UX mockup and user feedback on window size/series choice.

---

### 10. **Button: Open Google Tasks List**

**Issue:** Add button to open `https://calendar.google.com/calendar/u/0/r/tasks` directly from dashboard.

**Feasibility:** ✅ **Yes — 3 min**

**Scope:** HTML-only addition

**Implementation:**

#### 10a. Add Button to Header
```html
<a href="https://calendar.google.com/calendar/u/0/r/tasks" target="_blank" 
   class="btn btn-secondary" title="Open Google Tasks in Google Calendar">
  <span class="btn-icon">✓</span> Open Tasks
</a>
```

**Location:** In `.header-actions` after "View Sheet" link (or elsewhere in toolbar if preferred)

**Behavior:**
- Opens Google Calendar Tasks view in new tab
- No RPC call, pure link

---

### 11. **Open Tasks Filter: Exclude 6+ Month Future Due Dates**

**Issue:** Long-term future tasks shouldn't count as "open" in KPI. Add filter + note on dashboard.

**Feasibility:** ✅ **Yes — 15 min (backend + frontend)**

**Scope:** Backend (Code.js) + Frontend (JavaScript + HTML note)

**Implementation:**

#### 11a. Backend Changes (Code.js)
Modify `ingestTaskMetrics()` to exclude tasks due > 6 months in future:

```javascript
function ingestTaskMetrics() {
  const now = new Date();
  const sixMonthsFuture = new Date(now.getTime() + (6 * 30 * 24 * 60 * 60 * 1000));
  
  // ... existing code ...
  
  for each task:
    if (task.status === 'completed') {
      totalCompleted++;
    } else if (task.status === 'needsAction') {
      // Only count as "open" if due within 6 months or no due date
      if (!task.due || new Date(task.due) <= sixMonthsFuture) {
        totalOpen++;
        
        // ... existing overdue logic ...
      }
    }
}
```

**Note:** This changes the "Open" count semantics. Existing snapshot rows don't change; only new snapshots use the filter.

#### 11b. Frontend Changes (JavaScript)
Add info note to Open Tasks card:

```html
<div class="card card-blue">
  <div class="label">Open Tasks</div>
  <div class="value" id="kpiOpen">-</div>
  <div class="subtext" id="kpiOpenSubtext">Total incomplete</div>
  <div class="card-note">Excl. tasks due >6 months ahead</div>
</div>
```

#### 11c. CSS for Note
```css
.card-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}
```

**Behavior:**
- Only affects new snapshots
- KPI card shows: "X open (excl. >6mo future)"
- Reduces artificial inflation from far-future placeholder tasks

---

## Summary Table

| # | Item | Files | Effort | Status | Notes |
|---|------|-------|--------|--------|-------|
| 1 | Folding cursor fix | Styles.html | 2 min | ✅ Ready | CSS: `user-select: none` |
| 2 | Danger zone start folded | Index.html | 1 min | ✅ Ready | Remove `open` attr from `<details>` |
| 3 | Auto-refresh (30m) | JavaScript.html | 15 min | ✅ Ready | Timer + toggle + notification |
| 4 | Relative age auto-update | JavaScript.html | 10 min | ✅ Ready | 10-sec timer, no RPC |
| 5 | Graph downsampling | JavaScript.html | 25 min | ✅ Ready | Bin-based, smart target points |
| 6 | Configurable window | — | — | ⏸️ Deferred | Replaced by fixed 3-window (item 5) |
| 7 | 3-day range | Index.html | — | ✅ Done | Already in range filter |
| 8 | Fractional days | Code.js | — | ✅ Done | Removed floor() |
| 9 | Rolling average | JavaScript.html | 30+ min | ⏸️ Hold | Needs UX refinement, config |
| 10 | Open Tasks button | Index.html | 3 min | ✅ Ready | Link to calendar.google.com |
| 11 | 6-month future filter | Code.js + JavaScript.html | 15 min | ✅ Ready | Backend filter + UI note |
| **TOTAL** | — | — | **~1.5 hours** | — | Excluding rolling average & config |

---

## Recommended Implementation Order

1. **Items 1–2** (5 min): Quick CSS/HTML wins
2. **Item 10** (3 min): Add Tasks link
3. **Item 4** (10 min): Relative age auto-update (high UX value, low effort)
4. **Item 3** (15 min): Auto-refresh toggle (commonly requested feature)
5. **Item 11** (15 min): Future-date filter (minor but improves metric accuracy)
6. **Item 5** (25 min): Graph downsampling (performance + UX, complex)
7. **Item 9** (deferred): Rolling average (requires UX consensus)

**Total sprint time: ~90 min** (excluding item 9)

---

## Risks & Considerations

- **Item 3 (auto-refresh):** Excessive API polling if user sets shorter interval later; document 30-min minimum
- **Item 4 (age update):** 10-sec timer runs indefinitely; could add power-saving logic (pause if tab inactive)
- **Item 5 (downsampling):** Bin-based approach is simple but loses peak detection; consider preserving min/max in buckets if needed
- **Item 11 (future filter):** Changes "Open" count definition; document in changelog or UI note
- **Item 9 (rolling average):** Deferred pending UX decision on window size, series selection, and user feedback
