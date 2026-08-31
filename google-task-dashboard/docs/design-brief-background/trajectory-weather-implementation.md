# Trajectory Weather — Implementation Design

## Overview

Trajectory Weather is a visual metaphor for task-completion trajectory, rendered as an animated landscape and weather system. The visualization separates the **mutable future** (weather currently forming) from the **immutable past** (weather already observed), making it clear that future outcomes can change while history cannot.

This document formalizes the proof-of-concept architecture, modules, and integration patterns for production use.

---

## 1. Core Modules

### 1.1 Metric Source

**Responsibility:** Produce a normalized trajectory metric and track its delta.

**Interface:**
```javascript
{
  value: Number in [0, 1],        // current trajectory assessment
  lastDelta: Number,              // change from prior value
  applyDelta(d: Number): void,    // apply signed change
  randomize(): void               // for testing; apply random delta
}
```

**Semantics:**
- `0.0` = strongly negative trajectory (e.g., velocity declining sharply)
- `0.5` = neutral / steady trajectory (velocity stable)
- `1.0` = strongly positive trajectory (e.g., velocity improving)

**Constraints:**
- Must clamp to `[0, 1]`.
- Must calculate `lastDelta` as `nextValue - currentValue`.
- Must not apply domain-specific logic (e.g., no ETA or overdue calculations here).

**Production mapping (placeholder for later integration):**
When wired to task data, the metric shall be calculated as:
```
trendRatio = velocityShort / velocityBaseline
  where:
    velocityShort = avg(completions/day, last 3d)
    velocityBaseline = avg(completions/day, last 14d)
metric = clamp((trendRatio - 0.85) / 0.3, 0, 1)
```
This keeps the metric centered at 0.5 for steady state (1:1 velocity), and is immune to due-date shuffling and task-count inflation.

---

### 1.2 Weather Model

**Responsibility:** Map metric values to discrete weather states.

**States (thresholds configurable):**

| Metric Range | State    | Label           | Cloud Color | Opacity | Spawn Rate | Rain |
|--------------|----------|-----------------|-------------|---------|-----------|------|
| [0.0, 0.20)  | storm    | storm           | #3c4750     | 0.72    | slow      | yes  |
| [0.20, 0.40) | heavy    | heavy clouds    | #556169     | 0.58    | moderate  | yes  |
| [0.40, 0.60) | steady   | steady clouds   | #93a2a8     | 0.40    | moderate  | no   |
| [0.60, 0.78) | clearing | clearing        | #d6e0e0     | 0.20    | fast      | no   |
| [0.78, 1.0]  | clear    | clear           | #f2f6f6     | 0.07    | very fast | no   |

**Interface:**
```javascript
{
  stateFor(metric: Number): WeatherState,
  thresholds: { storm, heavy, steady, clearing }  // configurable
}
```

**Properties of WeatherState:**
```javascript
{
  key: String,                    // 'storm', 'heavy', 'steady', etc.
  label: String,                  // user-facing label
  color: String (hex),            // target cloud color
  opacityMid: Number,             // target cloud opacity
  sizeMid: Number,                // target cloud size (px)
  vxRange: [Number, Number],      // velocity range (px/s)
  spawnMs: [Number, Number],      // spawn interval range (ms)
  rain: Boolean                   // whether to render rain streaks
}
```

**Behavior:**
- Pure, stateless mapping. No side effects.
- Returns the same state for the same metric across multiple calls.
- Thresholds are designed to be asymmetric: recovery (rising) is faster than degradation (falling) to encourage momentum.

---

### 1.3 Staging System (Mutable Future)

**Responsibility:** Manage cloud elements currently forming, apply live metric changes to them, and hand off committed elements to history.

**Elements:** Cloud objects spawned at the right edge of the scene.

**Cloud properties:**
```javascript
{
  x: Number,                      // horizontal position
  y: Number,                       // vertical position
  size: Number,                    // diameter (px)
  opacity: Number,                 // alpha [0, 1]
  colorHex: String,               // current color
  vx: Number,                      // pixels per second (right-to-left)
  rain: Boolean,                   // render rain streaks
  bobPhase: Number,               // sine-wave bobbing phase
  bobAmp: Number,                 // bobbing amplitude
  bobSpeed: Number,               // bobbing frequency
  seed: Number                    // per-cloud randomness
}
```

**Lifecycle:**
1. **Spawn** at right edge (`x = W + offset`) with random properties derived from the current weather state.
2. **Mutable phase** while `x > commitX`:
   - Every frame, morph `colorHex`, `opacity`, `size` toward the *live* weather state (continuously, via lerp).
   - Move left via `x -= vx * dt`.
   - Apply vertical bobbing (sinusoidal).
3. **Commit** when `x <= commitX`:
   - Freeze current visual properties.
   - Hand the element to `HistorySystem`.
   - Remove from staging.

**Spawn logic:**
- Every frame, accumulate time into a spawn timer.
- When timer expires, spawn one cloud from current state's `spawnMs` range.
- Reset timer to a new random value from that range.
- This produces organic, variable spawn intervals rather than fixed ticks.

**Color/opacity/size morphing:**
```javascript
// Per frame, for each staged cloud:
targetState = WeatherModel.stateFor(MetricSource.value)
cloud.colorHex = lerp(cloud.colorHex, targetState.color, 1.1 * dt)
cloud.opacity = lerp(cloud.opacity, targetState.opacityMid, 1.1 * dt)
cloud.size = lerp(cloud.size, targetState.sizeMid, 0.6 * dt)
```

This means that when the metric improves, existing staged clouds gradually shift color and disappear rather than snapping. When it worsens, new darker clouds gradually appear. Transitions feel natural, not jarring.

---

### 1.4 History System (Immutable Past)

**Responsibility:** Store and animate committed weather elements. Guarantee immutability.

**Elements:** Cloud objects that have crossed the commit boundary (`x <= commitX`).

**Lifecycle:**
1. **Receive** a committed cloud from staging (its current visual state is frozen).
2. **Move left** every frame via `x -= vx * dt` (same velocity as staging).
3. **Never modify** visual properties (color, opacity, size, rain).
4. **Leave the scene** when `x < -160` (off-screen left edge). Remove from history.

**Invariant:**
- Once an element is in history, it is read-only. No code path modifies it.
- Historical weather reflects the actual metric state *at the time it was committed*, not the current state.
- This is the core of the metaphor: the past is unchangeable, even if the future improves dramatically.

---

### 1.5 Sun (Fixed Environmental Element)

**Responsibility:** Provide a single, unique positive-weather signal independent of mutable clouds.

**Properties:**
```javascript
{
  x: Number, y: Number, r: Number,   // position and radius (fixed)
  opacity: Number,                    // [0, 1], driven by metric
  targetOpacity: Number
}
```

**Behavior:**
- Position is fixed at 78% across, 20% down the screen (layout phase, never changes).
- Opacity smoothly interpolates based on metric:
  ```javascript
  targetOpacity = smoothstep(0.55, 0.85, metric)
  opacity = lerp(opacity, targetOpacity, 1.4 * dt)
  ```
- At `metric >= 0.85`, sun is fully opaque and unmissable.
- At `metric <= 0.55`, sun fades to nearly invisible.
- No sun duplication: the same sun object is drawn every frame, with opacity reflecting the trajectory.

---

### 1.6 Positive-Event Particles

**Responsibility:** Provide immediate, non-punitive feedback on individual completions.

**Properties (per particle):**
```javascript
{
  x: Number, y: Number,       // position
  vy: Number,                 // upward velocity (px/s)
  drift: Number,              // horizontal drift (px/s)
  life: Number, maxLife: Number,  // age tracking
  size: Number,               // radius
  hue: Number                 // HSL hue
}
```

**Trigger:**
- When metric increases (positive delta), burst a small number of particles.
- Burst size scales with delta magnitude: small gain → 1 particle, big gain → 3 particles.

**Animation:**
- Float upward (`y -= vy * dt`).
- Drift horizontally (`x += drift * dt`).
- Fade out as `life` approaches `maxLife`.
- Disappear when `life >= maxLife`.

**Visual:**
- Glowing firefly-like particles (warm hues, 42–58°).
- Glow effect via `shadowBlur`.
- Always positive in tone, independent of overall weather state.

---

### 1.7 Landscape (Cached)

**Responsibility:** Provide static visual context (mountains, ground, trees).

**Composition:**
- **Sky gradient:** top (#9fc4cf) to bottom (#e4ecec). Never darkened by metric.
- **Back mountains:** ridgeline at 66% down, height 16% of screen, opacity 0.85, color #9fc0b8. Generated once via Perlin-like interpolation over seeded random points.
- **Front mountains:** ridgeline at 72% down, height 13% of screen, opacity 1.0, color #7fa39a. Same technique.
- **Ground:** from 78% down to bottom, gradient #446354 → #2c4326. Static.
- **Trees:** small conifers scattered along the horizon line (78%), variety in scale and darkness. Generated once, cached.

**Caching:**
- Sky + mountains rendered to `backdropCanvas` once per resize.
- Ground + trees rendered to `foregroundCanvas` once per resize.
- Each frame, composite: `backdropCanvas → clouds → foregroundCanvas`.
- This avoids redrawing expensive gradients and tree paths every frame.

**Invariant:**
- The landscape itself is never darkened or enlarged based on the metric.
- Weather carries the trajectory signal; landscape is neutral and persistent.

---

### 1.8 Renderer

**Responsibility:** Composite all layers and paint the scene each frame.

**Layer order (back to front):**
1. `backdropCanvas` (sky + back mountains)
2. Sun (fixed position, variable opacity)
3. History clouds (fixed-weather, sorted by age or y-position for depth)
4. Staging clouds (live-metric, sorted by y-position)
5. Positive particles
6. `foregroundCanvas` (ground + trees)

**Cloud rendering:**
```javascript
function drawCloud(ctx, cloud, time) {
  var y = cloud.y + sin(time * bobSpeed + bobPhase) * bobAmp
  var rgb = hexToRgb(cloud.colorHex)
  
  // radial gradient for soft silhouette
  var grad = ctx.createRadialGradient(x, y, 0, x, y, size)
  grad.addColorStop(0, rgb @ 100% opacity)
  grad.addColorStop(1, rgb @ 0% opacity)
  
  // cluster of overlapping circles for organic shape
  ctx.arc(x, y, size * 0.55, ...)
  ctx.arc(x - size * 0.5, y + size * 0.12, size * 0.4, ...)
  ctx.arc(x + size * 0.5, y + size * 0.1, size * 0.42, ...)
  ctx.arc(x + size * 0.15, y - size * 0.22, size * 0.36, ...)
  
  // rain streaks if applicable
  if (cloud.rain && opacity > 0.3) { ... }
}
```

**Performance:**
- Target 60 fps on modern hardware.
- Use DPI scaling (`dpr = devicePixelRatio`) for crisp rendering on high-DPI screens.
- Clamp `dt` per frame to 0.05s to prevent spiral dynamics on frame drops.

---

## 2. Integration with Task Data

### 2.1 Metric Calculation (Backend)

Store two metrics per snapshot in the existing data sheet:

- `velocity_3d`: average completions/day over the last 3 days
- `velocity_14d`: average completions/day over the last 14 days

Calculate trajectory metric in Apps Script or the frontend:
```javascript
trendRatio = velocity_3d / velocity_14d
metric = clamp((trendRatio - 0.85) / 0.3, 0, 1)
```

This is immune to due-date shuffling and task-count inflation.

### 2.2 Delivery

Render Trajectory Weather as an optional **full-screen toggle** from the main dashboard:

- Button in the top-right corner: "☁️ Sky View" or similar.
- Clicking opens the landscape in a modal or full-screen overlay.
- The POC HTML can be embedded as-is or adapted to accept a metric URL parameter for real-time streaming.

---

## 3. Architectural Invariants

1. **Staging and history are separate systems.** Staging applies live metric changes; history does not.
2. **Commit is one-way.** Once an element crosses the boundary, it is immutable.
3. **The metric is abstract.** The visualization does not know about tasks, ETA, velocity, or due dates.
4. **The sun is unique.** No per-cloud suns; one fixed sun with opacity-only response.
5. **Landscape is static.** No darkening or scaling based on metric.
6. **Movement is continuous.** Weather flows right-to-left at all times, independent of metric updates.
7. **Performance is predictable.** Cached layers, bounded element counts (old clouds are culled), no unbounded allocations.

---

## 4. Configuration Constants

All thresholds and visual parameters are extracted to named constants for easy tuning:

```javascript
WEATHER_STATES = [
  { key: 'storm', label: '...', color: '#...', ... },
  { key: 'heavy', ... },
  // etc.
]

WeatherModel.thresholds = { storm: 0.20, heavy: 0.40, steady: 0.60, clearing: 0.78 }

// Timing
SPAWN_INTERVAL_MS = { storm: [260, 440], heavy: [520, 760], ... }
AUTO_SIMULATE_INTERVAL_MS = [1800, 3400]

// Visual
SUN_POSITION = { x: 0.78, y: 0.20 }
COMMIT_BOUNDARY_X = 0.62

// Performance
MAX_FRAME_DT = 0.05
DPR_CLAMP = 2
```

---

## 5. Testing Scenarios

### Scenario A: Improving future
1. Start with stormy weather.
2. Apply several "big gain" actions.
3. Observe: historical storms continue left unmoved. Staging clouds gradually disappear. Sun brightens.
4. Verify: the past is unchangeable; the future is clearing.

### Scenario B: Recovering from setback
1. Let several storms scroll into history.
2. Observe them as dark shapes continuing leftward.
3. Apply big gains.
4. Verify: historical storms remain untouched. Staging area clears. Sun emerges.

### Scenario C: Metric oscillation
1. Alternate big gains and big setbacks rapidly.
2. Observe: staging clouds morph colors continuously in response.
3. As each crosses the commit boundary, it freezes its color and becomes historical.
4. Verify: the left side becomes a visual timeline of your trajectory changes.

### Scenario D: Positive feedback (no punishment)
1. Start in "heavy clouds" state.
2. Click "small gain" repeatedly without reaching "clear."
3. Observe: fireflies burst with every click, even though the overall sky remains cloudy.
4. Verify: individual progress is always rewarded, independent of the big picture.

---

## 6. Production Roadmap

### Phase 1 (POC)
- Standalone HTML with simulated metric. ✅
- All five weather states working.
- History immutability verified.

### Phase 2 (Integration)
- Wire to actual task data (velocity_3d, velocity_14d).
- Calculate metric in backend or frontend.
- Embed in dashboard as modal or sidebar.
- Add auto-refresh on ingest.

### Phase 3 (Polish)
- Accessibility audit (color contrast, reduced-motion support).
- Mobile responsiveness.
- Sound design (optional: gentle chimes on state transitions).
- Save user preferences (e.g., toggle history visibility, adjust thresholds).

### Phase 4 (Enhancement)
- Multi-metric support (separate weather for different metrics: e.g., velocity vs. overdue severity).
- Narrative text updates ("You're clearing the backlog faster than last month").
- Historical analysis ("You've cleared X tasks in the past 7 days").

---

## 7. Notes

- **Metaphor strength:** The landscape metaphor is self-reinforcing. Users immediately understand that clearing tasks improves trajectory, and the visual does the persuading without gamification tricks.
- **Intrinsic motivation:** The system rewards effort (via positive particles and future clearing) without scorecards or leaderboards. Aligns with Self-Determination Theory.
- **Non-punitive:** Adding tasks or having a bad day doesn't darken the landscape or punish the user. The metric is trajectory, not inventory.
- **Immutability as feature:** Seeing the historical storms alongside current clear skies is powerful: it says "you've recovered, and the evidence is there."

