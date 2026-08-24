## Implementation Plans

---

### 1. **Danger Zone Collapse Icon Rotation**

**Scope:** `Styles.html` only

**Plan:**
1. Locate `.danger-zone-summary` selector
2. Add sibling rule for `.summary-arrow` with CSS transitions
3. Apply `transform: rotate(180deg)` when parent `<details>` is `[open]`

**Changes:**
- Add CSS rule: 
  ```css
  .danger-zone-details[open] .summary-arrow {
    transform: rotate(180deg);
    transition: transform 0.2s ease;
  }
  ```
- Existing `.summary-arrow` gets base style with transition

**Result:** Arrow points down when expanded, up when collapsed.

---

### 2. **Mobile KPI Cards Hidden + Button Layout**

**Scope:** `Styles.html` only

**Plan:**
1. Add media query for `max-width: 768px`
2. Hide `.cards` section entirely
3. Adjust `.header-actions` to stack or wrap gracefully

**Changes:**
- Add to existing mobile media query:
  ```css
  @media (max-width: 768px) {
    .cards { display: none; }
    
    .header-actions {
      width: 100%;
      justify-content: space-between;
      gap: 8px;
    }
    
    .btn {
      flex: 1;
      justify-content: center;
      padding: 8px 10px;
      font-size: 12px;
    }
  }
  ```

**Result:** Cards gone on small screens. Buttons stretch evenly, wrap if needed.

---

### 3. **Add 3-Day Range Pill**

**Scope:** `Index.html` only

**Plan:**
1. Locate `rangeFilterGroup` div with existing range pills
2. Insert new pill before `<button data-range="7">`

**Changes:**
- Add single button:
  ```html
  <button class="pill" data-range="3" title="Filter chart to show snapshots from the past 3 days" onclick="DashboardApp.setRangeFilter(3)">3D</button>
  ```

**Result:** 3D, 7D, 14D, 30D, All time filters available. No JS changes needed (existing `setRangeFilter()` already generic).

---

### 4. **Fractional Days in Overdue Severity**

**Scope:** `Code.js` only

**Plan:**
1. Locate line 145 in `ingestTaskMetrics()` function
2. Remove `.floor()` call to preserve fractional days

**Changes:**
- Replace:
  ```javascript
  const daysOverdue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  ```
- With:
  ```javascript
  const daysOverdue = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  ```

**Result:** Severity scores use fractional day decay. E.g., 2.3 days overdue → √2.3 ≈ 1.52, instead of √2 ≈ 1.41. Smoother aging penalty.

---

### 5. **Display Throughput for 24h, 3d, 7d** ← Replaces configurable window

**Scope:** `Index.html` + `JavaScript.html`

**Plan:**

#### 5a. HTML Changes (`Index.html`)
1. Replace single-line `kpiVelocitySubtext` with 3-line display showing all windows
2. Show throughput in "Completed in List" card with stacked text

**Changes:**
- Replace:
  ```html
  <div class="subtext" id="kpiVelocitySubtext">7d Velocity: - /day</div>
  ```
- With:
  ```html
  <div class="subtext-multi" id="kpiVelocitySubtext">
    <div id="velocity1d">24h: -</div>
    <div id="velocity3d">3d: -</div>
    <div id="velocity7d">7d: -</div>
  </div>
  ```

#### 5b. Styles (`Styles.html`)
Add CSS for multi-line subtext:
```css
.subtext-multi {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.3;
}
```

#### 5c. JavaScript Changes (`JavaScript.html`)
1. Rewrite `calculateVelocity()` to compute 3 windows independently
2. Each window uses actual elapsed time, not fixed divisor
3. Update text for each window separately

**Changes:**
```javascript
function calculateVelocity(rows) {
  const now = Date.now();
  const windows = [
    { label: '24h', ms: 1 * 24 * 60 * 60 * 1000, elemId: 'velocity1d' },
    { label: '3d', ms: 3 * 24 * 60 * 60 * 1000, elemId: 'velocity3d' },
    { label: '7d', ms: 7 * 24 * 60 * 60 * 1000, elemId: 'velocity7d' }
  ];

  windows.forEach(window => {
    const cutoff = now - window.ms;
    const windowRows = rows.filter(r => new Date(r[0]).getTime() >= cutoff);

    if (windowRows.length >= 2) {
      const oldestCompleted = windowRows[0][2];
      const newestCompleted = windowRows[windowRows.length - 1][2];
      const completedDiff = Math.max(0, newestCompleted - oldestCompleted);
      
      // Actual elapsed time between oldest and newest snapshot in this window
      const oldestTime = new Date(windowRows[0][0]).getTime();
      const newestTime = new Date(windowRows[windowRows.length - 1][0]).getTime();
      const elapsedMs = Math.max(1, newestTime - oldestTime);
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
      
      const ratePerDay = (completedDiff / elapsedDays).toFixed(1);
      setElemText(window.elemId, window.label + ': ~' + ratePerDay + '/day');
    } else {
      setElemText(window.elemId, window.label + ': -');
    }
  });
}
```

**Result:** 
- Card shows 3 throughput numbers stacked: "24h: 2.3/day", "3d: 1.8/day", "7d: 1.5/day"
- Each uses actual elapsed time between snapshots in that window
- No dropdown, no configuration—always visible

---

### 6. **Graph Smoothing (Data Downsampling)**

**Scope:** `JavaScript.html` only (frontend filtering before chart render)

**Plan:**
1. Extract data filtering logic from `drawStackedLineComboChart()` into new helper `downSampleData()`
2. Detect viewport width and active range
3. Apply Douglas-Peucker or binned downsampling
4. Feed downsampled data to Google Charts

**Changes:**

Add downsampling helper before `drawStackedLineComboChart()`:
```javascript
function downSampleData(rows, targetPoints) {
  if (rows.length <= targetPoints) return rows;

  // Bin-based downsampling: divide into buckets, keep max per bucket
  const bucketSize = Math.ceil(rows.length / targetPoints);
  const sampled = [];

  for (let i = 0; i < rows.length; i += bucketSize) {
    const bucket = rows.slice(i, Math.min(i + bucketSize, rows.length));
    if (bucket.length > 0) {
      // Keep the last point in each bucket (most recent data in time range)
      sampled.push(bucket[bucket.length - 1]);
    }
  }

  return sampled.length > 0 ? sampled : [rows[rows.length - 1]];
}
```

Modify `drawStackedLineComboChart()` opening:
```javascript
function drawStackedLineComboChart() {
  if (!rawData || !rawData.rows || rawData.rows.length === 0) return;

  const chartContainer = document.getElementById('mainChart');
  const containerWidth = chartContainer.offsetWidth;
  
  // Calculate target points based on viewport width and range
  let targetPoints = Math.min(150, Math.max(40, Math.floor(containerWidth / 5)));
  if (activeRangeDays <= 7) targetPoints = Math.min(200, rawData.rows.length); // No smooth for 7d or less
  
  const filteredRows = filterDataByRange(rawData.rows, activeRangeDays);
  const smoothedRows = downSampleData(filteredRows, targetPoints);

  // ... rest of chart building code, use smoothedRows instead of filteredRows
}
```

**Result:** 
- 7d range: all points shown (no smoothing, detailed view)
- 30d range: ~150 points max (removes every 3rd-4th point)
- All time: adaptive to viewport width

---

## Updated Requirements Section

Replace the "Next steps and features" section with:

```markdown
## Next Steps and Implementation Status

### Completed / Planned

1. ✅ **Graph Smoothing**: Implement frontend downsampling (Douglas-Peucker or binned) 
   to reduce plotted points when viewing large date ranges (30d, all time). 
   Recent ranges (7d or less) show all data points for detail.

2. ✅ **Button Formatting on Mobile**: Responsive CSS for header action buttons 
   (stack or flex-wrap on screens < 768px).

3. ✅ **Mobile: Hide KPI Cards**: Display: none for .cards section below 768px viewport.

4. ✅ **Danger Zone Collapse Icon**: CSS transform rotation on <details>[open] state 
   (arrow points down when expanded, up when collapsed).

5. ✅ **Throughput Display (3 Windows)**: Show completion velocity in three fixed windows:
   - 24h throughput (/day)
   - 3d throughput (/day)  
   - 7d throughput (/day)
   
   All three computed using **actual elapsed time** between oldest and newest snapshots 
   in each window (not fixed divisors). Displayed stacked in the "Completed in List" KPI card.

6. ✅ **Add 3-Day Range Pill**: Include "3D" as quick-select range filter option 
   (joins existing 7D, 14D, 30D, All).

7. ✅ **Fractional Days in Overdue Severity**: Remove floor() rounding when calculating 
   days overdue. Allows partial-day decay in √days severity score 
   (e.g., 2.3 days → √2.3 ≈ 1.52 instead of √2.0 ≈ 1.41).
```

---

## Summary Table

| Item | Files | Effort | Notes |
|------|-------|--------|-------|
| 1. Collapse icon rotation | Styles.html | 2 min | CSS only |
| 2. Mobile button layout | Styles.html | 5 min | CSS only |
| 3. Add 3D range pill | Index.html | 1 min | HTML only |
| 4. Fractional days severity | Code.js | 1 min | 1-line change |
| 5. **Multi-window throughput** | Index.html + Styles.html + JavaScript.html | **15 min** | Replaces single 7d window |
| 6. Graph smoothing | JavaScript.html | 25 min | Downsampling algorithm |
| **TOTAL** | — | **~50 min** | No backend logic changes |
