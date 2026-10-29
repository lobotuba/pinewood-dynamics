# Validation against published data (VAL-001)

Status, 2026-10-28: one published controlled experiment has been rebuilt and compared. The solver
predicts that experiment's overall race time to about 1% without any fitting. It does **not**
reproduce how strongly race time depended on car mass and CG position: the measured effects are
5–9 times larger than predicted. A screen of loss mechanisms (section 5) finds that no
load-proportional, load-independent or aerodynamic force law in the planar model explains both
effects, singly or combined. Lateral dynamics and guide-rail contact are the remaining physics
candidates.

Run the comparison with `npm run compare:mann2012` and the screen with `npm run screen:mann2012`.

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
- **From their text:**
  - races were run **without graphite**, as were the spin-down tests, so μ_k applies to the races;
  - the mass sweep **held the CG constant** by moving the magnetic weights; the CG sweep moved one
    weight along the car;
  - μ_k came from a wheel spin-down on a fixed axle, so the bore load was one wheel's weight
    (0.026 N), against about 0.45 N per wheel when racing;
  - the car "occasionally makes contact with a raised center portion"; at both CG extremes it
    wobbled and its wheels struck that partition more often.
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

Section 5 tests (b) and (c), and the aerodynamic alternative, quantitatively.

Their data cannot separate these. The owner's own test plan should be designed so it can:

- mass and CG sweeps with the same car and wheels;
- per-wheel spin-down at several loads, to test whether μ depends on load;
- overhead video of rail contact;
- repeated baseline runs between configurations.

## 5. Mechanism screen

`scripts/screen-mann2012.ts` adds each candidate to the Table 2 car as a physical force law with
its own parameter. It sizes that parameter to reproduce the measured mass or CG effect, then checks
what the value implies for the other sweep, for the overall level and for the paper's own bench
measurements. χ² is over all ten Fig. 12 points, using the published error bar plus our 5 ms reading
error in quadrature. The steps are 2 ms, which matches the 0.1 ms result to 1 ns here.

Measured: going from 0.167 to 0.26 kg saves 94 ms; moving the CG from 65 to 133 mm behind the nose
saves 140 ms. The Table 2 car (0.191 kg, 98 mm) interpolates to about 2.25–2.27 s in the two sweeps.

| Mechanism | Parameter | Mass effect | CG effect | Table 2 car | χ² (10 points) |
|---|---|---|---|---|---|
| Planar model as published | – | −18.8 ms | −14.9 ms | 2.235 s | 327 |
| Hub drag at the spin-down bound | 2.2e-5 N m per axle | −21.4 | −15.1 | 2.242 | 304 |
| Hub drag sized to the mass effect | 23 × the bound | −94.0 | −20.0 | 2.396 | 3663 |
| Load-dependent friction, force ∝ load^(2/3), anchored at the spin-down load | – | −25.4 | −12.8 | 2.170 | 1396 |
| Same, load^(1/3) | – | −24.0 | −12.4 | 2.147 | 2097 |
| Drag area sized to the mass effect | 8.1 × Table 2 | −94.0 | −19.1 | 2.409 | 4327 |
| Extra front-axle friction sized to the CG effect | front μ + 0.243 | −17.5 | −140.0 | 2.327 | 990 |
| Joint fit: μ, front extra and hub drag | μ = 0.000, +0.259, 7 × bound | −36.9 | −131.8 | 2.256 | 33 (7 dof) |

**Why the planar model's mass effect is small.** With no air and Coulomb friction, scaling every
mass, inertia and hub torque by the same factor scales every equation, so the race time cannot
change (`test/p6-mechanisms.test.ts`). The car speeds up with added mass only through what does
not scale: the air, the fixed wheels, or friction that grows more slowly than load. In the planar
model that is worth 19 ms: about 10 ms from the wheels and 9 ms from the air.

**Findings:**

1. **Hub drag is ruled out by their own bench data.** A spin-down measures every bore torque, so a
   load-independent torque can be no larger than what the test attributed to μ_k: 2.2e-5 N m per
   axle. At that bound it adds 2.6 ms to the mass effect. Matching the measured mass effect needs
   23 times the bound, and that makes the Table 2 car 0.13–0.15 s too slow.
2. **Load-dependent friction is ruled out as the explanation, but matters for calibration.** If
   friction grows more slowly than load, a coefficient measured at one wheel's weight overstates
   friction at race load, so the car gets faster (2.170 s at n = 2/3). The mass effect grows only to
   25 ms. The general lesson stands: a spin-down at 0.026 N does not calibrate friction at 0.45 N
   unless friction is shown to be Coulomb (CHAR-006).
3. **Underestimated aerodynamic drag is ruled out.** It would need C_D A = 0.013 m², a drag
   coefficient of about 9 on the published frontal area, and it makes the car too slow.
4. **Front-axle friction fits the CG curve's shape, but not the level, and gives no mass effect.**
   The measured times fall steeply as load moves off the front axle. A loss proportional to front
   load reproduces that shape, but adding it makes the Table 2 car 0.06–0.08 s too slow.
5. **Combined, the three still fail.** The best fit drives the common μ to zero, against the
   measured 0.167; needs 7 times the hub-drag bound; reaches only 37 of the 94 ms mass effect; and
   leaves χ² = 33 for 7 degrees of freedom (p ≈ 3e-5).

**What remains** (as of this screen; section 7 then tests (a)).

- **(a) Lateral dynamics and guide-rail contact (P6, P7).** This class is outside the screen. It can
  escape the scaling argument where it involves the fixed wheels: wheels sliding along their axles,
  or wheel faces striking the partition and braking the wheels' spin. It can also escape it where
  it depends on yaw inertia, which moving weights changes. The authors saw exactly this behaviour
  change at the CG extremes. A P6/P7 model must predict, not be fitted to, a loss that rises with
  front-axle load and that a heavier car sheds.
- **(d) Experimental artefacts.** These cannot be excluded from the paper. Their one-car, no-repeat
  design leaves the setup-change explanation open.

## 6. Acceptance criterion

None has been set yet. Per VAL-001 it must be written down before comparing with the owner's own
measured runs. The Duke comparison above is exploratory and does not count as validation.

## 7. Lateral dynamics and guide-rail contact against the Duke data

`npm run screen:lateral` races the Duke car with the lateral model (`docs/physics-model.md`, section 11).
The paper gives none of the inputs, so all of them are ESTIMATED:

- the rail: 1 5/8 in by 1/4 in;
- inside wheel spacing: 1.81 in;
- yaw inertia: their pitch inertia scaled for a 7 by 1.75 by 1.2 in body;
- tread friction 0.35, rail friction 0.3, restitution 0.5.

Yaw inertia is held fixed across both sweeps, as the published pitch inertia already is. The
car's alignment is unknown, so each kind of misalignment was raced as given, with nothing fitted.
Steps were 0.5 ms (within 0.2 ms of converged for these runs).

| Alignment | Mass effect | CG effect | Table 2 car | χ² (10 points) | Rail loss |
|---|---|---|---|---|---|
| Aligned: the planar result | −18.8 ms | −14.9 ms | 2.235 s | 327 | 0 |
| Front toe 1 mrad | −20.8 | −218.2 | 2.379 | 2702 | 24.8 % |
| Front toe 4 mrad | −20.8 | −200.2 | 2.402 | 3542 | 25.8 % |
| Front toe 8 mrad | −20.8 | −275.6 | 2.413 | 4707 | 26.1 % |
| Rear toe 4 mrad | −20.7 | −248.6 | 2.395 | 3700 | 25.5 % |
| Set down 5 mrad crooked, square axles | +2.1 | −95.3 | 2.596 | 19159 | 50.8 % |
| Set down 10 mrad crooked | −20.8 | −128.9 | 2.628 | 24935 | 52.0 % |
| Set down 20 mrad crooked | −34.2 | −48.3 | 2.731 | 35201 | 55.4 % |
| Front toe 4 mrad, rail friction 0.15 | −19.7 | −104.7 | 2.317 | 718 | 13.7 % |
| Set down 10 mrad crooked, restitution 0.8 | −79.8 | −204.7 | 2.634 | 22014 | 52.3 % |

Rail loss is the share of released energy lost to wheel faces rubbing and striking the rail.

**What the physics does:**

1. **Any toe makes the car ride the rail.** With 1 mrad of toe or more, at either axle, the car
   strikes the rail, bounces a few times and then rides it. The toed treads slide sideways, which
   is Coulomb sliding even at 1 mrad (`docs/physics-model.md`, section 11), so they press the wheel
   face on the rail with `μ_t N`. The face then rubs the rail's top edge at about 0.9 v. That costs
   about a quarter of the energy and gives a strong CG effect, because the press force is
   proportional to the toed axle's load.

   It adds no mass effect. The loss is proportional to load, so the scaling theorem of section 5
   still holds.
2. **A crooked start makes the car wobble.** A car set down off-line with square axles bounces
   between the rail's two faces. Here the mass sweep is not a pure scaling: weight is added while
   yaw inertia stays fixed, so I_z/m changes. That gives a real mass effect, up to −80 ms with
   lively bounces, the first mechanism in this study to come near the measured −94 ms. But the
   level is then far too slow, at 2.6–2.7 s.
3. **The rail friction and restitution are the key unknowns.** Racers' fast "rail rider" setups
   cant the wheels and lubricate the faces. Both mitigate exactly the loss found here: the contact
   moves low on the face, where it slides slowly, and its friction drops.

**Joint search.** Front toe 0 to 4 mrad, rail friction 0.02 to 0.2, restitution 0.3 to 0.9, and set
down 0 to 10 mrad crooked: 180 combinations, ranked at 1 ms steps and re-raced at 0.5 ms. The best
five all need very low rail friction (0.05) and very bouncy contact (e 0.9):

- χ² 196 to 210, against 327 for the planar model;
- Table 2 car 2.255 to 2.266 s, the right level;
- CG effect 43 to 53 ms, three times the planar 15 ms but a third of the measured 140;
- mass effect 17 to 26 ms, the planar value.

That χ² over 10 points with 4 parameters is far worse than the planar three-mechanism fit of
section 5 (33 for 7 dof), and neither is acceptable.

**Conclusion.** Lateral dynamics and guide-rail contact, with Coulomb treads and a rigid rail, do
not explain the Duke effects either. Two tensions remain:

- toe gives the right shape of CG effect, but rail riding costs too much at any rail friction that
  leaves the level right;
- wobble can make a mass effect, but only by making the car far too slow.

With the planar candidates excluded in section 5, the remaining explanations are:

- **(d) Experimental artefacts.** For example, the car's setup or alignment changing between
  configurations. Re-placing magnetic weights could easily change the toe by a milliradian, which
  the table shows is worth hundreds of milliseconds.
- **Mechanisms not yet modelled.** Camber, which moves the rail contact low; wheels sliding along
  their axles; body contact with the rail; or roll.

The first is consistent with how sensitive these results are to alignment. Any owner test plan
must hold alignment fixed and measure it between configurations: spin-and-drift tests on a flat
board give the toe to a fraction of a milliradian.
