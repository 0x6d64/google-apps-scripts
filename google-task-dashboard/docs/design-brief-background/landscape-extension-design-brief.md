# Landscape Extension Design Brief

## Overview

Integrate the Trajectory Weather visualization into the Tasks Dashboard
as a persistent background layer. The landscape displays trajectory
metrics computed relative to the selected time-range filter
(1D/3D/7D/14D/30D/All), allowing users to see "how am I doing *in this
window*?" as a visual mood rather than a number.

The landscape is **always visible** but **never dominant** — it provides
atmospheric context and motivational feedback without interfering with
task interaction or data readability.

Reference implementation: `campsite-poc.html` (daylight, timeline
clouds, campfire). Port target: `JavaScript.html` (inline, no new
files).

## 1. Integration

### 1.1 Canvas layer

- **Position**: Fixed, full-screen, `z-index: -1` (behind all content).
- **Resolution**: Device pixel ratio scaling, capped at 2 (1.5 below
  768px width for fill-rate savings).
- **Render loop** (on-demand, resource-capped): full-rate
  `requestAnimationFrame` capped at 30fps while a transition is in
  flight; otherwise single frames painted only on data load, range
  change, or resize — zero idle cost. `prefers-reduced-motion` snaps
  transitions and paints once. Rationale: visual sugar must never tax
  the device; the 0.75s morph is indistinguishable at 30fps.
- **Content**: Sky, 3 nested mountain ranges, ground, treeline + pines,
  cabin, campfire, timeline clouds, sun, moon, stars.

### 1.2 Visual hierarchy

**Fixed landscape elements** (never change): sky gradient, mountain
ranges, ground, treeline, cabin structure, campfire base (logs, stones).

**Weather elements** (respond to metric): cloud color/opacity/size/rain
per own snapshot metric, sun opacity and glow.

**Daylight elements** (respond to time of day): dusk/night washes, sun
position, moon/stars alpha, foreground silhouette grade, rim light,
shadow length, fire/window glow boost.

**Animation**: timeline clouds are pinned (no drift); appearance morphs
continuously via `weatherAt()` interpolation, 0.75s on change. Sun
travels east-to-west. Fire/smoke/sparks animate continuously.

## 2. Metric Computation

### 2.1 Core concept

Trajectory metric is computed **relative to the selected range**,
anchored against a **fixed 14-day baseline** that never changes:

```
velocityBaseline = avg(completions/day, last 14 days)     // FIXED
velocityRecent   = avg(completions/day, last N days)      // N = range
trendRatio       = velocityRecent / velocityBaseline
metric           = clamp((trendRatio - 0.85) / 0.3, 0, 1)
                   // 0.85 is "steady", 0.3 is the scaling factor
                   // zero baseline defaults to 0.5 (neutral)
```

Velocities use actual elapsed time between first/last snapshot in each
window (not fixed intervals), summing positive `completed` deltas only.

### 2.2 Why a fixed baseline

A range-matched baseline would hover near 1.0 (metric collapses to
noise). The fixed reference point makes narrow ranges (1D/3D) volatile
(a great day is a sunbreak, a bad day a squall), wide ranges calmer,
and 30D/All near-neutral — responsive on check-in, meditative on
review. This is intentional, not a bug.

### 2.3 "All" range and early data

"All" uses the trailing-30d window with the same 14d baseline (behaves
like 30D). With < 14 days of history, the baseline falls back to all
available history.

### 2.4 Invariant

Baseline window is always 14 days (or all history if shorter),
independent of range. Only the numerator window changes.

### 2.5 Per-snapshot metrics (timeline clouds)

Range selection changes only the *visible cloud set*, never the
metrics: each snapshot carries its own trailing-3d vs trailing-14d
ratio from data up to its own timestamp. Downsample oldest-first,
cap ~25, always keep latest. History never rewrites (immutability by
math, no stored flags).

## 3. Transitions

Range click → compute metric → set target → 0.75s lerp of all visual
parameters → fall back to ambient tick. No state persists between
changes. Per-frame cost during transitions is bounded (≤25 clouds).

## 4. Glassmorphism (C4: Cool Tint Less Blur)

Standard: `rgba(240,248,255,0.84)`, `blur(8px)`, `1px solid
rgba(200,220,230,0.3)`, subtle shadow. KPI cards stay solid `#ffffff`
(high-importance data). Toolbar, chart, overdue, and danger-zone panels
use C4. Text must hold WCAG 2.0 AA (4.5:1 normal, 3:1 large) over
actual landscape colors — test with WebAIM, raise opacity on failure.
Text shadow not required. Modals/notifications stay solid and opaque
(`z-index`: canvas -1, content 0–10, modals 1000, notifications 2000).

## 5. Composition

**Sky**: gradient `#9fc4cf` → `#e4ecec`. No metric tint (deferred, §12).

**Mountains**: three sine-composed ranges, far (pale) to near (dark):
back `#b9cfc9`, mid `#8fb3a6`, near `#5f8272`. Polylines must nest —
no range dips below the silhouette in front, near range never below the
horizon — so pale "bowls" are structurally impossible. Snowcaps on
far-range peaks only: filled caps with depth scaling by peak height
(deep mid-peak, feathered edges) plus a thin top-edge stroke.

**Ground**: 78% down to bottom, gradient `#446354` → `#2c4326`.

**Trees**: irregular conifer-silhouette rows (varied heights, widths,
spacing, jitter), darker taller back row, solid skirt below so sky never
peeks through. ~17 foreground pines (largest exceed cabin walls,
two-tone sun-side shading) placed by min-spacing rejection sampling so
canopies cannot merge. Nothing spawns inside the safe zones.

**Cabin** (16% across, left side — centered scenery is wasted behind
dashboard UI; deliberate deviation from the original 35%): moss walls
`#5a7a6e` with log lines, timber roof `#8b6f47` with overhang and
shadow side, dark door, warm glowing windows, stone chimney. ~80–120px
tall. Subtle drop shadow for separation.

**Campfire** (30% across, scale 0.8): stone ring, crossed logs, three
particle systems (additive flames yellow-to-red, expanding smoke, fast
sparks) plus flickering ground glow. One intensity parameter drives
emission and glow radius.

**Safe zones**: tree-free discs around cabin (r 0.10) and campfire
(r 0.08) — realistic clearing, prevents sprite collisions.

**Clouds**: seeded puff layouts (6–11, never a fixed stamp) rendered
dark-to-light: one flat shadow silhouette (values near sky values),
then a few small lights on upper puffs biased sun-side. Stormy = dark
slate, large, rainy; healthy = bright, small, dry. Base shapes dissolve
at the rim (no naked skirts, no stamp holes — verified geometrically).
Rain streaks when stormy. No markers or rings on the newest cloud.

**Sun/moon/stars**: sun travels east–west, touching the horizon at
rise/set; opacity follows the metric. Moon has its own upper-left slot.
Both render before the cloud loop so weather passes in front; stars get
an alpha boost to survive the night wash. True light sources (flames,
glow, window boosts) render after all overlays, undimmed. Depth rule:
emitters punch through the night; everything else takes the tint.

## 6. Daylight model (Sibiu seasonal blend)

Three stops (day/dusk/night) blended continuously via `{day, dusk}`
from `dayBlendForDate()`; the frame eases toward it. Sunrise/sunset =
fixed base hours + sinusoidal seasonal shift for Sibiu, Romania
(45.8N): `rise = 06:52 − 78min·cos(w)`, `set = 18:48 + 132min·cos(w)`,
`w = 2π·(doy−172)/365` (±20 min; dawn/dusk windows are 60–75 min wide).
Dawn reuses the dusk palette. Product seam: replace the internals with
the sunrise equation once real lat/lon exists; rendering untouched.

Dusk foreground rules: the sky may glow but the foreground goes dark
(bottom-up silhouette grade, transparent at horizon); warm rim light on
sun-facing edges driven by dusk factor; long soft shadows away from the
low sun, vanishing at noon; shadows stay colored, never black.

## 7. UI layer and mobile

Card transparency per §4. Danger Zone collapsed by default, ordered by
destructive impact: Delete Old Done (>8w) → Downsample → Prune (>1y).
Confirmation dialogs + result modals for destructive actions.

Mobile (≤640px): raise panel opacity (`rgba(240,248,255,0.92)`,
`blur(6px)`) per §4; dashboard is desktop-first. Layout maps 1:1 to the
viewport with fractional positions and deterministic seeds, so resize
reflows the same composition instead of stretching it.

## 8. Implementation

| File | Change |
|---|---|
| **Index.html** | `<canvas id="trajectoryWeather">` as first body element. |
| **Styles.html** | Canvas rules, C4 glassmorphism, media queries. |
| **JavaScript.html** | Metric functions, `Landscape` renderer, range-click wiring. All inline. |
| **Code.js** | Weighted ingestion, subtask columns, Top Overdue sheet, locking. Done. |

Port checklist from the POC: precompute the metric series once per data
load, render per-row `weatherAt(ownMetric)`, port draw functions
1:1 (ranges, treeline, pines, cabin, fire, clouds, sun/moon/stars),
reuse the on-demand loop. Reference: `campsite-poc.html`.

## 9. Tuning constants

```javascript
BASELINE_WINDOW_DAYS: 14, METRIC_DISPLAY_WINDOW_DAYS: 30,
TRANSITION_DURATION_S: 0.75, TRANSITION_FPS: 30,
MOBILE_WIDTH: 768, MOBILE_DPR: 1.5, DESKTOP_DPR: 2,
HOUSE_POSITION: { x: 0.16 }, HOUSE_WIDTH: 100, HOUSE_HEIGHT: 120,
FIRE_POSITION: { x: 0.30 }, FIRE_SCALE: 0.8,
SAFE_ZONES: [{ x: 0.16, r: 0.10 }, { x: 0.30, r: 0.08 }],
SNOW_LINE: 0.70, CLOUD_CAP: 25
```

## 10. Success criteria

- [x] Landscape visible without harming readability.
- [x] Metric computation correct and immutable across reloads.
- [x] Smooth transitions on range change (0.75s morph, no snapping).
- [x] Cabin, fire, trees visually cohesive.
- [ ] WCAG 2.0 AA contrast verified over live landscape.
- [ ] Mobile usability verified (≤640px).
- [ ] No jank during transitions (spot-check Performance panel).

## 11. Open questions

1. **Sky tint by metric** (warmer when clear): deferred.
2. **House interior light**: done (warm windows + night boost).
3. **Seasonal color shifts**: deferred (only sun times shift today).
4. **Sound**: never — a dashboard background stays silent.
5. **Daily cycle**: implemented in POC (Sibiu blend); product port pending.

## 12. Notes

- **Metaphor alignment**: the landscape responds to recent pace within
  the examined window — "what matters to you right now."
- **Non-punitive**: widening the range calms the weather (integrating
  noise). Short-term noise is normal; long-term trends matter.
- **Testing visuals**: extract pure functions into Node (puff coverage
  over 200 seeds, blend anchors, sun path, metric immutability);
  `node --check` after every edit; puff-outline debug toggle.
