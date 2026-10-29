# Physics model, MVP solver (PHY-009)

Status: physics core, solver `phy-009/0.4.0`. Gates P0–P7 pass against analytic solutions
(section 7); P6 and P7, lateral dynamics and guide-rail contact, are in section 11. The solver has been compared with one published experiment
(`docs/validation.md`): it gets the overall time right, but not the size of the mass and CG
effects. It has not been validated against the owner's track. The kit and friction values are still
ESTIMATED (section 8).

Controlling requirements: spec sections 8, 10 and 11; PHY-001…009, ANA-001, TIM-001, GATE-004,
AERO-001, FRI-001, WHL-004, TRK-003/004.

## 1. What is modelled

The car is a rigid body moving in the vertical plane of one lane. Both axles stay on the lane
profile, and every wheel rolls without slipping. The car has one degree of freedom, `s`: the arc
length of the rear axle centre along its path. Pitch follows from where the two axles sit on the
track.

Included:

- gravity acting on the actual CG position;
- translational and pitch kinetic energy;
- wheel spin inertia;
- Coulomb friction at the axle and bore, under the actual axle–wheel contact force;
- rolling resistance;
- aerodynamic drag;
- wheel loads from the full rigid-body balance on the slope and transition, including centripetal
  and longitudinal-acceleration effects.

Lateral motion, yaw, toe and guide-rail contact are modelled when the car has a lateral description
and the lane a guide rail (section 11); otherwise the car is raced in the vertical plane only, and
the result record says which (`record.lateral`).

Not modelled: roll, camber, three-wheel running, wheels sliding along their axles, start-pin
motion, body–track contact, wheel slip along the direction of travel, and track or car flexibility.

## 2. Geometry and kinematics (`src/track/path.ts`, `src/physics/kinematics.ts`)

**Lane surface.** The solver accepts any surface that supplies position, unit tangent `t`, normal
`n` (pointing up off the surface) and signed curvature `κ` at each arc length (`src/track/curve.ts`).
There are two kinds:

- **Lines and arcs** (`path.ts`): a chain of constant-curvature pieces, joined smoothly so position
  and tangent are continuous. Curvature can jump at a join. Everything is exact.
- **Survey fits** (`spline.ts`, `docs/track-survey.md`): `z(x)` as a cubic smoothing spline, so slope
  and curvature are continuous. Arc length comes from 8-point Gauss–Legendre quadrature per interval,
  accurate to 1e-13 m.

**Wheel-centre paths.** For a wheel of radius `r`, the centre path is the surface offset by `r`
along `n`.

- On lines and arcs, an offset arc has curvature `κ/(1−κr)` and length `L(1−κr)`, so the centre
  path is also lines plus arcs and stays exact.
- On a survey fit, the centre-path arc length above surface arc length `u` is
  `σ(u) = u − r(θ(u) − θ(0))`, exact because `dσ/du = 1 − κr`. Points are found by Newton's method
  on `σ`.

A wheel too large for a concave stretch of lane, `1 − κr ≤ 0`, is rejected.

**Body frame** (GEO-010). The origin is the rear axle axis, `+X` points along the chord to the
front axle axis, and `+Z` is up. Both axle slots sit at the same body height, so the chord is the
body X axis.

**Front axle.** The front axle position `s_f` solves `|C_f(s_f) − C_r(s)| = WB` (Newton's method,
with bisection as a fallback). With the chord `d = C_f − C_r`:

```
s_f'  = (d·t_r) / (d·t_f)
d'    = t_f s_f' − t_r
θ     = atan2(d_z, d_x)          θ'  = (d × d') / WB²
s_f'' = −(|d'|² + d·(κ_f n_f s_f'² − κ_r n_r)) / (d·t_f)
d''   = κ_f n_f s_f'² + t_f s_f'' − κ_r n_r                θ'' = (d × d'') / WB²
```

**CG.** The CG position is `P_cg = C_r + R(θ)c`, where `c` is the CG in the body frame. With
`q = R(θ)c` and `q⊥` equal to `q` rotated by +90°:

```
P_cg'  = t_r + θ' q⊥
P_cg'' = κ_r n_r + θ'' q⊥ − θ'² q
```

Primes are derivatives with respect to `s`. Velocities follow as `(·)' ṡ`, and accelerations as
`(·)' s̈ + (·)'' ṡ²`.

## 3. Dynamics (`src/physics/dynamics.ts`)

Each axle's two wheels are lumped together.

- `N_i`: normal contact force on axle `i`'s wheels, along `n`.
- `T_i`: tangential contact force on them, along `t`.
- `ω_i = s_i' ṡ / r_i`: spin rate, positive when rolling forward. This follows from the no-slip
  condition, because the contact point is at rest.
- `θ̇_cw = −θ' ṡ`: pitch rate, clockwise positive.

At each instant, five equations that are linear in the unknowns `[s̈, N_r, N_f, T_r, T_f]` are
solved together:

| Equation | Content |
|---|---|
| Wheel spin, rear and front | `(I_i/r_i)(s_i' s̈ + s_i'' ṡ²) = −r_i T_i − σ_i μ_i ρ_i \|R_i\| − C_rr,i r_i N_i` |
| Whole-car force (x, z) | `m P_cg'' terms = m g + Σ(N_i n_i + T_i t_i) + F_aero` |
| Whole-car moment about the CG (clockwise) | `I_p θ̈_cw + Σ I_i ω̇_i = Σ[−ρ_ci × (N_i n_i + T_i t_i) − C_rr,i r_i N_i]` |

Where:

- `ρ_i` is the axle radius at the bore contact.
- `R_i` is the force the axle exerts on axle `i`'s wheels. It comes from the wheel pair's own
  Newton equation, `R_i = m_wi (C_i' s̈ + C_i'' ṡ²) − m_wi g − N_i n_i − T_i t_i`, where `m_wi` is the
  wheels' mass and `C_i` is the axle centre. The track carries the wheels' weight directly, so the
  bore load is less than `N_i`.
- `σ_i` is the sign of the wheel's spin relative to the body. At rest it is +1, because the car
  can only start forward.
- `ρ_ci` is the vector from the CG to the contact point.
- Axle friction acts between wheel and body, so it is internal to the whole car. It appears in the
  wheel equations but not in the whole-car moment.
- Rolling resistance is modelled as a couple from the track on the wheel.

**Losses (power).**

```
P_axle = Σ μ_i ρ_i |R_i| |ω_i − θ̇_cw|
P_roll = Σ C_rr,i N_i r_i |ω_i|
P_aero = ½ ρ_air C_d A |v_cg|³
```

**Solving with exact bore load.** `R_i` is linear in the unknowns, but `|R_i|` is not. Writing
`|R_i| = e_i · R_i` with `e_i` the unit direction of `R_i` makes the system linear for a given `e_i`.
`e_i` is then updated from the solution until it changes by less than 1e-10. That takes 2–3
iterations, because the friction arm `μρ/r` is about 0.01–0.03. The remaining error in `|R_i|` is
second order in the direction error, about 1e-20 relative.

**Friction with no consistent solution.** If `μ ρ / r` approaches 1, sliding Coulomb friction has
no consistent solution, a Painlevé-type paradox, and the iteration does not converge. At the gate
this means friction holds the car (`STALLED`). While moving, the run ends as
`OUTSIDE_MODEL_VALIDITY`. Real derby axles are around 0.01–0.03.

**Approximations.**

- `μ`, `C_rr` and `C_d A` are constants, unless one of the friction refinements below is given.
- Aerodynamic drag acts at the CG and produces no pitching moment.

**Friction refinements (FRI-001; off unless given).** Two optional axle inputs exist so that
mechanisms can be tested against data (`docs/validation.md`, section 5). No default car uses them.

- *Hub drag* `Q_i` (`AxleSpec.hubDrag`): a fixed torque on axle `i`'s wheels, opposing their rotation
  relative to the body, whatever the load. It stands for hub-face rubbing with a fixed preload, a
  seal or a viscous film. It adds `−σ_i Q_i` to the wheel-spin equation and `Q_i |ω_i − θ̇_cw|` to
  `P_axle`.
- *Load-dependent coefficient* (`AxleSpec.frictionLaw`): `μ_i = μ_ref (W_i / W_ref)^(n−1)`, with
  `W_i = |R_i|/2` the load per wheel. The friction force then goes as `W^n`. `n = 1` is Coulomb;
  `n = 2/3` is elastic Hertz contact with constant interfacial shear strength (Bowden and Tabor).
  The coefficient is updated from `|R_i|` inside the same iteration as the direction `e_i`. That
  converges geometrically with ratio `|1 − n|`, so the iteration limit is 60.

The second matters for calibration. A spin-down test loads the bore with one wheel's weight,
about 0.026 N for a kit wheel, while racing loads it with about 0.45 N. A coefficient measured one
way carries over to the other only if friction is Coulomb (CHAR-006).

## 4. Energy ledger (ANA-001)

```
released PE = KE_body (translation + pitch) + KE_wheels + E_axle + E_roll + E_aero
            + KE_lateral + E_tread + E_rail friction + E_rail impact + residual
```

The four lateral terms are zero unless the lateral model runs (section 11).

Loss energies are integrated as extra state variables using the same scheme as the motion. The
residual measures the integration error; it is reported in the result and in every trace sample.

## 5. Numerics (PHY-005)

- **Integrator:** classical fourth-order Runge–Kutta, with a fixed step (default 1e-4 s).
- **Curvature jumps at joins.** The right-hand side of the equations is discontinuous at every
  join, for each axle. The handling is:
  1. The step is cut so it ends 1 nm short of the join. The landing point is refined by Newton
     corrections on the actual RK4 result.
  2. A micro-step then carries the axle 1 nm past the join.
  3. Normal steps resume on the new piece.

  Without this, the step size controls the error at about 1e-5 J. With it, the residual is about
  1e-10 J at every step size from 4e-4 s down to 5e-5 s.
- **Gate.** At `t = 0` the car is released from rest with its nose on the pin plane: the plane
  through the pin's surface point, normal to the lane.
- **Finish** (TIM-001). The finish is the moment the nose crosses the sensor plane at
  `pinS + timed distance`, measured along the surface. The crossing is located inside the step
  with cubic Hermite interpolation, then an exact RK4 sub-step is taken. The CG is never used as
  the trigger.
- **Determinism.** Identical inputs give bit-identical results on the same JavaScript engine.
  Cross-engine agreement has not yet been measured (spec 3.4).
- **Validity monitor.** A non-positive axle load means a wheel has lifted. The run then ends as
  `OUTSIDE_MODEL_VALIDITY` with no time, because the model assumes all wheels are in contact.
  The one exception is a step carrying a guide-rail impact, where friction at the rail can briefly
  exceed an axle's load. The run continues, and the hop's estimated height and airtime are recorded
  in `hops` (section 11). A car that cannot leave the gate, or stops before the finish, ends as
  `STALLED`.

## 6. Inputs and provenance

Every input is a `Sourced<T>` value carrying its provenance. The result record holds:

- each input's provenance;
- the weakest input, ranked UNKNOWN < ESTIMATED < DEFAULT < DERIVED < LOCAL/FROZEN < MEASURED <
  MANUFACTURER < RULE;
- the track profile status;
- the solver version and step size.

`EVENT_KIT_K1` is the event kit's record. All of its values are UNKNOWN until the kit is measured.
`TYPICAL_KIT_ESTIMATE` holds labelled guesses so the solver can run before measurements exist.

## 7. Verification (test/p1-p5-physics.test.ts, test/p0-track-geometry.test.ts)

| Gate | Case | Reference | Tolerance |
|---|---|---|---|
| P0 | Piece lengths, join continuity, transition drop, offset-path distance, too-large wheel rejected, 358 in finish placement | Analytic geometry | 1e-13 m |
| P1 | Frictionless car with weightless wheels on an incline | `t = √(2D/(g sin α))` | 5e-11 s |
| P1 | Energy through the curved transition, including pitch | Ledger residual | < 1e-8 J |
| P2 | Wheel inertia on an incline | `a = m g sin α / (m + ΣI/r²)`, plus the KE split | 5e-11 s |
| P3 | Axle friction and rolling loss on an incline, exact bore load | `\|R\| = βN`, `β = [kc + √(k²c² + (1−k²)(1+c²))]/(1−k²)`, `k = μρ/r`, `c = C_rr`; `a = g sin α − (kβ + c) g cos α`; loss work; `N_r+N_f = m g cos α` | 5e-11 s, 5e-10 J |
| P3 | Bore load with wheel mass | Wheel pair's Newton equation rebuilt from the trace; bore load below `N` | 1e-12 N |
| P3 | Ledger with every loss and massive wheels, through the transition | Residual at every sample | < 1e-8 J |
| P3 | Friction holds the car | `STALLED` | – |
| P4 | Drag only, incline | `s(t) = (v_t²/g sin α) ln cosh(g sin α t / v_t)` | 5e-10 s |
| P5 | Static load split on an incline | `N_f = m g cos α x_cg/WB` | 5e-11 N |
| P5 | Rearward CG is faster on a track with a transition | Monotonic ordering | – |
| P5 | CG far back lifts the front wheels | `OUTSIDE_MODEL_VALIDITY` | – |
| PHY-005 | Halving the step | Δt < 1e-8 s, residual < 1e-8 J | – |
| PHY-005 | Same inputs twice | Bit-identical | – |
| TIM-001 | Clock stops on the nose | Nose on the finish plane | 1e-9 m |
| FRI-001 | Hub drag on an incline (`test/p6-mechanisms.test.ts`) | `a = g sin α − 2Q/(m r)`; loss `2QD/r` | 5e-11 s, 5e-11 J |
| FRI-001 | Load-dependent coefficient | `n = 1` identical to Coulomb; `T_i = −μ(W_i) ρ \|R_i\|/r` at every sample | bit-identical; 5e-13 N |
| VAL-001 | Scaling: every mass, inertia and hub torque × 1.7, no air, Coulomb | Time unchanged; changes with air or `n = 2/3` | 1e-9 s |
| P6/P7 | External force on the planar motion (`test/p6-p7-lateral.test.ts`) | On the body `Δa = F/(m + ΣI/r²)`; on a wheel by virtual work: 0 at the contact point, `2F/M` at the top; power `F·v_point` | 1e-12 |
| P6 | Aligned, centred car | Never leaves the centreline; time bit-identical to the planar model | exact |
| P6 | Car set down at heading ψ | Drifts at `v tan ψ`, heading constant | 1e-15 m |
| P6 | Front toe δ, no rail | Model ODE `ψ' WB cos ψ = v(tan(ψ+δ) − tan ψ)`; rigid circle `sin ψ = s tan δ/WB` at ψ ≤ 0.03; no tread slip | 2e-3, 1e-3 |
| P7 | Square impact, frictionless | `ẏ⁺ = −e ẏ⁻`; loss `½ m (1−e²) ẏ²` | 1e-12 |
| P7 | Single yawed impact, frictionless | Gap rate `× −e`; loss with `1/m_eff = 1/m + arm²/I_z` | 1e-9, 1e-6 |
| P7 | Steady rail riding with front toe | Rear sticks, front slides, rail force from the two-equation balance | 1e-6 |
| P6/P7 | Race with strikes, rail riding and scrub | Each lateral loss positive; residual / released | < 1e-6 |
| P6/P7 | Mass scaling × 1.7 with the lateral model (yaw inertia scaled too) | Time unchanged | 1e-9 s |
| P6/P7 | Step size 1e-3 to 1.25e-4 s against 3.125e-5 s | First order: error halves and quarters; < 0.5 ms at 5e-4 s | – |

## 8. Before predictions mean anything (VAL-001)

The solver is verified: it solves its equations correctly. It is not yet validated, meaning it has
not been shown to match real races. Validation needs:

1. **CHAR-005 track survey** to replace the estimated curve shape. The BestTrack lengths, 26° slope
   and pin position come from the manufacturer drawing (`bestTrack()`); the curved lane is assumed
   to have uniform curvature (`docs/validation.md`, section 2). Surveyed points can be raced on
   directly (`docs/track-survey.md`).
2. **CHAR-001/002/003 kit measurements:** wheel radius, mass and spin inertia, axle radius, block,
   and axle datums.
3. **CHAR-006 friction calibration:** `μ` and `C_rr` from filmed runs or coast-downs at race load,
   using a set of runs separate from the validation runs. A spin-down at one wheel's weight is not
   enough unless friction is shown to be Coulomb (section 3).
4. **Alignment and rail-contact data.** Lateral dynamics and guide-rail contact are now modelled
   (section 11). Their inputs are not known: the car's toe and how it is set at the gate, the rail's
   dimensions, and the friction and restitution of a wheel face on the rail. `docs/validation.md`,
   section 7, shows what they do to the Duke comparison.
5. **A written acceptance criterion** for predicted versus measured time, frozen before the
   comparison is made.

## 9. Demo output on BestTrack 35 ft (`npm run race`)

The track is built from the manufacturer drawing with an estimated curve shape. These numbers
illustrate the model's sensitivities. They are not predictions, because the car inputs are ESTIMATED.
The Duke comparison (`docs/validation.md`) suggests the real mass and CG effects are several times
larger than shown here.

| Car (4.9 oz unless stated) | Time | Finish speed |
|---|---|---|
| No losses | 2.532 s | 4.61 m/s |
| CG 1.0 in ahead of the rear axle | 2.623 s | 4.26 m/s |
| CG 0.5 in | 2.619 s | 4.27 m/s |
| CG 2.0 in | 2.631 s | 4.23 m/s |
| CG 3.0 in | 2.639 s | 4.21 m/s |
| CG 0.25 in | front wheels lift in the transition | – |
| 4.0 oz, CG 1.0 in | 2.639 s | 4.22 m/s |
| Unlubricated axles (μ 0.35), CG 1.0 in | 2.708 s | 3.96 m/s |

## 10. Environment (AERO-001)

`environmentFrom()` derives air density from the room's temperature, pressure and relative humidity.
It treats dry air and water vapour as ideal gases, with the Buck (1996) saturation vapour pressure.
The result is 1.2041 kg/m³ for dry air at 20 °C and 101325 Pa. Humid air is lighter. Over a normal
range of room conditions, density varies by about ±5%. That changes drag by the same proportion,
which is worth a few milliseconds.

## 11. Lateral dynamics and guide-rail contact (P6, P7; `src/physics/lateral.ts`)

**Geometry.** The lane is its profile swept straight across, so laid flat it is a plane strip: `u`
along it, `y` across it, `y = 0` on the centreline. The guide rail occupies `|y| ≤ w/2` and stands
`h` high. The car's lateral state is the CG's lateral position `Y` and the yaw `ψ` of body +X from
the lane direction, positive toward the car's left. The kinetic energy `½ m Ẏ² + ½ I_z ψ̇²` has a
constant mass matrix, so the discrete energy balance below is exact.

**Inputs** (`LateralCarSpec`, `LaneLateral`): yaw inertia, the CG's lateral offset, inside wheel
spacing, toe of each axle, tread friction `μ_t`, rail friction `μ_c`, rail restitution `e`, the
start offset and heading, rail width and height, and the lane's cross slope. BestTrack's rail is
taken as 1 5/8 in by 1/4 in, the figure local rulebooks give for a standard track. That is
ESTIMATED, because BestTrack's own documents leave rail and lane dimensions open.

**Treads.** Axle `i` points along `ψ + δ_i`. Its sideways slip is

```
u_i = −v_i sin(ψ+δ_i) + cos(ψ+δ_i) (Ẏ + ψ̇ ∂y_i/∂ψ)
```

with `v_i` the axle's path speed from the planar solver. Coulomb friction is perpendicular to the
wheel plane: `|F_i| ≤ μ_t N_i`, with zero slip while sticking and opposing the slip when sliding.
Sticking at both axles is rolling without sideways slip, so a square car drifts at `v tan ψ` and a
toed car steers like a bicycle. The force's along-lane part, `−F_i sin(ψ+δ_i)`, goes to the planar
solver as a body force. It is parallel to the axle, so it exerts no torque about it.

Coulomb sliding is the right limit here. A Hertz estimate for a hard-plastic tread under 0.45 N gives
a contact strip about 17 µm wide, and Kalker's linear creep theory then saturates at a creepage near
3e-4. Any misalignment above about 0.3 mrad therefore slides the tread.

**Rail.** A wheel's inner face meets the rail's top edge at the end of the face's chord at height
`h`: offset `ξ = ±√(r² − (r−h)²)` along the wheel plane, on the side the yaw turns toward the rail.
The gap is `side · y_P − w/2`.

- **Normal impulse.** Newton restitution: `ġ⁺ = −e ġ⁻` for a contact closing from open. A contact
  that carried force in the previous step is in sustained contact and uses `e = 0`.
- **Friction.** That point of the face moves at `v (h, −ξ)/r` in the wheel plane, which is
  `v √(2h/r)`, about 0.9 v, with no component across the rail. Friction `μ_c P` opposes that motion.
  It acts on the wheel in the planar model, so it brakes the wheel's spin, adds to its bore load
  and has a vertical part.
- **Yaw.** The friction's along-lane part acts at the rail face, off the CG's line, so it yaws the
  car toward that side: `M = −(y_P − Y) F_u`.

**Time stepping.** The lateral part uses Moreau's scheme. Impulses are found at velocity level, and
positions advance by the mean of the start and end velocities. In each step:

1. Contacts whose gap is closed at the predicted midpoint are candidates.
2. Every combination is tried: stick, slide forward or slide back for each tread, and open or closed
   for each candidate contact.
3. The first combination satisfying all the laws (Coulomb's, the impact law, `P ≥ 0`, and opening
   gaps for open contacts) is taken. Nothing is regularised. A step with no consistent combination
   ends the run as `OUTSIDE_MODEL_VALIDITY`.

The planar RK4 step holds the resulting forces over the step. The lateral step is solved twice: on
an Euler estimate of the end speed, then on the speed RK4 reaches. That way a sticking tread ends
every step exactly on its rolling constraint, which makes the drift case exact.

When a wheel face will reach the rail inside a step, the step is cut there, as at track joins, and
the impact gets a step 1/1000 as long. Impact timing therefore does not depend on the step grid.
Over so short a step the treads carry only their finite friction, so the impact is the rail's alone.

**Coupling approximation.** Every body point is taken to move along the lane at its axle's path
speed. The along-lane velocity that yaw itself produces (`x ψ ψ̇`) is left out of the planar
kinetic energy. The rail bounds ψ at about the gap over the wheelbase, roughly 0.04 rad, so this is
a relative error below 1e-3 in the lateral kinematics. The bicycle test measures it: 1e-3 against
the rigid circle at ψ = 0.03.

**Energy.** Each lateral loss is minus the work its forces do on both motions. The lateral work is
the impulse times the step's mean velocity, which is exact with the constant mass matrix. The planar
work is integrated in RK4 with the other states.

- `E_tread`: scrub, including the along-lane component.
- `E_rail friction`: the planar work on the wheel plus the yaw moment's work.
- `E_rail impact`: from the normal impulses.

**Wheel hops.** Where a face strikes the rail's top edge, the front-lower part of the wheel is moving
down at about 0.8 v. The friction impulse therefore lifts that wheel, often by more than the axle
load can hold for the length of a step. The planar model keeps the wheel on the track through the
impact step. The would-be hop is estimated, with the car pivoting about the other axle:

- leaving speed `J · WB²/I_pivot`;
- returning under gravity's moment about the pivot.

The count, the largest height and the longest airtime are reported in `RaceResult.hops`. On the
estimated demo car they are about a micrometre and under a millisecond. A negative load on a step
without an impact is sustained lift and still ends the run.

**Convergence.** After a strike, a wheel bounces off the rail with each flight shorter than the
last, as a bouncing ball does, and then rides it. Once the flights are shorter than a step, the
scheme merges them. Race times therefore converge at first order but not monotonically. Against a
3.125e-5 s reference:

| Step | Error |
|---|---|
| 1e-3 s | 0.30 ms |
| 2.5e-4 s | 0.06 ms |
| 1.25e-4 s | 0.03 ms |

A run without rail contact keeps the planar model's accuracy.

**Not modelled yet:**

- roll and camber, so a cambered wheel's lower contact on the rail is not available;
- wheels sliding along their axles;
- the start pin's lateral effect;
- aerodynamic side force;
- contact between the body and the rail.

The design workspace still races the planar model, because alignment inputs are Release 2 controls
(WHL-002, WHL-009) whose legality at the event is UNKNOWN (WHL-005).
