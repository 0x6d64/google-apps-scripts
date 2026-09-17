# Campsite POC Learnings

Distilled from iterating `campsite-poc.html` against screenshot feedback.
Applies when porting the scene back into the dashboard (`JavaScript.html`).

## Layer nesting beats layer ordering

Painting far-to-near is not enough: sine valleys in a back range can dip
below the silhouette in front, showing pale "bowls" under dark edges.
Fix: clamp every range above the silhouette in front of it (plus a few px
overlap), and clamp the near range above the horizon. Pale notches become
structurally impossible instead of unlikely.

## Clouds need three properties

1. **Varied silhouettes**: derive puff count, positions, and aspect from the
   seed. Fixed layouts read as stamps even when size and opacity vary.
2. **A dissolving base mass**: one ellipse under the puffs guarantees
   coverage, but its gradient must fade to transparent at the rim, or the
   bottom shows as a solid "naked" skirt.
3. **Bottom filler puffs**: two to three low puffs straddling the rim. Our
   coverage test caught a middle-bottom gap the base mass hid — test the
   rim band explicitly, not just the core.

## Snow needs mass, not lines

A stroked ridge path reads as a wire; squares read as pixels. Fill caps
whose depth scales with peak height (deep mid-peak, feathered edges) plus
a thin top-edge stroke for definition.

## Forest edges must be irregular

Regular zigzags and even scallops read as trim. Two rows of overlapping
conifer silhouettes with varied heights, widths, spacing, and vertical
jitter read as forest. Keep a solid skirt below so sky never peeks
through at the horizon.

## Compose for the overlay

The dashboard UI covers the center, so the cabin lives at 16% from the
left (deviation from brief §5.1's 35% — deliberate). Campfire adjacent
to the cabin. Both get tree-free safe zones (`SAFE_ZONES`), which is
also realistic: no tree/fire collisions. Scale check against reference:
largest pines should exceed cabin wall height; fire scaled via context
transform (`translate` + `scale(0.8)`) so proportions stay uniform.

## Fire is three particle systems

Flames (additive, yellow-to-red over lifetime), smoke (expanding, fading),
sparks (fast, short-lived) plus a flickering ground glow. One intensity
parameter drives emission rates and glow radius. Verified pattern from
game VFX tutorials, not invented.

## Test visuals geometrically

Visual invariants can be unit-tested: extract `cloudPuffs` from the HTML
into Node and assert full core coverage, rim coverage, and layout variety
across 200 seeds. Add a debug toggle (puff outlines) for eyeball checks.
Syntax-check inline scripts with `node --check` after every edit.

## Deferred, not rejected

Day/dusk/night palettes driven by local time. A pixelated variant was
built (`campsite-pixel-poc.html`) and removed — the smooth look won.
