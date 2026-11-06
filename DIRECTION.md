# Creative direction: the ASCII descent

Working notes for the builder. Not shipped.

The one idea: a night-mountain woodcut done in type. Cold, sparse, bright
sky at the top; dense, warm, textured ground at the bottom. The page gets
*heavier* as you scroll, in both colour temperature and character density.
Sky cells are mostly empty. Base cells are mostly full. That gradient of
density is the composition; everything else serves it.

Do not make it look like a terminal demo. No scanlines, no green-on-black,
no glow filters, no CRT. It is a drawing that happens to be made of letters.

---

## 1. Palette

Cold at the top, warm at the bottom, one dark ground throughout.

| name        | hex       | use                                                  |
|-------------|-----------|------------------------------------------------------|
| sky         | `#070a14` | canvas background, never changes                     |
| star-dim    | `#5a6a86` | tier-3 field stars, far constellation lines          |
| star        | `#c9d8ee` | tier-2 field stars, name stars at rest               |
| star-bright | `#f2f6ff` | tier-1 field stars, name stars when traced           |
| ember       | `#f3c86b` | the four bright stars, shooting-star heads, headlamps, links |
| name-line   | `#7f93b4` | constellation lines, 55% alpha                       |
| rock-light  | `#8c9bb8` | lit rock faces near the snow                         |
| rock        | `#4f5e7c` | mid rock                                             |
| rock-dark   | `#2a3450` | shadowed rock, lowest contrast against sky           |
| snow        | `#eef3fb` | snow cap, snowflakes                                 |
| bird        | `#b8c6da` | birds (slightly cooler than snow so they read against it) |
| pine        | `#3f7a55` | lit pine                                             |
| pine-dark   | `#24513a` | shadowed pine, tree trunks                           |
| leaf        | `#d08a3a` | leaves, amber                                        |
| leaf-olive  | `#9aa84a` | leaves, second colour                                |
| ground      | `#6b5236` | lit ground                                           |
| ground-dark | `#3d2e21` | shadowed ground, lowest rows                         |
| card-ink    | `#e3e9f3` | card body text                                       |
| card-rule   | `#7f93b4` | card `+---+` frame, same as name-line                |

Rules
- Backgrounds are only ever `sky`. The warm shift comes from the glyph colours, not the background. The one exception: the last 1.5 screens may fade the canvas background to `#0b0907` so the base feels closed in.
- Fog: cells far from the "camera" (anything in the far ridge band, see §5) use `rock-dark` at 60% alpha. Never pure grey.
- Only `ember` is warm above the treeline. Birds, snow and rock stay cold. The first amber below the sky is a leaf. That is the moment the page turns.

---

## 2. Glyph vocabulary

Plain ASCII, plus exactly four Unicode glyphs: `·` (U+00B7), `•` (U+2022), `✦` (U+2726), `~`-free bird uses `˘`? No. Keep birds ASCII. Allowed Unicode: `·`, `•`, `✦`, `◦`.

Field stars, three tiers (random, weighted 70 / 24 / 6):
- tier 3: `.` in `star-dim`; a fifth of them `·`
- tier 2: `*` in `star`, a few `+`
- tier 1: `✦` in `star-bright`; twinkles between `✦` and `*`

Name stars: `*` in `star` at rest; `✦` in `star-bright` while traced and for 2s after. Anchor stars (first and last of a letter) are `✦` permanently once traced.

The four bright stars: `✦` in `ember`, with a one-cell halo of `·` in `ember` at 35% alpha on the four orthogonal neighbours. When lit: the halo grows to the 8 neighbours and pulses.

Constellation lines, chosen by segment slope (dy/dx in cell units, y down):
- |dx| ≥ 3|dy|: `-`
- |dy| ≥ 3|dx|: `|`
- dx·dy < 0 (rising to the right on screen): `/`
- otherwise: `\`
- every third cell along a line is `.` instead, so the line looks hand-drawn and broken. Colour `name-line`.

Shooting star: head `✦` in `star-bright`, then tail of 6 cells: `*` `=` `-` `-` `.` `.` fading from `star` to `star-dim`. Tail follows the actual path (so a deflected trajectory shows a bent tail).

Bird, three frames, 3 cells wide, cycle at 6 fps:
```
 v    ~v~   ^v^
```
frame order: `~v~`, ` v `, `^v^`, ` v `. Colour `bird`. Distant birds are one cell: `v` / `-` alternating.

Snowflakes: `*` `.` `+` (50 / 35 / 15). Colour `snow`. Tier `.` flakes are `star-dim`-coloured snow, read as far away.

Leaves: `,` `'` `~` (45 / 30 / 25). Colour alternates `leaf` / `leaf-olive` per particle, fixed for its life. A leaf tumbles: its glyph cycles `, ' ~` at 3 fps.

Pine trees, three shapes, bottom row sits on the slope cell. Trunk is `pine-dark`, canopy `pine` with every 4th canopy cell `pine-dark`.
```
  ^        ^        ^
 /^\      /|\      / \
/^^^\     /|\     /^^^\
  |      /|||\     /|\
```
Use them at three scales by picking shape 1 (3 rows), shape 2 (4 rows) or shape 3 (5 rows, add a row `/^^^^^\`). Never mirror; never place two identical shapes adjacent. Trees overlap by one column at most.

Rock shading ramp, light → dark, chosen by a lighting value in 0..1:
```
@ % # * + = : - . (space)
```
Only `% # * + = : - .` are actually used on the mountain; `@` is reserved for the sunlit snow edge (see §5). Colour steps with the ramp: `% # *` → `rock-light`, `+ = :` → `rock`, `- .` → `rock-dark`.

Snow surface: `@` on the lit edge, `#` on lit faces, `%` on steep lit faces, `:` and `.` in shadow, all in `snow`. Snow in shadow is `snow` at 55% alpha, never grey.

Ground texture: rows cycle `. , : ' . ,` with 30% of cells blank, colour `ground`; the bottom 6 rows are `ground-dark` with `_` and `.` only. Occasional `"` and `,` tufts in `pine-dark`.

Headlamps on the route: `o` in `ember`; lit ones gain a `·` on each side.

---

## 3. The name asterism

Lowercase "daniel wyckoff", not a font. Each letter is an asterism: 3–6
stars, sparse crooked lines, and a different "hand" per letter. The rule
of the Big Dipper: you draw the handle and the bowl, not the ladle.

Coordinates in a 0..1 box, y up. `lines` are index pairs into `stars`.
Letters with ascenders use y up to 1.0; x-height letters stay under ~0.62.
Descenders (y) go below 0 to -0.35.

```json
{
  "d": { "stars": [[0.72, 0.98], [0.66, 0.42], [0.74, 0.03], [0.30, 0.52], [0.06, 0.18], [0.36, 0.04]],
         "lines": [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 2]] },
  "a": { "stars": [[0.58, 0.55], [0.14, 0.44], [0.10, 0.08], [0.56, 0.12], [0.68, 0.00]],
         "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]] },
  "n": { "stars": [[0.08, 0.60], [0.12, 0.02], [0.30, 0.56], [0.62, 0.52], [0.70, 0.04]],
         "lines": [[0, 1], [0, 2], [2, 3], [3, 4]] },
  "i": { "stars": [[0.46, 0.86], [0.44, 0.56], [0.40, 0.04]],
         "lines": [[1, 2]] },
  "e": { "stars": [[0.08, 0.32], [0.64, 0.36], [0.56, 0.58], [0.20, 0.52], [0.10, 0.08], [0.60, 0.02]],
         "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5]] },
  "l": { "stars": [[0.44, 1.00], [0.38, 0.50], [0.48, 0.02], [0.66, 0.06]],
         "lines": [[0, 1], [1, 2], [2, 3]] },
  "w": { "stars": [[0.02, 0.58], [0.22, 0.02], [0.44, 0.44], [0.66, 0.00], [0.88, 0.60]],
         "lines": [[0, 1], [1, 2], [2, 3], [3, 4]] },
  "y": { "stars": [[0.08, 0.58], [0.34, 0.04], [0.64, 0.60], [0.22, -0.34]],
         "lines": [[0, 1], [2, 1], [1, 3]] },
  "c": { "stars": [[0.62, 0.50], [0.20, 0.54], [0.06, 0.26], [0.22, 0.02], [0.60, 0.08]],
         "lines": [[0, 1], [1, 2], [2, 3], [3, 4]] },
  "k": { "stars": [[0.14, 1.00], [0.10, 0.04], [0.56, 0.52], [0.16, 0.30], [0.62, 0.00]],
         "lines": [[0, 1], [2, 3], [3, 4]] },
  "o": { "stars": [[0.34, 0.60], [0.06, 0.34], [0.26, 0.02], [0.64, 0.16], [0.60, 0.50]],
         "lines": [[0, 1], [1, 2], [2, 3], [3, 4]] },
  "f": { "stars": [[0.62, 0.96], [0.34, 0.76], [0.28, 0.04], [0.08, 0.50], [0.54, 0.48]],
         "lines": [[0, 1], [1, 2], [3, 4]] }
}
```

Notes on the hands
- `d` is a closed bowl with an ascender that leans right; `a` is a kite with a tail; `n` is a gate; `i` has a floating dot star with no line to it; `e` is a bowl with a lid; `l` kicks right at the foot; `w` is four strokes only, no symmetry; `y` is a fork with a long descender; `c` is an open hook; `k` is two separate strokes that do not touch (the crossbar never meets the stem; it is implied); `o` is an open pentagon, missing its top-right side; `f` has a crossbar that floats free of the stem.
- `o` is used twice (w-y-c-k-o-f-f) and `f` twice. On the second use mirror nothing; instead rotate the point list by one index so the lines start from a different star and jitter again. They should look like siblings, not copies.

Layout
- Letter box width: 1.0. Advance: 1.12 for most letters; after `i` advance 0.72; after `l` 0.84; word space 0.9.
- Baseline jitter: each letter's baseline shifts by a value in [-0.10, +0.10] (fixed, seeded), and each letter rotates by a value in [-5°, +5°]. The two words sit on different baselines: "wyckoff" is 0.18 lower than "daniel".
- Star jitter: each star moves by up to ±0.045 in x and y, seeded. Stars never land on exact cell corners twice in a row.
- Rendering: a letter's x-height ≈ 5 cells on desktop (so the whole name is ~75 cells wide); ≈ 4 cells on phone with the two words on two lines, "wyckoff" indented 2 cells right of "daniel".
- Lines are drawn through cells with the slope glyphs in §2 with every third cell dropped. Where a line would pass through a star cell, the star wins.

---

## 4. Vertical composition

Screens are measured in viewport heights from the top. ~10.5 screens total.
Horizontal positions are desktop; on phone everything centres and cards sit at the bottom.

| from | to   | what                                                                                           |
|------|------|------------------------------------------------------------------------------------------------|
| 0.00 | 1.00 | **Sky.** Name asterism centred, baseline at 0.30. Subtitle at 0.52, two lines, centred. "Scroll" hint at 0.70. Field stars everywhere above 3.6. |
| 0.35 | 3.40 | **Shooting stars.** 1 every 7–11 s somewhere in this band, always moving down-and-right or down-and-left, 20–35° off horizontal. Never in the 0.0–0.35 band (the name's sky stays still). |
| 1.10 | 1.65 | **UCP star**, right third, x ≈ 0.68. Card sits left of it, x ≈ 0.08–0.42. |
| 1.75 | 2.30 | **W3C star**, left third, x ≈ 0.26. Card sits right, x ≈ 0.50–0.88. |
| 2.40 | 2.95 | **FIDO star**, right, x ≈ 0.74. Card left. |
| 3.05 | 3.60 | **Shopify Payments star**, left-centre, x ≈ 0.36. Card right. This is the lowest star; it sits just above the summit. |
| 3.30 | 3.90 | **Shooting stars become birds.** Any streak entering this band converts mid-flight (see §6). Birds also spawn from the edges here. |
| 3.70 | 4.40 | **Summit.** Snow cap: the peak tip at 3.72 screens, centre x ≈ 0.52. Snow runs down to 4.40. Ridges start. Birds cross the cap. |
| 4.10 | 4.70 | **Birds become snow.** A bird reaching this band dissolves into 3 flakes that drift down. Flakes spawn across the width from 4.10 onward. |
| 4.40 | 6.60 | **The face.** Rock, ridges, route. Headlamps (merged commits) on the route from 4.60 to 6.20. **The climb card** at 4.90, left. |
| 5.40 | 5.60 | **Treeline.** First pines appear on the lower-angle slopes at the edges, climbing no higher than 5.40. |
| 5.60 | 6.80 | **Snow becomes leaves.** A flake falling past 5.60 is now a leaf (glyph and colour swap in one frame, no fade; it is a page turning, not a dissolve). Leaves fall to the ground and rest. |
| 5.80 | 6.40 | **History card 1**, Shopify Subscriptions, right. |
| 6.50 | 7.10 | **History card 2**, Fera, left. Trees dense on both sides now. |
| 7.20 | 7.80 | **History card 3**, First commits, right. |
| 7.60 | 9.20 | **Lower slopes into the base.** Trees fill in, slope flattens, ground texture takes over from rock by 8.30. |
| 8.60 | 9.60 | **The base.** Ground only, resting leaves, a few tree trunks at the edges. Canvas background may warm to `#0b0907` over this band. |
| 9.20 | 10.3 | **Roots card** (rename it: "Base") centred, with links and the colophon. Nothing moves below 9.6 except leaves settling. |
| 10.3 | 10.5 | Dead space so the last card clears the bottom edge. |

Card placement rule: a card never covers its star; the star and its card share a row band and sit on opposite halves. The tether from star to card is a line of `.` cells in `name-line`, drawn on the canvas, not SVG.

---

## 5. The mountain in ASCII

It reads as a mountain because of three things: a lit side and a shadow side, a snow edge that is brighter than anything else on the page, and ridges that run downhill.

Geometry
- One ridgeline `peak(x)`: a summit at x ≈ 0.52 with two shoulders (x ≈ 0.30 at 70% height, x ≈ 0.78 at 55%), falling to the base at both edges. Build it from three humps plus ridged noise at two octaves; it is a silhouette function in cells, not a heightfield.
- A second, lower silhouette behind it (`far(x)`, 40% of the height, peaks offset to x ≈ 0.18 and 0.86), drawn only in `rock-dark` at 60% alpha with the `.` and `-` glyphs. This is the fog band. It gives the summit something to stand in front of.
- Light comes from the upper left. For a cell inside the silhouette, lighting = 0.5 + 0.5·slope sign, where slope is `peak'(x)` smoothed over 3 cells: left-facing slopes are lit (ramp index low, `% #`), right-facing are shadowed (`= : -`). Add noise to the lighting so faces break up into facets about 4–7 cells wide.
- Ridges: trace 5–7 downhill polylines from the summit and the shoulders (noise-driven walks, always descending). Cells on a ridge get `/` if the ridge runs down-left, `\` if down-right, `|` if steep. Ridge glyphs are one step lighter than their neighbours on the lit side and one step darker on the shadow side. Ridges continue through the snow in `snow` colour.
- Snow: the cap is everything above the snowline `snowline(x) = peakTop + 0.55·(screenHeight)` roughly, jittered by noise ±4 rows so the edge is ragged, and extended downward along ridges (snow clings to ridges 8–14 rows longer than to faces). The snow edge, the lowest snow row in each column, is `@` on the lit side and `%` on the shadow side, in `snow`. That edge is the brightest line on the page.
- Treeline: trees stand on `peak(x)` wherever the slope angle is under ~35° and the row is below the treeline band. Place by a seeded walk along x with spacing 3–7 columns; trees overlap the rock, never float. Trees on the shadow side use `pine-dark` for canopy edges.
- Base: where `peak(x)` is within 10 rows of the ground line, rock glyphs give way to ground texture, mixed 50/50 over 4 rows.

Summit sample, 24 columns × 10 rows (lit side left, snow in `snow`, rock in rock colours, ridge glyphs shown):
```
          .✦.           
         @@#\.          
        @##%:\.         
       @#%/|%::.        
      @#%/ |#%::-.      
     @##/  |%%::=-.     
    %#%/   |#:::=--.    
   =+#/    |%::=---..   
  :=+/     |:::=--...   
 .:=/      |.::---....  
```
Read: `@` is the lit snow edge, `#%` lit snow faces, `::.` snow in shadow, `/` and `|` the ridges, `=+-.` rock emerging on the right where the cap thins. The left margin goes blank fast: sky is empty, the mountain is drawn, the sky is not.

---

## 6. Motion rules

Units: one cell. Time: seconds. All springs are critically damped-ish: overshoot once, then settle.

- **Field stars and name stars** have a home. Pointer within 5 cells pushes a star away along the pointer→star direction by up to 2.5 cells (full push at 0 distance, zero at 5). Release: returns to home in about 0.9 s with one overshoot of ~0.4 cells. A star never moves more than 3 cells from home.
- **Scroll shove**: scroll velocity v (cells/s) adds −0.012·v cells/s to every particle's vertical velocity each frame (scrolling down shoves the sky up). Clamp the effect to ±2 cells of displacement. Settles in ~0.8 s. Birds, flakes and leaves get the same shove at half strength.
- **The four bright stars** have a stiffer spring: max 1.2 cells of push, settle in 0.5 s. Their halo does not move with them; it re-centres each frame.
- **Shooting stars**: one every 7–11 s while the viewer is in the 0.35–3.40 band, none above it. Speed 28 cells/s, life 2.2 s, spawn just off the top or side edge. Pointer within 6 cells bends the velocity toward the away-direction by up to 40°; the bent tail shows the kink. Scroll shove applies at full strength, so a hard scroll visibly kicks a streak.
- **Birds**: a shooting star that reaches 3.30 screens converts: its tail collapses to 1 cell over 0.4 s while its glyph goes `✦` → `v` → `~v~`, velocity drops to 7 cells/s horizontal with a 1 cell/s vertical sine. Flap at 6 fps. Birds also spawn from the side edges at 1 every 4 s in the 3.30–4.40 band, max 6 on screen. Pointer within 4 cells makes a bird veer 3 cells and return.
- **Birds to snow**: reaching 4.10 a bird scatters into 3 flakes at its position with ±1 cell/s drift; no fade, the `~v~` becomes `* . +` in one frame.
- **Flakes**: fall at 2.5 cells/s with ±0.8 cells/s lateral sine (period ~3 s) plus pointer push at full strength. Spawn across the width in the 4.10–5.60 band, max ~90 live. Flakes that hit rock stop and vanish after 0.5 s.
- **Leaves**: a flake crossing 5.60 becomes a leaf in one frame. Leaves fall at 1.8 cells/s, tumble glyphs at 3 fps, drift ±1.5 cells/s. Leaves that reach the ground stop and stay for the session (they accumulate on the base, up to ~200, then the oldest vanish).
- **Headlamps**: static, pulse brightness 0.7–1.0 over 2 s each with a different phase. Light up in order from the summit down as the viewer scrolls through 4.60–6.20.
- **Load moment** (the only unprompted animation): t = 0.0–0.5 s field stars fade in. t = 0.5–3.3 s the name is traced: letter by letter, left to right, each line drawn cell by cell at ~18 cells/s; as a letter's first line starts, its stars flip from `*` to `✦`. t = 3.3–3.9 s the subtitle fades in, then the Scroll hint. Nothing else moves until the viewer does.
- **Must not move**: the mountain, the snow, the trees, the ground, the headlamps' positions, the card boxes, the subtitle. If a reduced-motion preference is set: no shooting stars, no shove, no twinkle; the name is already traced on load; birds, flakes and leaves still exist but are static props placed at fixed positions.

Performance budget: the static world is rendered once into an offscreen glyph buffer per world row (char + colour per cell) and blitted by row range; only particles and the lit cells are redrawn per frame.

---

## 7. Copy

Subtitle, exactly:
```
Staff Software Engineer, Shopify Payments.
Open source leader. UCP, W3C, FIDO.
```

Card copy review against Daniel's register (short, factual, dry; commit-message cadence). Keep most of it. Tightened lines:

- UCP `.sub`: "Open standard for agentic commerce, by Google and Shopify." → **"Open standard for agentic commerce. Google and Shopify."**
- UCP body: keep. It is the strongest paragraph on the page.
- W3C body: "Secure Payment Confirmation, 3-D Secure, Payment Request. Asked in September how an agent finds a buyer's payment methods. Shipped the answer in UCP by February." → **"Secure Payment Confirmation, 3-D Secure, Payment Request. Asked in September how an agent finds a buyer's payment methods. Shipped the answer in UCP in February."** ("by" reads as a deadline; "in" is a fact.)
- FIDO body: keep.
- Shopify `.sub` "The day job." keep. Body: "Platform engineering under a tenth of US ecommerce. Where the specs above meet real traffic." → **"Payments platform under a tenth of US ecommerce. Where the specs above meet real traffic."**
- The climb: card title keep. Pulse line "13 merged commits in twelve months, 1 repo." → **"13 merged commits in twelve months."** Drop the repo count; it undersells (one repo is the spec).
- Slopes 1: keep.
- Slopes 2 Fera: keep.
- Slopes 3 "First commits": keep, but "CprBot, forwards CPR bookings to the Red Cross." → **"CprBot, forwards CPR bookings to the Red Cross. Python on Lambda."**
- Roots card → rename heading **"Base"**. Body keep both lines. Colophon: "No framework, no fonts, no tracker. Hand-written WebGL." → **"No framework, no fonts, no tracker. It is all text."**
- Rail labels: Summit, Shaping, Climb, Slopes, Roots → **Sky, Summit, Face, Trees, Base.** They now name what you are looking at.
- "Scroll" hint: keep, lowercase, one word.
