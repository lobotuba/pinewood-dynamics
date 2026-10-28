# Validation against published data (VAL-001)

Status, 2026-10-28: one published controlled experiment has been rebuilt and compared. The solver
predicts that experiment's overall race time to about 1% without any fitting. It does **not**
reproduce how strongly race time depended on car mass and CG position: the measured effects are
5–9 times larger than predicted. This is the main open physics question.

Run the comparison with `npm run compare:mann2012`.

## 1. Sources found

| Source | What it gives | Use |
|---|---|---|
| BestTrack layout drawing, `besttrack.com/tracklayoutsketch2.pdf` | Start lane 7 ft at 26°; curved lane 41 in, labelled "4 ft radius"; curve top 11-3/8 in above the floor; track top about 48 in; pin about 45 in above the floor and 8 in down the start lane; 7 ft straights plus a 40 in stop section; footprint and overall length; timer-hole spacing by timer brand | `bestTrack()` geometry (MANUFACTURER) |
| BestTrack specification page, `besttrack.com/track_specs.html` | Pin to middle timer hole: 358, 442, 526 in | Timed distance (MANUFACTURER) |
| Mann, Gibbs and Sah, *Mech. Sci.* 3, 73–84 (2012), doi:10.5194/ms-3-73-2012, CC-BY 3.0 | A 26° aluminium track; one car with bench-identified mass, CG, wheel inertia, friction, drag and pitch inertia; race times with error bars as mass and CG vary | Comparison below |
| pwdsim (github.com/reverendbedford/pwdsim, MIT) | Another open simulator with a BestTrack model | Cross-check only. Its BestTrack geometry contradicts the drawing: it infers a 49° ramp by treating the whole 41 in curve as a 48 in radius arc, and puts the pin 51 in down the lane, not 8 in. No measured race data. |
| Wikibooks, *How To Build a Pinewood Derby Car/Physics* | Simplified models and worked numbers | Not measured data; not used |

No published survey of a real lane profile was found. The curve shape remains an estimate until
the CHAR-005 survey.

## 2. What the BestTrack drawing settles

Built from the drawing, with a curved lane of uniform curvature (41 in turning 26°, radius 90.35 in),
the model reproduces the drawing's independent numbers:

- overall lane length: 34 ft 9 in, exact;
- footprint: 33 ft 11.1 in against 33 ft 11 in;
- pin about 45 in above the floor;
- timer hole 11 in from the end of the last straight (Champ spacing).

These are tested in `test/p0-track-geometry.test.ts`.

The "4 ft radius" label cannot describe the whole 41 in curve, which would then turn 49°. A 4 ft arc
followed by a short straight would leave the flat lanes 6.5 in above the floor, against the
drawing's low legs. Uniform curvature also matches the Duke track's published 1.17 m start height
(1.179 m rebuilt). The real curve is probably eased near its ends, which a survey will show.

## 3. Duke experiment (Mann, Gibbs and Sah 2012)

**Rebuilt** in `src/validation/mann2012.ts`. Every value is labelled.

- **Published (their Table 2):**
  - 26° slope;
  - 2.16 m from start to curve, and 4.21 m from curve to finish;
  - mass 0.191 kg;
  - CG 98 mm behind the nose and 13 mm above the track;
  - wheels: 2.65 g, radius 15.1 mm, I_w = 3.06e-7 kg m²;
  - axle radius 2.54 mm;
  - μ_k = 0.167, from spin-down tests without graphite;
  - C_D·A = 1.1 × 0.00146 m²;
  - I_G = 2.52e-4 kg m²;
  - ρ = 1.2041 kg/m³.
- **Assumed:**
  - a BestTrack curved lane;
  - typical kit axle positions, since the paper doesn't give them;
  - no rolling resistance;
  - Fig. 12a's axis read as mass in kg. Read as written (m/u), the masses would be 17–32 g, less than
    the bare base.
- **Measured times:** read by eye from their Fig. 12, to about ±0.005 s.

**Blind prediction (nothing fitted):**

| Fig. 12a, mass (kg) | Measured (s) | Predicted (s) |
|---|---|---|
| 0.167 | 2.308 ± 0.013 | 2.242 |
| 0.185 | 2.272 ± 0.008 | 2.237 |
| 0.225 | 2.236 ± 0.007 | 2.229 |
| 0.260 | 2.214 ± 0.008 | 2.223 |
| 0.290 | 2.216 ± 0.009 | 2.220 |

| Fig. 12b, CG behind nose (mm) | Measured (s) | Predicted (s) |
|---|---|---|
| 65 | 2.338 ± 0.004 | 2.243 |
| 78 | 2.275 ± 0.009 | 2.240 |
| 94 | 2.258 ± 0.004 | 2.236 |
| 114 | 2.210 ± 0.003 | 2.232 |
| 133 | 2.198 ± 0.002 | 2.228 |

**Findings:**

1. **Overall level.** For cars near their Table 2 configuration, the prediction falls within the
   measured spread: 2.236 s predicted against about 2.24–2.26 s measured.
2. **Mass effect.** From 0.167 to 0.26 kg the measured time falls by 0.094 s. Predicted: 0.019 s.
3. **CG effect.** Moving the CG back 68 mm cuts the measured time by 0.140 s. Predicted: 0.015 s.
4. **The gap is not in our reconstruction.** None of these changes moves either predicted effect by
   more than 0.004 s:
   - CG height read differently;
   - axles 0.5 in from the rear with a 5 in wheelbase;
   - rolling resistance 0.003;
   - a 1.1 mm nail axle radius;
   - a 4 ft arc plus a straight.

   The authors' own model has the same gap. Their Fig. 7b predicts about 0.02 s for the CG range they
   tested.
5. **Why the planar model can't produce it.** On a straight incline every car accelerates alike, so a
   rearward CG gains only through the transition: its CG is still on the slope while the nose
   reaches the flat. That is worth about 0.015 s here, not 0.14 s. Likewise, axle friction and
   rolling resistance scale with weight, and aerodynamic drag is about 1% of weight, so extra mass
   gains little.

**What this means.** Something in the real car that the planar model omits depends strongly on mass
and on load distribution. Candidates, each a falsifiable mechanism rather than a tuning factor:

- **(a) Guide-rail contact and wobble.** The authors saw wobble at both CG extremes. This needs the
  lateral and yaw model (PHY Release 2).
- **(b) Losses that don't scale with load.** Hub-face or axle-head rubbing from side forces would make
  added mass relatively more useful.
- **(c) Different front and rear axle friction.** Moving load onto the better axle would give a CG
  effect without any mass effect.
- **(d) Experimental artefacts.** For example, the car's setup changing between weight
  configurations. The paper gives no repeat-setup controls.

Their data cannot separate these. The owner's own test plan should be designed so it can:

- mass and CG sweeps with the same car and wheels;
- per-wheel spin-down at several loads, to test whether μ depends on load;
- overhead video of rail contact;
- repeated baseline runs between configurations.

## 4. Acceptance criterion

None has been set yet. Per VAL-001 it must be written down before comparing with the owner's own
measured runs. The Duke comparison above is exploratory and does not count as validation.
