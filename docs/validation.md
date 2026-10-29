# Validation against published data (VAL-001)

Status, 2026-10-29: one published controlled experiment has been rebuilt and compared. The solver
predicts that experiment's overall race time to about 1% without any fitting. It does **not**
reproduce how strongly race time depended on car mass and CG position: the measured effects are
5–9 times larger than predicted. Every mechanism screened against it fails to explain both:
- planar loss laws (section 5);
- lateral dynamics and guide-rail contact (section 7);
- camber and thrust faces (section 8);
- axial play, roll load transfer and body contact (section 9).

The car's setup changing between configurations is the leading explanation.

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
Steps were 0.5 ms (within 0.2 ms of converged for these runs). The table is from solver 0.7.0, with
square wheels and frictionless thrust faces; section 8 adds both.

| Alignment | Mass effect | CG effect | Table 2 car | χ² (10 points) | Rail loss |
|---|---|---|---|---|---|
| Aligned: the planar result | −18.8 ms | −14.9 ms | 2.235 s | 327 | 0 |
| Front toe 1 mrad | −20.7 | −223.8 | 2.379 | 2893 | 24.8 % |
| Front toe 4 mrad | −20.9 | −258.0 | 2.402 | 4047 | 25.8 % |
| Front toe 8 mrad | −21.0 | −275.7 | 2.413 | 4717 | 26.1 % |
| Rear toe 4 mrad | −20.9 | −248.8 | 2.395 | 3709 | 25.5 % |
| Set down 5 mrad crooked, square axles | −8.0 | −111.1 | 2.610 | 21488 | 51.5 % |
| Set down 10 mrad crooked | −15.5 | −116.7 | 2.642 | 24802 | 52.7 % |
| Set down 20 mrad crooked | −25.8 | −106.2 | 2.731 | 39595 | 55.4 % |
| Front toe 4 mrad, rail friction 0.15 | −19.8 | −123.3 | 2.317 | 785 | 13.6 % |
| Set down 10 mrad crooked, restitution 0.8 | −28.8 | −153.2 | 2.626 | 23994 | 51.9 % |

Rail loss is the share of released energy lost to wheel faces rubbing and striking the rail.

**Solver 0.6.0 changed these rows.** Before it, the step after a rail strike took its tread friction
limits from the strike's own forces, about a thousand times their sustained size
(`docs/physics-model.md`, section 11). For one step the treads could then hold far more than they
can. The rows after strikes moved by up to 57 ms of CG effect (front toe 4 mrad: −201 to −258 ms);
the crooked starts, which strike most, moved the most. Roll (0.7.0) moved them by under 0.1 ms. The
conclusion is unchanged.

Solver 0.5.0 takes the rail's normal as common to the wheel's rim and the rail's edge, where 0.4.0
took it as exactly sideways; the two differ by about 3e-3 rad at these yaws. That moved the rows
above by under 1 ms, except the lively wobble in the last row: its CG effect went from −205 to
−116 ms. A car bouncing between the rail's faces is that sensitive to small changes. Rows with
restitution 0.8 or more, here and in the joint search below, are also not converged in the step:
at such restitution the bounces take hundreds of flights to settle, and times move by milliseconds
with the step (`docs/physics-model.md`, section 11). They show what lively contact does, not
reliable numbers. The conclusion below does not rest on them: their CG shortfall of about 90 ms is
far larger than that error.

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
   cant the wheels and lubricate the faces. Lubricant lowers the rail friction directly; section 8
   tests the camber.

**Joint search** (solver 0.4.0). Front toe 0 to 4 mrad, rail friction 0.02 to 0.2, restitution 0.3
to 0.9, and set down 0 to 10 mrad crooked: 180 combinations, ranked at 1 ms steps and re-raced at
0.5 ms. The best five all need very low rail friction (0.05) and very bouncy contact (e 0.9):

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
- **Mechanisms not yet modelled.** Camber, which moves the rail contact low (now modelled, section
  8); wheels sliding along their axles; body contact with the rail; or roll.

The first is consistent with how sensitive these results are to alignment. Any owner test plan
must hold alignment fixed and measure it between configurations: spin-and-drift tests on a flat
board give the toe to a fraction of a milliradian.

## 8. Camber and thrust faces against the Duke data

Solver 0.5.0 adds camber, and friction at the faces that hold each wheel along its axle
(`docs/physics-model.md`, section 11). The new inputs are ESTIMATED:

- tread width 0.3 in;
- axle head: a 0.19 in nail head on a 0.087 in shank, effective radius 1.8 mm, with the bore's own
  coefficient (Table 2 `μ_k`), since it is the same steel-on-plastic pair;
- body face: a 0.3 in hub boss on painted wood, effective radius 2.7 mm, coefficient 0.35 (a guess).

Three degrees of camber is the usual bend in a canted axle. Other inputs are as in section 7; steps
0.5 ms. Solver 0.7.0 (section 7 says what changed after 0.5.0).

| Alignment, with thrust-face friction | Mass effect | CG effect | Table 2 car | χ² | Rail loss | Face loss |
|---|---|---|---|---|---|---|
| Aligned | −18.8 ms | −14.9 ms | 2.235 s | 327 | 0 | 0 |
| Square wheels, 3° tops out | −18.6 | −15.3 | 2.248 | 298 | 0 | 2.0 % |
| Square wheels, 3° tops in | −18.7 | −15.0 | 2.240 | 312 | 0 | 0.7 % |
| Front toe 4 mrad | −21.2 | −293.1 | 2.421 | 5263 | 25.8 % | 2.5 % |
| Front toe 4 mrad, 3° tops out | −19.0 | −42.9 | 2.271 | 277 | 2.5 % | 2.8 % |
| Front toe 4 mrad, 3° tops in | −21.1 | −288.0 | 2.418 | 5127 | 25.6 % | 2.5 % |
| Front toe 4 mrad, rear tops in, front tops out | −19.1 | −48.6 | 2.267 | 229 | 2.5 % | 2.1 % |
| Crooked 10 mrad, 3° tops out | −18.8 | −21.3 | 2.261 | 300 | 0.1 % | 3.5 % |
| Crooked 10 mrad, 3° tops in | −44.1 | −143.1 | 2.687 | 31994 | 52.2 % | 4.5 % |

**What the physics does:**

1. **Tops-out camber nearly removes the cost of riding the rail.** The face's lowest rim, which
   then touches the rail, lies close to the line the wheel rolls about, so it hardly slides. With
   4 mrad of toe, rail loss drops from 26 % of the energy to 2.5 %, and the car is back within 36 ms
   of aligned.
2. **Tops-in camber is no better than square.** The face still meets the rail's top edge, sliding
   at about 0.9 v. The rail also presses that wheel up.
3. **Thrust faces cost a few per cent.** Tops-in camber slides the wheels out onto the steel axle
   heads; tops out slides them in onto the body, with its larger radius and coefficient. Square
   wheels load the faces only through tread and rail forces.
4. **Still no mass effect.** Every loss added here is proportional to load, so the scaling theorem
   of section 5 holds; the mass effect stays at the planar 19–21 ms in every row.

The common racers' setup cants the rear wheels tops in, which the model agrees cuts face friction.
For the wheel riding the rail, though, the model says tops out, not tops in, is what cuts rail
friction. That rests on flat wheel faces; a real face's hub boss and chamfered tread edge could
move the contact.

**Joint search.** Front toe 0 to 4 mrad, rail friction 0.05 to 0.3, restitution 0.3 and 0.6, set
down 0 to 10 mrad crooked, and camber −3°, 0 or +3°, all with thrust-face friction: 216
combinations at 0.5 ms steps. Restitution 0.9 is left out because it does not converge in the step
(section 7). The best five:

- χ² 228 to 244, against 327 for the planar model and 196 to 210 for the unconverged 0.4.0 search
  (the same five, to 0.1 ms, when re-run with solver 0.6.0);
- 1 to 2 mrad of toe, rail friction 0.05, no crooked start, camber 0 or −3°;
- Table 2 car 2.272 to 2.276 s;
- CG effect 59 to 65 ms, against the measured 140;
- mass effect 19 ms, the planar value.

**Conclusion.** Camber and thrust-face friction do not explain the Duke effects either. Camber
changes how much riding the rail costs, but not how that cost scales with mass. With planar losses
(section 5), lateral dynamics and rail contact (section 7), and now camber and the thrust faces all
excluded, experimental artefacts remain the leading explanation. Section 9 takes the remaining
mechanisms: axial play, roll and body contact.

## 9. Axial play, roll and body contact against the Duke data

Solver 0.6.0 adds axial play and 0.7.0 roll load transfer and the underside clearance monitor
(`docs/physics-model.md`, sections 12 and 13). Play is 0.8 mm per wheel (1/32 in, a common setting)
unless stated. Hub restitution is 0.3 and the wheels start centred in their play; both are guesses.
Other inputs are as in section 8, with thrust-face friction. Steps 0.5 ms, solver 0.7.0.

| Alignment, with 0.8 mm play | Mass effect | CG effect | Table 2 car | χ² | Rail loss | Face loss |
|---|---|---|---|---|---|---|
| Aligned | −18.8 ms | −14.9 ms | 2.235 s | 327 | 0 | 0 |
| Front toe 4 mrad | −20.9 | −286.6 | 2.417 | 5010 | 25.6 % | 2.4 % |
| Front toe 4 mrad, wheels start in against the body | −22.9 | −168.3 | 2.525 | 11834 | 38.1 % | 2.9 % |
| Front toe 4 mrad, wheels start out against the heads | −21.2 | −286.9 | 2.414 | 4899 | 25.6 % | 2.2 % |
| Front toe 4 mrad, hub restitution 0.6 | −21.0 | −283.4 | 2.417 | 4955 | 25.6 % | 2.4 % |
| Front toe 4 mrad, 2 mm play | −20.3 | −243.8 | 2.422 | 4987 | 26.1 % | 2.1 % |
| Front toe 1 mrad | −21.0 | −211.2 | 2.388 | 3336 | 24.4 % | 2.3 % |
| Front toe 4 mrad, 3° tops out | −20.0 | −48.2 | 2.264 | 217 | 2.5 % | 2.0 % |
| Front toe 4 mrad, 3° tops in | −20.9 | −284.2 | 2.413 | 4820 | 25.5 % | 2.5 % |
| Square wheels, 3° tops in | −18.8 | −14.9 | 2.236 | 326 | 0 | 0 |
| Crooked 10 mrad | −24.3 | −65.8 | 2.544 | 10216 | 41.6 % | 2.2 % |

The hubs' own losses, striking their faces and sliding in the bore, stay under 0.05 % of the energy
in every row.

**What the physics does:**

1. **Play changes little once the car rides the rail.** While a toed car yaws, its wheels slide
   along their axles until they reach a face, about 0.3 s into the run. The wheel riding the rail
   then sits against its head. After that the car runs much as with fixed wheels: within 30 ms of
   CG effect at 4 mrad.
2. **Where the wheels start matters.** Wheels pushed in against the body at the gate start with
   their faces closest to the rail, and the run loses far more to it: rail loss 38 % against 26 %,
   and 0.1 s slower. Why the start position matters this much has not been traced yet.
3. **Roll moves load between the sides but changes almost no totals.** With Coulomb friction both
   sides' losses are proportional to their loads, so moving load between them changes the sum only
   at second order. Fixed-wheel rows moved by under 0.1 ms. With play, each tread's limit is its own
   wheel's load, which moved rows by up to 5 ms. The exception is the crooked start with play, whose
   CG effect went from −269 to −66 ms. That run bounces between the rail's two faces, and its
   result is sensitive to small changes, as section 7 found for wobbles.
4. **Body contact is excluded for this car.** The Duke car's underside is not published, so the
   monitor was not run on it. On BestTrack the transition brings an overhang closer to the rail by
   `x (x − WB)/(2R)`, 1.5 mm for the kit block's 44 mm nose. A kit-block car that meets a 3/8 in
   clearance rule still keeps over 1.6 mm to a 1/4 in rail there. Contact would need a car lower
   than the rules allow.
5. **Still no mass effect.** Every mechanism here scales with mass and load, so the scaling theorem
   of section 5 still holds. The mass effect stays at 19–24 ms in every row.

**Joint search with 0.8 mm play.** The section 8 search (216 combinations) was repeated with play
on every wheel, at solver 0.6.0. The best five:

- χ² 215 to 219, against 228 without play and 327 for the planar model;
- 4 mrad of toe, rail friction 0.05 to 0.1, set down 5 to 10 mrad crooked, 3° tops out;
- Table 2 car 2.255 to 2.257 s;
- CG effect 38 to 41 ms, against the measured 140;
- mass effect 19 ms.

Roll in 0.7.0 moves rows with play by a few milliseconds, which does not change this ranking's
conclusion.

**Conclusion.** Axial play, roll and body contact do not explain the Duke effects. That completes
the list of mechanisms from section 7. Every physical mechanism modelled so far either scales with
load or leaves the time far too slow. None gives a mass effect near the measured −94 ms together
with a CG effect near −140 ms. The leading explanation stays experimental: the car's alignment or
setup changing between configurations, which the toe rows show is worth hundreds of milliseconds.
Before an owner's own experiment, alignment must be measured between configurations (spin-and-drift
tests give toe to a fraction of a milliradian).
