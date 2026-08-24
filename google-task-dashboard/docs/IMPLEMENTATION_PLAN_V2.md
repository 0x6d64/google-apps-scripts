# Implementation Plan v2: Updated Status (Items 1, 2, 4, 10 Complete)

## Overview

This document tracks completion of planned features. Items 1, 2, 4, 10 have been implemented.

Current implementation status:
- ✅ Items 1-5 (earlier sprint): Button layout, collapse icon, mobile cards hide, fractional days, 3-window velocity
- ✅ Item 6: 3-day range pill
- ✅ Item 7: Graph smoothing (skeleton)
- ✅ **NEW — Items 1, 2, 4, 10** (this sprint)

---

## Completed Items (This Sprint)

### 1. **Visual Fix: Folding Button Cursor Blinking** ✅

**Status:** DONE

**File:** Styles.html

**Change:** Added `user-select: none;` to `.danger-zone-summary`

```css
.danger-zone-summary {
  cursor: pointer;
  font-size: 14px;
  color: var(--danger);
  display: flex;
  justify-content: space-between;
  align-items: center;
  list-style: none;
  user-select: none;  /* ← Prevents text selection cursor */
}
```

**Impact:** Eliminates blinking text cursor when clicking danger zone header.

---

### 2. **Danger Zone: Start Folded (Not Expanded by Default)** ✅

**Status:** DONE

**File:** Index.html

**Change:** Removed `open` attribute from `<details>` tag

**Before:**
```html
<details class="danger-zone-details" open>
```

**After:**
```html
<details class="danger-zone-details">
```

**Impact:** Danger zone now starts collapsed. User must click to expand. Arrow rotation works correctly (was already in place).

---

### 4. **Relative Age Auto-Update ("13 min ago" → "14 min ago")** ✅

**Status:** DONE

**Files:** JavaScript.html

**Changes:**

#### 4a. Store snapshot timestamp globally
```javascript
let lastSnapshotTime = null;

function updateKPIsAndStaleness() {
  // ... existing code ...
  const lastDate = new Date(latest[0]);
  if (!isNaN(lastDate.getTime())) {
    lastSnapshotTime = lastDate.getTime();  // ← Store timestamp
    updateStalenessDisplay();
  }
}
```

#### 4b. Refactored display updater
```javascript
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

#### 4c. Added 10-second timer in init
```javascript
function setupStalenessUpdateTimer() {
  stalenessUpdateTimer = setInterval(() => {
    if (lastSnapshotTime) {
      updateStalenessDisplay();
    }
  }, 10 * 1000); // Update every 10 seconds
}

function init() {
  // ... existing code ...
  setupStalenessUpdateTimer();  // ← Called from init
}
```

**Behavior:**
- Page load: "Last snapshot: ... (Just now)"
- Every 10 seconds: "1 min ago" → "2 min ago" → ... increments automatically
- No API calls, no fetching
- When user clicks "Sync Now" or auto-refresh triggers (future): `updateKPIsAndStaleness()` updates both timestamp and display immediately

**Impact:** Dashboard staleness always current within 10-second window. Improves perceived freshness without backend load.

---

### 10. **Button: Open Google Tasks List** ✅

**Status:** DONE

**File:** Index.html

**Change:** Added link button in `.header-actions`

```html
<a href="https://calendar.google.com/calendar/u/0/r/tasks" target="_blank" 
   class="btn btn-secondary" title="Open Google Tasks in Google Calendar">
  <span class="btn-icon">✓</span> Open Tasks
</a>
```

**Location:** In header toolbar, between "View Sheet" and "Reload Data"

**Behavior:**
- Clicks open Google Calendar Tasks view in new tab
- No RPC call, pure hyperlink
- Mobile-friendly: button stacks/wraps like others

**Impact:** One-click access to Google Tasks from dashboard.

---

## Remaining Planned Items

| # | Item | Files | Effort | Status | Notes |
|---|------|-------|--------|--------|-------|
| 3 | Auto-refresh (30m) | JavaScript.html | 15 min | ⏳ Ready | Timer + toggle + notification |
| 5 | Graph downsampling | JavaScript.html | 25 min | ⏳ Ready | Bin-based, smart target points |
| 6 | Configurable window | — | — | ⏸️ Deferred | Replaced by fixed 3-window (item 5 earlier) |
| 7 | 3-day range | Index.html | — | ✅ Done | Already in range filter |
| 8 | Fractional days | Code.js | — | ✅ Done | Removed floor() |
| 9 | Rolling average | JavaScript.html | 30+ min | ⏸️ Hold | Needs UX refinement, config |
| 11 | 6-month future filter | Code.js + JavaScript.html | 15 min | ⏳ Ready | Backend filter + UI note |

**Remaining effort: ~55 min** (items 3, 5, 11 + optional 9)

---

## File Deliverables (This Sprint)

1. **Styles_FINAL_v2.html** — CSS with item 1 fix (user-select: none on danger zone summary)
2. **Index_FINAL_v2.html** — HTML with items 2 (details not open) and 10 (Open Tasks button)
3. **JavaScript_FINAL_v2.html** — JS with item 4 (relative age auto-update timer + display refactor)

All files include all previous implementations (items 1-7 from earlier sprints).

---

## Next Immediate Steps

Recommended order for remaining items:

1. **Item 3 (auto-refresh)** — 15 min, commonly requested
2. **Item 11 (future-date filter)** — 15 min, improves metric accuracy
3. **Item 5 (graph downsampling)** — 25 min, performance + UX

Total: ~55 min for full feature set (excluding rolling average).

---

## Testing Checklist (Items 1, 2, 4, 10)

- [ ] 1. Click danger zone header: no blinking text cursor
- [ ] 2. Page load: danger zone starts collapsed (▼ points up)
- [ ] 2. Click danger zone: expands, arrow rotates down
- [ ] 4. Page load with data: "Last snapshot: ... (Just now)"
- [ ] 4. Wait 10 seconds without refreshing: "1 min ago" (no fetch)
- [ ] 4. Wait 60 seconds: "1 hr ago" (display updates, no fetch)
- [ ] 4. Click "Sync Now": timestamp updates immediately + display correct
- [ ] 10. "Open Tasks" button visible in header
- [ ] 10. Click button: opens Google Calendar Tasks in new tab
- [ ] 10. Mobile: button stacks/wraps with other buttons