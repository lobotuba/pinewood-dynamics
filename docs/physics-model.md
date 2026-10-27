# Physics model, MVP solver (PHY-009)

Status: milestone M1, physics core with no graphics. Gates P0–P5 pass against analytic solutions
(section 7). The solver has **not** been checked against real races: the track profile and every
kit and friction value are ESTIMATED (section 8).

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
- Coulomb friction at the axle and bore;
- rolling resistance;
- aerodynamic drag;
- wheel loads from the full rigid-body balance on the slope and transition, including centripetal
  and longitudinal-acceleration effects.

Not modelled (the result record states this, and later releases add them): lateral motion, yaw,
roll, camber and toe, guide-rail contact, three-wheel running, start-pin motion, body–track
contact, wheel slip, and track or car flexibility.

## 2. Geometry and kinematics (`src/track/path.ts`, `src/physics/kinematics.ts`)

**Lane surface.** The lane is a chain of constant-curvature pieces: straight lines and circular
arcs. Each piece is joined smoothly, so position and tangent are continuous; curvature can jump
at a join. Position, unit tangent `t`, normal `n` (pointing up off the surface) and signed
curvature `κ` are exact everywhere.

**Wheel-centre paths.** For a wheel of radius `r`, the centre path is the surface offset by `r`
along `n`. An offset arc has curvature `κ/(1−κr)` and length `L(1−κr)`, so the centre path is also
lines plus arcs and stays exact. A wheel that is too large for a concave arc is rejected.

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
| Wheel spin, rear and front | `(I_i/r_i)(s_i' s̈ + s_i'' ṡ²) = −r_i T_i − σ_i μ_i ρ_i N_i − C_rr,i r_i N_i` |
| Whole-car force (x, z) | `m P_cg'' terms = m g + Σ(N_i n_i + T_i t_i) + F_aero` |
| Whole-car moment about the CG (clockwise) | `I_p θ̈_cw + Σ I_i ω̇_i = Σ[−ρ_ci × (N_i n_i + T_i t_i) − C_rr,i r_i N_i]` |

Where:

- `ρ_i` is the axle radius at the bore contact.
- `σ_i` is the sign of the wheel's spin relative to the body. At rest it is +1, because the car
  can only start forward.
- `ρ_ci` is the vector from the CG to the contact point.
- Axle friction acts between wheel and body, so it is internal to the whole car. It appears in the
  wheel equations but not in the whole-car moment.
- Rolling resistance is modelled as a couple from the track on the wheel.

**Losses (power).**

```
P_axle = Σ μ_i ρ_i N_i |ω_i − θ̇_cw|
P_roll = Σ C_rr,i N_i r_i |ω_i|
P_aero = ½ ρ_air C_d A |v_cg|³
```

**Approximations.**

- The axle–bore load is taken as the contact normal load `N_i`. This ignores the wheel's own
  weight and tangential force, which are about 4% of the load for a 2.6 g wheel. The calibrated
  `μ` absorbs it.
- `μ`, `C_rr` and `C_d A` are constants.
- Aerodynamic drag acts at the CG and produces no pitching moment.

## 4. Energy ledger (ANA-001)

```
released PE = KE_body (translation + pitch) + KE_wheels + E_axle + E_roll + E_aero + residual
```

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
  A car that cannot leave the gate, or stops before the finish, ends as `STALLED`.

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
| P3 | Axle friction and rolling loss on an incline | `a = [m g sin α − (μρ/r + C_rr) m g cos α] / (m + ΣI/r²)`, loss work, `N_r+N_f = m g cos α` | 5e-11 s, 5e-10 J |
| P3 | Friction holds the car | `STALLED` | – |
| P4 | Drag only, incline | `s(t) = (v_t²/g sin α) ln cosh(g sin α t / v_t)` | 5e-10 s |
| P5 | Static load split on an incline | `N_f = m g cos α x_cg/WB` | 5e-11 N |
| P5 | Rearward CG is faster on a track with a transition | Monotonic ordering | – |
| P5 | CG far back lifts the front wheels | `OUTSIDE_MODEL_VALIDITY` | – |
| PHY-005 | Halving the step | Δt < 1e-8 s, residual < 1e-8 J | – |
| PHY-005 | Same inputs twice | Bit-identical | – |
| TIM-001 | Clock stops on the nose | Nose on the finish plane | 1e-9 m |

## 8. Before predictions mean anything (VAL-001)

The solver is verified: it solves its equations correctly. It is not yet validated, meaning it has
not been shown to match real races. Validation needs:

1. **CHAR-005 track survey** to replace the ESTIMATED BestTrack profile (a 25° slope and 2.0 m
   transition were placeholders). Measured points will need a smooth fitted profile; the path
   module currently takes only lines and arcs.
2. **CHAR-001/002/003 kit measurements:** wheel radius, mass and spin inertia, axle radius, block,
   and axle datums.
3. **CHAR-006 friction calibration:** `μ` and `C_rr` from filmed runs or coast-downs, using a set
   of runs separate from the validation runs.
4. **A written acceptance criterion** for predicted versus measured time, frozen before the
   comparison is made.

## 9. Demo output on the estimated track (`npm run race`)

These numbers illustrate the model's sensitivities. They are not predictions: every input is
ESTIMATED.

| Car (4.9 oz unless stated) | Time | Finish speed |
|---|---|---|
| No losses | 2.612 s | 4.43 m/s |
| CG 1.0 in ahead of the rear axle | 2.718 s | 4.04 m/s |
| CG 0.5 in | 2.714 s | 4.05 m/s |
| CG 2.0 in | 2.727 s | 4.02 m/s |
| CG 3.0 in | 2.736 s | 3.99 m/s |
| CG 0.25 in | front wheels lift in the transition | – |
| 4.0 oz, CG 1.0 in | 2.735 s | 4.01 m/s |
| Unlubricated axles (μ 0.35), CG 1.0 in | 2.824 s | 3.71 m/s |
