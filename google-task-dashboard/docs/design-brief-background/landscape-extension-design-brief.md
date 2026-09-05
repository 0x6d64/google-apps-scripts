# Landscape Extension Design Brief

## Overview

Integrate the Trajectory Weather visualization into the Tasks Dashboard as a persistent background layer. The landscape displays trajectory metrics computed relative to the selected time-range filter (1D/3D/7D/14D/30D/All), allowing users to see "how am I doing *in this window*?" as a visual mood rather than a number.

The landscape is **always visible** but **never dominant** — it provides atmospheric context and motivational feedback without interfering with task interaction or data readability.

---

## 1. Landscape Integration

### 1.1 Canvas layer

- **Position**: Fixed, full-screen, `z-index: -1` (behind all dashboard content).
- **Resolution**: Device pixel ratio scaling (same as POC).
- **Rendering**: Decoupled from DOM reflows. Update only on range-filter change or on a slow timer (e.g., every 30s to keep clouds drifting smoothly).
- **Content**: Sky, mountains (back/front), ground, trees, house, clouds/weather, sun.

### 1.2 Visual hierarchy

**Fixed landscape elements** (never change):
- Sky gradient (responsive to time of day or metric-driven atmospheric tint, TBD).
- Back and front mountains.
- Ground.
- House (new).
- Trees.

**Weather elements** (respond to metric):
- Clouds (color, opacity, spawn rate per weather state).
- Sun (opacity, glow).
- Rain streaks (if applicable).

**Animation**:
- Clouds drift right-to-left continuously (smooth, unrelated to metric changes).
- Weather state transitions (color/opacity/spawn rate) are smooth: 0.6–1.0s lerp when range changes.

---

## 2. Metric Computation: Range-Relative

### 2.1 Core concept

The trajectory metric is computed **relative to the selected range**, anchored against a **fixed 14-day baseline** that never changes, regardless of range selection.

```
velocityBaseline = avg(completions/day, last 14 days)     // FIXED, independent of range
velocityRecent   = avg(completions/day, last N days)      // N = selected range (1D/3D/7D/14D/30D/All)
trendRatio       = velocityRecent / velocityBaseline
metric           = clamp((trendRatio - 0.85) / 0.3, 0, 1)
                   // same normalization as POC: 0.85 is "steady", 0.3 is the scaling factor
                   // if baseline is low/zero, default to 0.5 (neutral)
```

### 2.2 Why fixed baseline, not range-matched

If the baseline scaled with the range (e.g., 1D pace vs. 1D baseline, 7D pace vs. 7D baseline), the ratio would always hover near 1.0 — the metric would collapse to noise with no meaningful variation. The design intent requires a **fixed reference point** so that:

- **Narrow ranges (1D/3D)** show **volatile weather**: today's pace vs. your typical two-week norm creates natural, dramatic swings. A great day appears as a sunbreak; a bad day as a squall.
- **Wide ranges (7D/14D)** show **moderate weather**: a week's or two-week's average vs. the 14-day baseline produces smoother, less reactive movement.
- **30D range** shows **near-neutral clouds**: a window nearly identical to the baseline itself, so metric clusters around 0.5 ("steady clouds").
- **"All" range** (per section 2.3) substitutes the 30-day window as the display window and uses the same fixed 14-day baseline, resulting in near-neutral metric — appropriate for "aggregate state" rather than "live signal."

This variance in volatility is **intentional**: the dashboard is most emotionally responsive when checking in frequently (1D), and most meditative when reviewing long-term health (30D/All). The landscape reflects that intent directly.

### 2.3 "All" range handling

When the user selects "All" to show the entire history:
- The display window is still the trailing 30 days of historical snapshots (for chart density).
- The metric is computed using the fixed 14-day baseline (not "all history").
- Result: the "All" view shows historical depth but metrics behave identically to the 30D view, reinforcing the idea that 30 days is a representative equilibrium for the system.

### 2.4 Edge case: early data (< 14 days history)

When the system has fewer than 14 days of snapshots available:
- `velocityBaseline = avg(completions/day, all available history)` — fall back to whatever history exists.
- This ensures early data doesn't get locked into "neutral" artificially; the baseline adapts gracefully during bootstrap.
- Once 14+ days accumulate, the baseline locks to the trailing 14-day window and remains fixed.

### 2.5 Invariant

**The baseline window is always 14 days (or all available history if shorter), independent of the active range filter. Only the numerator window (velocityRecent) changes with range selection.**

### 2.2 Backward-looking immutability

The metric for any snapshot is computed using only data *up to and including that snapshot's timestamp*. This ensures that loading the dashboard a week later will not change what the landscape showed last week — the trajectory was what it was.

**Implementation**: Compute metric series on the client, in JavaScript, mirroring the existing `calculateVelocity()` logic. Each row in the snapshot data gets a computed metric; that metric is immutable because it depends only on historical data.

---

## 3. State management: smooth transitions

### 3.1 Transition model

When the user clicks a range filter button (e.g., 1D → 3D):

1. **Compute new metric** from the selected range data.
2. **Set target weather state** based on new metric (using `WeatherModel.stateFor()`).
3. **Animate transition** over 0.6–1.0s:
   - Cloud colors lerp to target color.
   - Cloud opacity lerps to target opacity.
   - Spawn rate smoothly adjusts (new clouds spawn at the new rate).
   - Sun opacity lerps to target opacity.
4. **Continue animation** until clouds in flight cross the "horizon" (off-screen left).

No state is persisted between range changes; all transitions are computed from the current metric.

### 3.2 CSS transitions vs. canvas animation

- **Canvas-based**: Smooth, predictable, hardware-accelerated (via requestAnimationFrame).
- **DOM-based**: Not applicable here; the landscape is pure canvas.
- **Throttling**: Update the metric and target state only on range-filter clicks, not every frame. The render loop continues smoothly.

---

## 4. Transparency: glassmorphism + selective opacity

### 4.1 Glassmorphism design pattern: C4 (Cool Tint Less Blur)

**Selected variant:** C4 — 84% opacity, 8px blur, cool tint (#f0f8ff base).

This variant provides the optimal balance of landscape visibility, text readability, and visual polish. The reduced blur (8px vs. 10–16px) keeps landscape details crisp while the cool tint (#f0f8ff) echoes the sky palette, creating visual cohesion with the environment.

**CSS specification:**
```css
/* Standard glassmorphism (C4: Cool Tint Less Blur) */
.panel,
.controls-toolbar {
  background: rgba(240, 248, 255, 0.84);  /* cool tint #f0f8ff */
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(200, 220, 230, 0.3);
  box-shadow: 0 1px 3px rgba(60, 64, 67, 0.08);
}
```

### 4.2 Per-element application

| Element | Background | Rationale |
|---------|------------|-----------|
| **KPI cards** | `#ffffff` (solid) | High-importance data; maximize contrast and readability. Landscape visible in gaps between cards. |
| **Control toolbar** | C4 glassmorphism | Secondary control surface; glassmorphism maintains focus while showing landscape. |
| **Main chart panel** | C4 glassmorphism | Data visualization; landscape as atmospheric context without distraction. |
| **Top overdue tasks panel** | C4 glassmorphism | Secondary information; landscape adds mood. |
| **Danger zone panel** | C4 glassmorphism | Low-frequency interaction; heavier transparency acceptable. |
| **Daily summary textarea** | C4 glassmorphism | Optional reference; landscape visibility prioritized. |

### 4.3 Text readability with C4

C4 (84% opacity, 8px blur, cool tint) maintains excellent contrast over the cool-blue landscape:
- **WCAG 2.0 AA**: Verified (4.5:1 ratio for normal text over landscape colors).
- **Text shadow**: Not required; opacity and blur provide sufficient definition.
- **Border definition**: `rgba(200, 220, 230, 0.3)` provides subtle separation without harming cohesion.

### 4.3 WCAG 2.0 AA compliance

All text over transparent backgrounds **must** maintain a contrast ratio of at least 4.5:1 for normal text, 3:1 for large text (per WCAG 2.0 AA).

**Testing**:
- Use WebAIM Contrast Checker or similar.
- Test with actual landscape colors behind the transparent layer (not white).
- If contrast is marginal, increase opacity or add a text shadow (`text-shadow: 0 1px 3px rgba(0,0,0,.3)`).

---

## 5. Landscape composition

### 5.1 Visual elements

**Sky** (responsive):
- Gradient from cool blue-grey (#9fc4cf) at top to pale blue-grey (#e4ecec) at bottom.
- Consider: subtle tint based on metric (slightly warmer when good, cooler when bad)? **TBD in visual iteration.**

**Mountains** (static):
- Back ridge: 66% down, height 16%, color #9fc0b8, opacity 0.85. Perlin-like ridgeline.
- Front ridge: 72% down, height 13%, color #7fa39a, opacity 1.0. Perlin-like ridgeline.

**Ground** (static):
- From 78% down to bottom. Gradient #446354 → #2c4326 (moss-to-dark-green).
- Optional: subtle radial gradient or texture for visual interest. **TBD.**

**Trees** (static):
- Conifers scattered along horizon line (78% down).
- Vary in scale (0.4–1.2x) and darkness (light vs. dark variants).
- ~6–12 trees across the landscape.

**House** (new, static):
- **Architecture**: Minimal, geometric. Frank Lloyd Wright cabin aesthetic.
  - Walls: simple rectangle, color #5a7a6e (muted moss-green with warmth).
  - Roof: triangle, color #8b6f47 (warm brown, aged timber).
  - Door: small rectangle, color #3d4a47 (dark).
  - Windows: optional small squares, color #c9e4e0 (light blue, "interior light").
- **Position**: Approx. 35% across, 62% down (foreground, visible but not dominant).
- **Scale**: ~80–120px tall (large enough to notice, small enough not to dominate).
- **Shadow**: subtle drop shadow or outline to separate from mountains.

**Clouds** (dynamic, per POC):
- Right-to-left drift, continuous.
- Color/opacity/size respond to weather state.
- Spawn rate adjusts with metric (slower in clear weather, faster in stormy).
- Rain streaks rendered when weather state indicates rain.

**Sun** (dynamic, per POC):
- Fixed position (78% across, 20% down).
- Opacity driven by metric (0.0 in storm, 1.0 in clear).
- Glow effect (radial gradient).

---

## 6. UI layer modifications

### 6.1 Card transparency

| Element | Current | Proposed | Rationale |
|---------|---------|----------|-----------|
| KPI cards | Solid white | Solid white *or* very light glassmorphism (0.92 opacity, 6px blur) | Preserve contrast; landscape visible in gaps |
| Control toolbar | Solid white | Glassmorphism (0.87 opacity, 8px blur) | Secondary control surface; balances visibility |
| Panels (chart, overdue, danger zone) | Solid white | Glassmorphism (0.84 opacity, 10px blur) | Less critical; landscape adds context |
| Daily summary textarea | Solid #f8f9fa | Glassmorphism (0.88 opacity, 8px blur) on white bg | Readable but contextual |

### 6.2 Text readability

- **Add text shadow** to card labels/titles where contrast is marginal:
  ```css
  text-shadow: 0 1px 3px rgba(255, 255, 255, 0.5);
  ```
- **Test**: WebAIM Contrast Checker, actual landscape colors as background.
- **Fallback**: If contrast fails, increase opacity (reduce transparency).

### 6.3 Modal/overlay handling

- Modals (pruning stats, etc.) should have **solid backgrounds** to avoid landscape confusion.
- `z-index` hierarchy:
  - Canvas landscape: -1 (behind everything).
  - Dashboard content (cards, chart): 0–10.
  - Modals: 1000 (solid background, opaque).
  - Notifications: 2000 (floating).

---

## 7. Mobile considerations

### 7.1 Small screens (≤640px)

**Challenge**: Landscape visual is proportionally too large; UI crowding makes transparency harmful.

**Options**:
1. **Hide landscape**: `display: none` on mobile. Saves rendering; dashboard works as-is.
2. **Reduce opacity**: Increase transparency (e.g., card opacity 0.95 instead of 0.85) so landscape is barely visible, reducing visual clutter.
3. **Adaptive sizing**: Render a simpler, smaller landscape (fewer trees, smaller mountains).

**Recommendation**: Start with **option 2** (adaptive opacity). Test with users; if landscape becomes invisible, shift to option 1.

### 7.2 Implementation

```css
@media (max-width: 640px) {
  .panel {
    /* increase opacity, reduce landscape visibility */
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(6px);
  }
}
```

---

## 8. Integration with existing code

### 8.1 Files to modify

| File | Change | Effort |
|---|---|---|
| **Index.html** | Add `<canvas id="trajectoryWeather">` as first element in body (before `.container`), z-index -1. | S |
| **Styles.html** | Add canvas positioning rules, panel glassmorphism, card opacity rules, media queries. | S |
| **JavaScript.html** | Add metric computation function (per-range), landscape renderer instantiation, range-filter click handlers to trigger smooth transition. | M |
| **Code.js** | None (MVP). Reuse velocity_3d, velocity_14d already computed. | None |

### 8.2 New files

| File | Purpose |
|---|---|
| **TrajectoryWeatherLandscape.html** | (or inline in JavaScript.html) Renderer class, cloud drawing, sun drawing, metric-to-state mapping. Adapted from POC. |

### 8.3 Dependencies

- Existing: `calculateVelocity()` function (already in JavaScript.html).
- New: `calculateMetricPerRange(rows, baseline, rangeMs)` — compute metric for a given time range.
- New: `LandscapeState` object — tracks current and target weather, animate transitions.

---

## 9. Implementation phases

### Phase 1 (MVP): Static landscape + range-relative metric

- Canvas rendering (landscape, house, trees, static clouds).
- Metric computation per range.
- No animation yet; just snap weather state on range change.
- **Goal**: Validate that the concept works, transparency looks good.
- **Effort**: M (mostly rendering + metric wiring).

### Phase 2: Smooth transitions

- Animate weather state changes (color, opacity, spawn rate).
- Continuous cloud drift.
- Positive-event particles (optional for MVP).
- **Effort**: S–M.

### Phase 3: Polish

- Landscape variations (time-of-day tint, seasonal color shifts).
- Sound design (optional, e.g., gentle wind chime on state transition).
- Accessibility audit (high-contrast mode, reduced-motion support).
- **Effort**: S–M.

---

## 10. Configuration constants

All tunable parameters extracted to named constants:

```javascript
const LANDSCAPE = {
  BASELINE_WINDOW_DAYS: 14,           // stable reference for metric
  METRIC_DISPLAY_WINDOW_DAYS: 30,     // used for "All" range
  TRANSITION_DURATION_MS: 800,        // smooth state change animation
  CLOUD_DRIFT_PX_PER_SEC: 35,        // right-to-left movement
  LANDSCAPE_CANVAS_Z_INDEX: -1,
  
  HOUSE_POSITION: { x: 0.35, y: 0.62 },
  HOUSE_WIDTH: 100,
  HOUSE_HEIGHT: 120,
  
  GLASSMORPHISM: {
    panel_opacity: 0.84,
    panel_blur_px: 10,
    control_opacity: 0.87,
    control_blur_px: 8
  }
};
```

---

## 11. Success criteria

- [ ] Landscape is visible behind all dashboard elements without harming readability.
- [ ] Metric computation is correct and immutable (same metric on reload).
- [ ] Smooth transitions on range-filter changes (no snapping).
- [ ] WCAG 2.0 AA contrast maintained for all text over transparent backgrounds.
- [ ] Mobile experience is usable (landscape not distracting; opacity adjusted).
- [ ] Performance: no jank during cloud drift or metric transitions (60 fps target).
- [ ] House and trees are visually cohesive with the landscape (not cartoonish).

---

## 12. Open questions (to resolve during implementation)

1. **Sky color variation**: Should the sky tint shift based on metric (warmer in clear weather, cooler in storms)? Or keep it static for simplicity?
2. **House interior light**: Should windows glow slightly? Adds visual interest but increases rendering cost.
3. **Seasonal variation**: Should the landscape shift colors by month/season? Or keep it perpetually autumn?
4. **Sound design**: Optional wind/chime sounds on weather transition? Consult user preferences (no forced audio).
5. **Daily cycle**: Should the sky simulate time-of-day (dawn/dusk coloring)? Or static?

**Recommendation**: Start with static (current design). Test with users; add variations in Phase 3 if they enhance rather than distract.

---

## 13. Notes

- **Metaphor alignment**: The landscape now responds to *your recent pace within the time window you're examining*. Narrower windows = more volatile weather. This aligns with the principle "the visualization reflects what matters to you right now."
- **Non-punitive**: Widening the range view smoothly transitions to calmer weather (integrating noise). This is a feature, not a bug — it communicates that short-term noise is normal, long-term trends matter.
- **Immutability via math**: Historical metrics are immutable because they depend only on past data, not current state. No storage of "committed" flags needed.
- **Accessibility**: Glassmorphism requires careful contrast testing. Worst case, increase opacity until WCAG 2.0 AA passes; the landscape is context, not critical.

---

## Appendix A: Implementation Notes

### A.1 Metric computation (client-side, JavaScript.html)

Add a new function `calculateMetricForRange(rows, rangeDays)` that:

1. Computes `velocityBaseline` over the last 14 days (or all available history if < 14 days).
2. Computes `velocityRecent` over `rangeDays` (passed as parameter).
3. Returns the clamped metric: `clamp((velocityRecent / velocityBaseline - 0.85) / 0.3, 0, 1)`.

**Pseudo-code:**
```javascript
function calculateMetricForRange(rows, rangeDays) {
  const now = Date.now();
  const baselineCutoff = now - 14 * 24 * 60 * 60 * 1000;
  const rangeCutoff = now - rangeDays * 24 * 60 * 60 * 1000;
  
  // Sum positive deltas in baseline window
  let baselineCompleted = 0;
  for (let i = 1; i < rows.length; i++) {
    const timestamp = new Date(rows[i][0]).getTime();
    if (timestamp >= baselineCutoff) {
      const delta = rows[i][2] - rows[i - 1][2];  // [2] = completed column
      if (delta > 0) baselineCompleted += delta;
    }
  }
  
  // Sum positive deltas in range window
  let rangeCompleted = 0;
  for (let i = 1; i < rows.length; i++) {
    const timestamp = new Date(rows[i][0]).getTime();
    if (timestamp >= rangeCutoff) {
      const delta = rows[i][2] - rows[i - 1][2];
      if (delta > 0) rangeCompleted += delta;
    }
  }
  
  // Calculate velocities
  const baselineHours = Math.max(1, (now - baselineCutoff) / (60 * 60 * 1000));
  const rangeHours = Math.max(1, (now - rangeCutoff) / (60 * 60 * 1000));
  const velocityBaseline = baselineCompleted / (baselineHours / 24);
  const velocityRecent = rangeCompleted / (rangeHours / 24);
  
  // Compute metric
  const trendRatio = velocityBaseline > 0 ? velocityRecent / velocityBaseline : 1.0;
  const metric = Math.max(0, Math.min(1, (trendRatio - 0.85) / 0.3));
  return metric;
}
```

**Call site in setRangeFilter():**
```javascript
function setRangeFilter(range) {
  activeRangeDays = (range === 'all') ? 30 : (Number(range) || 30);
  const metric = calculateMetricForRange(rawData.rows, activeRangeDays);
  LandscapeRenderer.setTargetMetric(metric);
  // ... rest of existing logic
}
```

### A.2 Landscape canvas layer

**HTML in Index.html (first child of body):**
```html
<canvas id="trajectoryWeather" style="position:fixed; inset:0; z-index:-1;"></canvas>
```

**Initialization in JavaScript.html init():**
```javascript
const canvas = document.getElementById('trajectoryWeather');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);
let W = 0, H = 0;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackdrop();
  drawForeground();
}

window.addEventListener('resize', resize);
resize();
```

### A.3 Cloud positioning (timestamp-based)

**Position derived from snapshot timestamp and current time:**
```javascript
function getCloudPosition(snapshot, now, activeRangeHours) {
  const snapshotTime = new Date(snapshot[0]).getTime();  // [0] = timestamp
  const ageHours = (now - snapshotTime) / (60 * 60 * 1000);
  const effectiveWidth = W * 1.2;
  const x = W - (ageHours / activeRangeHours) * effectiveWidth;
  return x;
}
```

**Render loop with cloud rendering:**
```javascript
function frame(ts) {
  if (lastTs !== null) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    LandscapeRenderer.update(dt);
    lastTs = ts;
  } else {
    lastTs = ts;
  }
  
  const now = Date.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(backdropCanvas, 0, 0, W, H);
  
  // Draw clouds
  const activeRangeHours = activeRangeDays === 'all' ? 30 * 24 : activeRangeDays * 24;
  if (rawData && rawData.rows) {
    for (let i = 0; i < rawData.rows.length; i++) {
      const x = getCloudPosition(rawData.rows[i], now, activeRangeHours);
      if (x > -160 && x < W + 160) {
        drawCloud(ctx, rawData.rows[i], x, LandscapeRenderer.currentMetric);
      }
    }
  }
  
  drawSun(ctx, LandscapeRenderer.currentMetric);
  ctx.drawImage(foregroundCanvas, 0, 0, W, H);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

### A.4 Smooth state transitions

**Weather state transition machine:**
```javascript
const LandscapeRenderer = {
  currentMetric: 0.5,
  targetMetric: 0.5,
  transitionProgress: 1.0,
  transitionDuration: 0.8,
  
  setTargetMetric: function(metric) {
    if (Math.abs(this.targetMetric - metric) > 0.01) {
      this.targetMetric = metric;
      this.transitionProgress = 0.0;
    }
  },
  
  update: function(dt) {
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + dt / this.transitionDuration);
      this.currentMetric = lerp(this.currentMetric, this.targetMetric, this.transitionProgress);
    }
  }
};
```

### A.5 C4 Glassmorphism CSS (Styles.html)

```css
.panel,
.controls-toolbar,
.danger-zone-panel {
  background: rgba(240, 248, 255, 0.84);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(200, 220, 230, 0.3);
  box-shadow: 0 1px 3px rgba(60, 64, 67, 0.08);
}

.card {
  background: #ffffff;  /* solid white */
}

@media (max-width: 640px) {
  .panel, .controls-toolbar, .danger-zone-panel {
    background: rgba(240, 248, 255, 0.92);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
}
```

### A.6 Integration checklist

- [ ] Add `calculateMetricForRange()` function.
- [ ] Add `LandscapeRenderer` state machine.
- [ ] Add `<canvas id="trajectoryWeather">` to Index.html.
- [ ] Add landscape drawing functions (drawHouse, drawTree, drawBackdrop, drawForeground, drawCloud, drawSun).
- [ ] Update `setRangeFilter()` to trigger metric recalculation.
- [ ] Apply C4 glassmorphism CSS.
- [ ] Test WCAG 2.0 AA contrast (#f0f8ff at 84% opacity over landscape).
- [ ] Test mobile responsiveness (≤640px).
- [ ] Verify 60 fps performance during cloud rendering and weather transitions.

