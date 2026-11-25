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

Implementation: `webhook/Landscape.html`. `campsite-poc.html` was the
original reference; the visuals have since moved away from it.

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

**Fixed landscape elements** (same shapes at all times): mountain ranges,
ground, treeline, pines, cabin, campfire base.

**Weather elements** (respond to metrics): cloud count, color, size and
rain per snapshot metric; sun size and brightness and sky warmth per range
metric.

**Daylight elements** (respond to time of day): all colors, sun position,
moon and stars, light direction, shadows, window and fire glow.

**Animation**: timeline clouds are pinned (no drift). Range-driven values
morph over 0.75s. The fire is the only continuous animation.

## 2. Metric Computation

### 2.1 Core concept

The range metric compares the completion pace **within the selected
range** with the pace over a **longer baseline** that contains it:

```
N                = selected range in days ('all' counts as 30)
B                = max(14, 2 × N)
velocityBaseline = completions/day over the last B days
velocityRecent   = completions/day over the last N days
trendRatio       = velocityRecent / velocityBaseline
metric           = clamp((trendRatio - 0.85) / 0.3, 0, 1)
                   // 0.5 is reached at a ratio of 1.0
                   // zero baseline or too little data gives 0.5 (neutral)
```

Velocities use actual elapsed time between first/last snapshot in each
window (not fixed intervals), summing positive `completed` deltas only.

| Range | Baseline |
|---|---|
| 1D, 3D, 7D | 14 days |
| 14D | 28 days |
| 30D, All | 60 days |

### 2.2 Why the baseline grows with the range

The baseline must be longer than the range. With a fixed 14-day baseline,
14D compared a period with itself (always neutral), and 30D/All compared
backwards: recent speed-up lowered the metric.

Narrow ranges stay volatile (a great day is a sunbreak, a bad day a
squall). The sun answers "is my pace in this range better than my
longer-term pace?" at every setting.

### 2.3 Early data

With less history than `B`, the baseline is all available history. With no
more history than the range itself, the metric is neutral.

### 2.4 Per-snapshot metrics (timeline clouds)

Range selection changes only the *visible cloud set*, never the
metrics: each snapshot carries its own trailing-3d vs trailing-14d
ratio from data up to its own timestamp. Downsample oldest-first,
cap 25, always keep latest. History never rewrites (immutability by
math, no stored flags).

## 3. Transitions

Range click or data load → `Landscape.update(rows, range)` → 0.75s lerp
(capped 30fps) → one final paint → idle (zero loop cost). The visible
cloud set swaps instantly; sun size, sun brightness and sky warmth morph.

## 4. Glassmorphism (C4: Cool Tint Less Blur)

Standard: `rgba(240,248,255,0.84)`, `blur(8px)`, `1px solid
rgba(200,220,230,0.3)`, subtle shadow. KPI cards stay solid `#ffffff`
(high-importance data). Toolbar, chart, overdue, and danger-zone panels
use C4. Text must hold WCAG 2.0 AA (4.5:1 normal, 3:1 large) over
actual landscape colors — test with WebAIM, raise opacity on failure.
Text shadow not required. Modals/notifications stay solid and opaque
(`z-index`: canvas -1, content 0–10, modals 1000, notifications 2000).

## 5. Composition

Flat Canvas 2D illustration, painted far to near: sky, stars, moon, sun,
mountains, clouds and rain, treeline, ground, pines, cabin, campfire.
Ridges therefore hide the setting sun and low stars.

**Sky**: three-stop gradient from the light palette. The range metric
tints it slightly: warm when above neutral, grey when below.

**Mountains**: three sine-composed ranges that nest, each fading toward
the horizon color. Ragged snow fields on the far peaks.

**Placement**: cabin and campfire sit in the left margin beside the
1100px content column, the fire in front of the cabin. They scale with
the margin and viewport height, and are hidden when the margin is too
narrow (about 1320px viewport width and below).

**Cabin**: three-quarter log cabin with log ends, stone footing, steep
shingled roof, stone chimney and still smoke wisps. Window glass is dark
by day and lit from dusk to dawn.

**Clouds**: one candidate per snapshot (capped at 25). The better the
snapshot's metric, the less likely it shows a cloud, so good weather
leaves open sky; the latest snapshot always shows. Flat underside, two
flat tones, size and height varied by a seed from the timestamp. Metric
below 0.45 adds a rain shaft and streaks.

**Sun/moon/stars**: sun travels east to west and sets behind the ridges.
Its size, brightness and glow follow the range metric. Moon has its own
upper-left slot.

**Campfire**: flames and sparks live on a small overlay canvas
(`#trajectoryFire`) with a 12fps loop that stops when the fire is hidden.
Reduced motion paints one static frame.

## 6. Daylight model (Sibiu seasonal blend)

Three palettes (day, twilight, night) are blended continuously with
`{day, dusk}` from `dayBlendForDate()`. There are no full-screen washes:
every layer takes its color from the blended palette. Sunrise/sunset =
fixed base hours + sinusoidal seasonal shift for Sibiu, Romania
(45.8N): `rise = 06:52 − 78min·cos(w)`, `set = 18:48 + 132min·cos(w)`,
`w = 2π·(doy−172)/365` (±20 min). Dawn reuses the twilight palette.

Lit sides and shadows follow the sun position; at night the light comes
from the moon on the left.

## 7. UI layer and mobile

Card transparency per §4. Danger Zone collapsed by default, ordered by
destructive impact: Delete Old Done (>8w) → Downsample → Prune (>1y).
Confirmation dialogs + result modals for destructive actions.

Mobile (≤640px): raise panel opacity (`rgba(240,248,255,0.92)`,
`blur(6px)`) per §4; dashboard is desktop-first. Layout maps 1:1 to the
viewport with fractional positions and deterministic seeds, so resize
reflows the same composition instead of stretching it.

## 8. Implementation

| File | Content |
|---|---|
| **Landscape.html** | Palettes, metrics, drawing, render and fire loops. |
| **JavaScript.html** | Calls `Landscape.init()` and `Landscape.update()`. |
| **Index.html** | The two canvases and the includes. |
| **Styles.html** | Canvas rules and glass panels. |

Check visuals with the local harness in `preview/`.

## 9. Tuning constants

`LANDSCAPE_*` constants and `PALETTES` at the top of `Landscape.html`.

## 10. Success criteria

- [x] Landscape visible without harming readability.
- [x] Metric computation correct and immutable across reloads.
- [x] Smooth transitions on range change (0.75s morph at 30fps, no snapping).
- [x] Cabin, fire, trees visually cohesive.
- [x] Cloud layouts gap-free and varied.
- [x] Daylight blend anchors match Sibiu sun times ±25 min.
- [ ] WCAG 2.0 AA contrast verified over live landscape.
- [ ] Mobile usability verified (≤640px).
- [ ] No jank during transitions (spot-check Performance panel).

## 11. Open questions

1. **Sky tint by metric**: done (slight warm or grey tint).
2. **House interior light**: done (windows lit from dusk to dawn).
3. **Seasonal color shifts**: deferred (only sun times shift today).
4. **Sound**: never — a dashboard background stays silent.
5. **Daily cycle**: done (browser clock). One frame per minute keeps the
   blend fresh; no slider outside the local preview.

## 12. Notes

- **Metaphor alignment**: the landscape responds to recent pace within
  the examined window — "what matters to you right now."
- **Non-punitive**: short-term noise is normal; long-term trends matter.
- **Testing visuals**: use `preview/`. No automated tests are in the repo.
