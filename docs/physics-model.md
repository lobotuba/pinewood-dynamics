# Physics model, MVP solver (PHY-009)

Status: physics core, solver `phy-009/0.8.0`. Gates P0–P7 pass against analytic solutions
(section 7). P6 and P7, lateral dynamics and guide-rail contact, are in section 11, with camber and
the thrust faces that hold each wheel on its axle. Axial play, wheels sliding along their axles
between those faces, is in section 12; roll and the underside's clearance over the lane and rail in
section 13. The solver has been compared with one published experiment
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

Lateral motion, yaw, toe, camber, guide-rail contact and thrust-face friction are modelled when the
car has a lateral description and the lane a guide rail (section 11), and axial play when the car
gives it (section 12); otherwise the car is raced in the vertical plane only, and the result record
says which (`record.lateral`).

Not modelled: roll as a degree of freedom (its load transfer is, section 13), three-wheel running,
start-pin motion, body–track contact (it is detected and ends the run, section 13), wheel slip along
the direction of travel, and track or car flexibility.

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
| Wheel spin, rear and front | `(I_i/r_i)(s_i' s̈ + s_i'' ṡ²) = −r_i T_i − σ_i Σ_w (μ_i ρ_i \|R_w,rad\| + μ_f r_f \|A_w\|) − C_rr,i r_i N_i` |
| Whole-car force (x, z) | `m P_cg'' terms = m g + Σ(N_i n_i + T_i t_i) + F_aero` |
| Whole-car moment about the CG (clockwise) | `I_p θ̈_cw + Σ I_i ω̇_i = Σ[−ρ_ci × (N_i n_i + T_i t_i) − C_rr,i r_i N_i]` |

Where:

- `ρ_i` is the axle radius at the bore contact.
- `R_i` is the force the axle exerts on axle `i`'s wheels. It comes from the wheel pair's own
  Newton equation, `R_i = m_wi (C_i' s̈ + C_i'' ṡ²) − m_wi g − N_i n_i − T_i t_i`, where `m_wi` is the
  wheels' mass and `C_i` is the axle centre. The track carries the wheels' weight directly, so the
  bore load is less than `N_i`.
- `R_w` is one wheel's share: half of `R_i`, since roll is not modelled and the two wheels carry
  equal loads, less the external forces on that wheel (section 11), with a sideways part from the
  lateral model. The bore carries its part across the axle, `R_w,rad`; a thrust face carries its
  part along it, `A_w = R_w · a_w`, with `a_w` the outward axle direction. With square axles and
  nothing sideways, `|R_w,rad| = |R_i|/2` exactly, and the solution is bit-identical to the paired
  form.
- `σ_i` is the sign of the wheel's spin relative to the body. At rest it is +1, because the car
  can only start forward.
- `ρ_ci` is the vector from the CG to the contact point.
- Axle friction acts between wheel and body, so it is internal to the whole car. It appears in the
  wheel equations but not in the whole-car moment.
- Rolling resistance is modelled as a couple from the track on the wheel.

**Losses (power).**

```
P_axle = Σ μ_i ρ_i |R_w,rad| |ω_i − θ̇_cw|      (sum over wheels)
P_thrust = Σ μ_f r_f |A_w| |ω_i − θ̇_cw|
P_roll = Σ C_rr,i N_i r_i |ω_i|
P_aero = ½ ρ_air C_d A |v_cg|³
```

**Solving with exact bore load.** `R_i` is linear in the unknowns, but `|R_i|` is not. Writing
`|R_i| = e_i · R_i` with `e_i` the unit direction of `R_i` makes the system linear for a given `e_i`.
`e_i` is then updated from the solution until it changes by less than 1e-10. That takes 2–3
iterations, because the friction arm `μρ/r` is about 0.01–0.03. The remaining error in `|R_i|` is
second order in the direction error, about 1e-20 relative. Per wheel, the same holds for
`|R_w,rad| = e_w · R_w`, and `|A_w| = sign(A_w) A_w` with the sign iterated alongside. An axial load
whose sign reverses on every iteration is zero at the solution: the wheel sits between its faces,
where Coulomb's law allows any friction up to the limit, and here none is needed.

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
released PE = KE_body (translation + pitch) + KE_wheels + E_axle + E_thrust + E_roll + E_aero
            + KE_lateral + E_tread + E_rail friction + E_rail impact
            + E_hub strikes + E_bore slide + E_heave + residual
```

The thrust and lateral terms are zero unless the lateral model runs (section 11), and the last three
unless the wheels have axial play (section 12). `E_heave` is stored, not lost: the body raised by
wheels sliding down cambered axles.

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
  The one exception is a step carrying a guide-rail impact (a contact closing with an impulse; with
  axial play, a hub striking its face too), where friction at the rail can briefly exceed an axle's
  load. The run continues, and the hop's estimated height and airtime are recorded in `hops`
  (section 11). A wheel lifted by roll is treated the same way (section 13). The body touching the
  lane or the rail always ends the run (section 13). A car that cannot leave the gate, or stops
  before the finish, ends as `STALLED`.

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
| P7 | Single yawed impact, frictionless | Gap rate `× −e`; loss with `1/m_eff = g_Y²/m + g_ψ²/I_z` from the gap's Jacobian | 1e-9, 1e-6 |
| P7 | Steady rail riding with front toe | Rear sticks, front slides, rail force from the two-equation balance with the rim-on-edge normal | 1e-6 |
| P7 camber | Gap, tops out and tops in (`test/p7-camber-thrust.test.ts`) | Lowest rim at `r sin γ` inside the face centre; chord at the rail's top, `ζ_h \|sin γ\|` outside, gap × `cos γ` | 1e-15 m |
| P7 camber | Square, pressed on the rail | Tops out: no rail friction or axle torque. Tops in: lift `P \|sin γ\|`, drag `μ_c P` | exact, 1e-14 |
| P7 camber | Tops out, yawed 2–4 mrad | Contact `φ = atan(\|sin a\|/(sin γ cos a))` round the rim; friction power `μ_c P · 2v sin(φ/2)`; square face `√(2h/r)`, over 15× more | 5e-3 |
| P7 thrust | Cambered car on an incline, faces only | `a = g (m sin α − k (m − m_w) cos α)/(m + ΣI/r²)`, `k = μ_f r_f \|sin γ\|/r`: body face tops out, head tops in | 1e-12 |
| P7 thrust | Rail riding, and tops-out camber | Thrust loss positive; tops out cuts rail friction loss below 1/5; residual / released | < 1e-6 |
| P7 thrust | Mass scaling × 1.7 with camber and faces | Time unchanged | 1e-9 s |
| P7 thrust | Step size 1e-3 to 2.5e-4 s, camber and faces, `e = 0.5`, against 6.25e-5 s | Every step within the tolerance | 0.1 ms |
| P6/P7 | Race with strikes, rail riding and scrub | Each lateral loss positive; residual / released | < 1e-6 |
| P6/P7 | Mass scaling × 1.7 with the lateral model (yaw inertia scaled too) | Time unchanged | 1e-9 s |
| P6/P7 | Step size 1e-3 to 1.25e-4 s against 3.125e-5 s | First order: error halves and quarters; < 0.5 ms at 5e-4 s | – |
| P7 play | Slide on a turning wheel (`test/p7-axial-play.test.ts`) | Decays as `exp(−F t/(w m_w))`; bore work = slide energy lost; spin share `w/√(w² + ξ̇²)` | 1e-2, 1e-15 J, 1e-6 |
| P7 play | Gate, not turning, tops-out camber pushing `sin γ` N | Held when `F > sin γ`; else slides at `(sin γ − F)/(m_w cos²γ)`; heave work `−sin γ Σ Δξ` | exact, 2 %, 1e-12 J |
| P7 play | Hub strikes the axle head | `ξ̇⁺ = −e ξ̇⁻`; loss `½ m_w ξ̇² (1 − e²)`; inward face load | 1e-12, 1e-6 |
| P7 play | Aligned, centred car with play and faces | Time bit-identical to the planar model | exact |
| P7 play | Rail riding with front toe | The riding wheel ends on its axle head | 2 µm |
| P7 play | Strikes, bore sliding, camber's heave, faces | Each term non-zero; residual / released | < 1e-9 |
| P7 play | Play 1e-4, 1e-5, 1e-6 m | Approaches the fixed-wheel time, error falling | < 0.15 ms at 1 µm |
| P7 play | Mass scaling × 1.7, inelastic hubs | Time unchanged | 1e-6 s |
| P7 play | Step size 4e-4, 2e-4 s against 5e-5 s; bouncing hubs | First order; < 1 ms at 5e-4 s either way | – |
| Creep | Steady drift on a cross slope (`test/p6-creep.test.ts`) | `Ẏ = −ν_s v g_lat/(μ_t g)`, no yaw | 1e-12 m/s |
| Creep | At the gate (v = 0); beyond the limit | Rigid hold; once past the creep range, acceleration `g_lat − μ_t g` | 1e-15 m/s, 1e-12 |
| Creep | Mass scaling × 1.7 in a race with strikes and rail riding | Time unchanged; residual / released | 1e-9 s, 1e-9 |
| Roll | CG off the centreline (`test/p7-roll-clearance.test.ts`) | Each wheel shifted `y_c (N_r + N_f)/(4b)` | 1e-14 N |
| Roll | Cross slope, treads holding | Uphill wheels unloaded by `z_cg m g_lat/(4b)` | 1e-14 N |
| Roll | Tipping on a cross slope | Finishes at 0.98 of the slope where the lighter axle's uphill wheel reaches zero load; at 1.02 ends with that wheel lifting in roll | – |
| Clearance | A point 60 mm ahead of the front axle, BestTrack transition | Least clearance at most the arc value `R − √((x − c)² + (k − z)²)`, `k = √((R − r)² − c²)`, and within 20 µm of it; race time unchanged | 1e-9 m, 2e-5 m |
| Clearance | That point 0.3 mm above the rail statically; another beside the rail | Ends touching the guide rail at 171.1 mm; the other the lane | – |
| Clearance | The uncut block (`test/m2-geometry.test.ts`) | Underside map at the block's bottom except over the axle slots; least rail clearance the flat value less `x (x − WB)/(2R)` at the nose | ±10 % |

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
spacing, toe and camber of each axle, tread width, tread friction `μ_t`, rail friction `μ_c`, rail
restitution `e`, the start offset and heading, rail width and height, and the lane's cross slope.
Each axle's thrust faces (`AxleSpec.thrustFaces`) give a coefficient and an effective friction
radius for the axle head and the body. BestTrack's rail is
1 5/8 in by 1/4 in with a 1 in cleared middle, from the manufacturer's FAQ (MANUFACTURER).

**Treads.** Axle `i` points along `ψ + δ_i`. Its sideways slip is

```
u_i = −v_i sin(ψ+δ_i) + cos(ψ+δ_i) (Ẏ + ψ̇ ∂y_i/∂ψ)
```

with `v_i` the axle's path speed from the planar solver. Coulomb friction is perpendicular to the
wheel plane: `|F_i| ≤ μ_t N_i`, with zero slip while sticking and opposing the slip when sliding.
Sticking at both axles is rolling without sideways slip, so a square car drifts at `v tan ψ` and a
toed car steers like a bicycle. The force acts on both wheels at their tread contacts. Its along-lane
part, `−F_i sin(ψ+δ_i)`, enters the planar solver. It acts on the line each wheel rolls about, so it
exerts no torque on the spin. It loads the wheels' axles, mostly along them (thrust faces, below).

A rigid cambered wheel on a straight axle rolls without camber thrust: it turns about its axle,
and its tread contact sits on that axle's line through the lane, so the contact does not slide
sideways.

**Creep.** A Hertz estimate for a hard-plastic tread under 0.45 N gives a contact strip about 17 µm
wide. Kalker's linear creep theory then saturates at a creepage near `ν_s = 3e-4`, so any
misalignment above about 0.3 mrad slides the tread, and Coulomb sliding is the right law there. Below
the limit a rolling tread does not stick rigidly: it creeps sideways at a speed proportional to its
force,

```
F = −μ_t N u / (ν_s v)     while |F| < μ_t N;   sliding beyond, at |u| ≥ ν_s v
```

with `v` the tread's rolling speed. That matters wherever a tread holds a sustained side load below
the limit. A rigid stick holds it forever; a creeping tread relaxes it, at about a millimetre per
second at race speed. In the step the law is a compliance `ν_s v/(μ_t N h)` on a sticking tread's row
of the contact system, and a sliding tread must slip by at least `ν_s v`. At the gate (`v = 0`) the
compliance vanishes and the tread holds rigidly. `LateralCarSpec.treadCreep` gives `ν_s`, ESTIMATED;
omitted, the treads are rigid Coulomb, as before solver 0.8.0. The creep force is proportional to
load, so mass scaling still holds.

The bilinear law is the simplest saturating creep curve (Johnson and Vermeulen's is smooth). Its
one parameter is the saturation creepage, which the Hertz strip width sets.

What creep changed: with axial play, a wheel could end a yaw a fraction of a millimetre short of its
axle head and be pressed against the rail. The rigid tread then held it there, wedged between rail and
lane, rubbing the rail for the rest of the run. With the wheels started against the body, that cost
the Duke car 0.1 s. With creep the wheel creeps out to its head, and the double contact lasts about a quarter of a second.
The spread over start positions falls from 110 ms to 12 ms.

**Wheel geometry.** A wheel of radius `r` and tread width `b` has camber `γ` (positive tops out,
mirrored left and right). It rests on the lower edge of its tread, so its centre is
`r cos γ + (b/2)|sin γ|` above the lane. Its inner face is the disc inside the tread's inner rim, in
the wheel plane: forward `e1` along the heading `a = ψ + δ`, up `e2` tilted by `γ`. Inside wheel
spacing is measured between the faces' centres.

**Rail.** Across the lane, `side · y` is linear over the face, `p ξ + q ζ` in disc coordinates, with
`p = side · sin a` and `q = sin γ cos a`. The face meets the rail where that is least, over the part
of the face below the rail's top `h`:

- **Rim on the rail's side face**, at the rim point opposite the gradient, `(ξ, ζ) = −r (p, q)/√(p² + q²)`,
  when that point is below `h`. This happens with the tops out. The normal is sideways.
- **Rim on the rail's top edge** otherwise: square and tops-in faces. The contact is at the end of
  the chord at height `h` nearer the rail. The normal is common to the rim and the edge,
  perpendicular to the lane and to the rim's tangent there. With camber it tilts by about `γ`, so
  the rail presses a tops-in wheel up. A face exactly parallel to the edge (square and unyawed)
  meets it along the chord, with the face's own normal.

The gap is measured along the normal. Then:

- **Normal impulse.** Newton restitution: `ġ⁺ = −e ġ⁻` for a contact closing from open. A contact
  that carried force in the previous step is in sustained contact and uses `e = 0`.
- **Friction.** The wheel rolls about the line through its tread contact along its axle. A face
  point moves at `ω((ζ + r) e1 − ξ e2)` about it, and friction `μ_c P` opposes the part of that
  motion along the contact. On the top edge the point moves at `v √(2h/r)`, about 0.9 v. With the
  tops out, the face's lowest rim lies on the rolling line. A square car touches there and does not
  slide at all. Yawed by `a`, the contact moves `φ = atan(|sin a|/(sin γ cos a))` round the rim and
  slides at `2 v sin(φ/2)`. At 2 mrad of yaw and 3° of camber that is about v/25, against 0.9 v
  square.
- **On the planar motion.** The rail force acts on the wheel: its along-lane and vertical parts, its
  torque about the axle, and its share of that wheel's axle load. Its sideways part loads only the
  axle.
- **Yaw.** The friction's along-lane part acts at the rail face, off the CG's line, so it yaws the
  car toward that side: `M = −(y_P − Y) F_u`. The sideways parts act at the contact's lever.

**Thrust faces.** Each wheel's axle force splits into a radial part, carried by the bore, and an
axial part `A_w`, carried by a face: the body (or a washer) when the axle pushes the wheel outward,
and the axle head when inward. Its friction, `μ_f r_f |A_w|`, opposes the wheel's spin relative to
the body (section 3). Axial loads come from:

- the tread force, which pushes one wheel of an axle onto its head and the other onto the body;
- the rail's push, which presses that wheel onto its head;
- camber: `|sin γ|` of the wheel's share of the axle load. Tops in slides the wheels out onto their
  heads; tops out slides them in onto the body;
- the wheel's own sideways inertia and the cross slope.

Without axial play the faces hold the wheel exactly; with it the wheel bears on a face only at the
end of its travel (section 12).

**Power of a wheel force.** A wheel turns with the body's pitch plus its own spin relative to the
body, about the axle. A force on it works as `F · v_axle + (ω − θ̇_cw) τ_axle + θ̇_cw τ_plane`, with
`τ_axle` its torque about the axle and `τ_plane` its moment about the axle centre in the plane. This
is the work the planar equations do with that torque in the spin row and that moment in the car's
moment row, so the ledger closes.

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

Each lateral step takes its loads (the axles' normal loads for the tread limits, and with play the
bore loads) from the planar solution at its start, with the lateral forces of the last step that
carried no strike. A strike's forces are its impulses spread over its own short step, about a
thousand times their sustained size; they end with that step. Before 0.6.0 the step after a strike
took them as its loads, which for one step let the treads hold far more than they can.

**Coupling approximation.** Every body point is taken to move along the lane at its axle's path
speed. The along-lane velocity that yaw itself produces (`x ψ ψ̇`) is left out of the planar
kinetic energy. The rail bounds ψ at about the gap over the wheelbase, roughly 0.04 rad, so this is
a relative error below 1e-3 in the lateral kinematics. The bicycle test measures it: 1e-3 against
the rigid circle at ψ = 0.03.

**Energy.** Each lateral loss is minus the work its forces do on both motions. The lateral work is
the impulse times the step's mean velocity, which is exact with the constant mass matrix. The planar
work is integrated in RK4 with the other states.

- `E_tread`: scrub, including the along-lane component.
- `E_rail friction`: the planar work on the wheel plus the lateral and yaw work.
- `E_rail impact`: from the normal impulses.
- `E_thrust`: the thrust faces' friction, integrated with the planar motion.

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

A run without rail contact keeps the planar model's accuracy. With camber and thrust faces, the
toed demo car converges the same way: 0.09 ms at 1e-3 s and under 0.02 ms below that, tops out.

**Lively restitution does not converge usefully.** At `e = 0.9` a wheel pressed on the rail by its
tread bounces hundreds of times before it settles, each flight 0.9 of the last, and the step cuts
the sequence off at a different place each time. The hop count grows with every halving: 444 at
1 ms to 7782 at 0.03 ms on the demo car. Times move by 0.5–12 ms between steps. On the Duke car with
camber the mass effect swings from −41 to −164 ms. Results at `e ≥ 0.8` are not to be relied on, and
the screens no longer rank them. Tested restitutions up to 0.5 converge.

**Rounding under strikes.** In a rail strike's short step the forces are some thousand times their
usual size. The axle-friction iteration then reaches rounding with its direction changing by about
1e-10 per step, and stops there (section 3) rather than reporting no solution.

**Approximations for camber.**

- The planar model keeps a cambered axle at height `r`, not `r cos γ + (b/2)|sin γ|`. The
  difference is about 0.2 mm at 3°. That is a uniform lift on the straights, and it changes the
  curve's offset radius by 2e-4 relative.
- Friction's direction comes from the rolling motion alone. The face's sideways velocity has a part
  along a tilted normal's tangent plane, `|n_z| ẏ`, of order 1e-3 of the rolling slide.
- Faces are flat discs. Real wheel faces have a hub boss and a chamfered tread edge, which can move
  the contact.

**Not modelled yet:**

- roll;
- the start pin's lateral effect;
- aerodynamic side force;
- contact between the body and the rail.

The design workspace still races the planar model, because alignment inputs are Release 2 controls
(WHL-002, WHL-009) whose legality at the event is UNKNOWN (WHL-005).

## 12. Axial play (P7; `src/physics/play.ts`)

A kit wheel is not clamped between the axle head and the body. It slides along its axle across a
gap, commonly set near 1/32 in, and bears on a face only at either end. `LateralCarSpec.play` gives
each axle's travel, the hub's restitution on a face, and where the wheels sit at the gate (a
fraction of the travel out from the body; 1/2 if omitted). Inside wheel spacing is then measured
with the wheels pushed in against the body.

**Coordinates.** Each wheel on an axle with play adds `ξ`, its slide outward from the body along the
axle, `0 ≤ ξ ≤ travel`, to `(Y, ψ)`. The lane holds the wheel's height, so a unit of slide moves it
`cos γ` across the lane. On a cambered axle the body corner rises or falls by `sin γ` instead.

**Mass matrix.** A wheel's sideways velocity is `Ẏ + D ψ̇ + s ξ̇`, with lever `D` and slide factor
`s = side · cos γ cos δ`. The kinetic energy adds `m_w (Ẏ + D ψ̇) s ξ̇ + ½ m_w s² ξ̇²` per wheel to
`½ m Ẏ² + ½ I_z ψ̇²`. `D` and `s` are frozen at the square pose. The terms that freezes are of
relative size `|ψ|` ≈ 0.04 within the coupling, which is itself `m_w/m` ≈ 0.02 of the motion. The
matrix stays constant, so the discrete energy balance stays exact.

**Forces on a slide:**

- **Faces.** The body at `ξ = 0` and the head at `ξ = travel` are unilateral contacts with Newton
  restitution, as the rail is: the hub strikes its face. A wheel bears on a face only there, and only
  then does that face's thrust friction act on its spin. The lateral model passes dynamics.ts the
  face load (`WheelAxle.thrust`): positive on the body, negative on the head, zero in between.
- **Treads.** Each wheel has its own Coulomb tread. With play, a wheel's sideways load reaches the car
  only through a face or the bore's friction, so the two treads of an axle act separately. Sliding
  moves the tread across its rolling direction at `side · cos γ` per unit.
- **Bore.** Coulomb friction at the bore opposes the bore surface's slip. That slip has two
  components: the spin relative to the body, `w = |ω − θ̇_cw| r_axle`, and the slide rate `ξ̇`. The
  axial part of the friction is `−μ|R| ξ̇/√(w² + ξ̇²)`. While `ξ̇ ≪ w` this is a damper of rate
  `μ|R|/w`, about 0.2 N s/m at speed, so a loose 2.7 g wheel's slide decays in about 15 ms. The spin
  keeps the share `w/√(w² + ξ̇²)` of the limit (`WheelAxle.boreSpin`), so the friction's total power
  is Coulomb's, `μ|R| √(w² + ξ̇²)`. The root is taken at the step's starting slide rate, which is
  first order in `h`, and the damper is implicit. A wheel that is not yet turning (`w = 0`, at the
  gate) is held by static friction instead: a Coulomb element with limit `μ|R| h`.
- **Heave.** The lane stops a wheel sliding down a cambered axle from going into it. The body corner
  rises `sin γ` per unit of slide against the axle's load instead. The generalized force is
  `sin γ (R · n)`, with `R` the axle's force on the wheel at the step's start. Tops in pushes the
  wheels out onto their heads, tops out in onto the body. The energy goes into lifting the body,
  `E_heave`, which the planar model does not otherwise see. On a 3° axle the lift is under 0.05 mm.
- **Rail.** As in section 11, with the face moved across the lane by its slide.
- **Gravity** across the lane on the wheel.

**Two wheels as one.** When both wheels of an axle rest on faces in sustained contact with both
treads sticking, they move with the car as one. With rigid treads their forces then cannot be told
apart: this is the rigid model's static indeterminacy, and the system is singular. They are taken
equal, as on an axle without play, which is the limit of equal tread compliances. With tread creep
(section 11) each tread has its own compliance and the split follows from it.

**Search.** Each step starts from the previous step's stick/slip and open/closed states and corrects
every violated law at once. If that cycles, it enumerates every combination, as section 11 does. A
step with no consistent combination still ends the run as `OUTSIDE_MODEL_VALIDITY`.

**What it does.** While a toed car yaws, its treads hold the wheels to the lane and the body turns
over them: the wheels slide on their axles until they reach a face, in about 0.3 s on the Duke car.
A wheel riding the rail is pushed out against its head and stays there. With play the rail's blow
reaches the car through the light wheel and its head, so a strike is two impacts.

**Limit of no play.** As the travel goes to zero the race approaches the fixed-wheel result: 0.41,
0.16 and 0.09 ms away at 0.1 mm, 10 µm and 1 µm of play on the toed demo car. It does not reach it
exactly, because a pair of impacts in quick succession does not lose what one rigid strike loses.

**Convergence.** First order. With inelastic hubs the toed demo car is 0.7 ms from the 5e-5 s result
at the workspace's 0.5 ms step, and 0.2 ms at 0.2 ms; without play it is under 0.02 ms. The slower
convergence comes from the light wheels, whose loads lag a step. With bouncing
hubs (`e = 0.3`) the error is noisier and still under 0.4 ms. Bouncing hubs also make the race
sensitive to rounding: a relative change of 1e-12 in the mass moves the time by up to 0.3 ms. With
inelastic hubs that sensitivity is about 1e-7 s.

**Approximations.**

- The mass matrix is frozen at the square pose (above).
- The wheel's own sideways inertia, and the axle's load on a cambered slope, use the planar loads at
  the step's start.
- A wheel's slide does not change the lever arm of its sideways inertia in the yaw equation (under 1 mm
  against a 20 mm half-track).
- Wheel faces and hub faces are flat; the hub's own length is in the travel.

## 13. Roll, and the underside's clearance (`src/physics/lateral.ts`, `src/physics/clearance.ts`)

**Roll.** The car stays on its four wheels: roll is not a degree of freedom. What roll does to a
rigid car on a lane is move load between its left and right wheels, and that is modelled. About the
ground line under the car's centreline, the lane loads balance the moment of everything else:

```
Σ y_k N_k = −Σ_rail (y F_z − z F_y) + y_c (Σ N + Σ F_z) − z_cg m (a_y + g_lat)
```

- the rail forces at their contact points, `z` above the lane;
- the CG's offset `y_c` from the centreline, under the weight the lane and rail carry;
- the CG's sideways acceleration over the step, and the cross slope, at the CG's height `z_cg`.

Tread forces act at the lane and have no moment about it. Four wheels on a rigid body carry that
moment in a statically indeterminate way. Equal compliance at the four contacts, the same limit taken
for the treads, gives every wheel the same shift: `±M/(4b)`, with `b` the half-track. Each wheel's
lane load is then half its axle's plus or minus that (`WheelAxle.roll`). It enters:

- the wheel's own Newton equation, and so its bore load and thrust face;
- with axial play, its own tread's friction limit.

Every effect of roll is a redistribution. With Coulomb friction and both wheels loaded, it changes
each axle's total loss only through the direction of each wheel's bore load, a second-order effect.
Mass scaling still holds.

**Wheel lift in roll.** A wheel whose share falls to zero has lifted, and the model, which keeps every
wheel on the lane, no longer applies. On a step with a strike it is counted in `hops.roll`. No roll
inertia is given, so the hop is not sized. Otherwise the run ends as `OUTSIDE_MODEL_VALIDITY`.
Statically that happens where the classic tipping condition holds for the lighter axle:
`z_cg m g sin(c) = 2b N_min`.

**Underside clearance.** Only the wheels are meant to touch, but the lane's curves bring the body
closer to it. On an arc of radius `R` through both axles' contacts, the lane under body `x` departs
from the line between them by `x (x − WB)/(2R)`: away from the body between the axles in a valley
such as BestTrack's transition, and toward it beyond them. The uncut block's 44 mm nose overhang
comes 1.5 mm closer to the rail there than on the straights. A crest does the reverse.

`CarSpec.underbody` maps the underside: the lowest point of the body, or of a weight mounted outside
it, in each 2 mm cell of the plan view (`src/mass/carModel.ts` cuts the solid at each row's centre).
Each step, every point that the lane's largest curvature could bring within reach is checked:

- against the lane, along its normal at the nearest point;
- against the rail's top, if the point lies within the rail's half-width plus how far the car can
  move across (its wheel faces' gap to the rail, and any axial play).

Points with a margin of more than `κ_max |x| |x − WB| / 2 + 0.5 mm` cannot touch and are not checked;
the least clear point of each kind always is. A point that touches ends the run as
`OUTSIDE_MODEL_VALIDITY`, naming the rail or the lane and where. `RaceResult.clearance` reports the
least clearance over the race. The monitor applies no force, so a race that passes is the race
without it, bit for bit.

**Approximations.**

- Roll is quasi-static. The car's roll inertia and the time a wheel takes to unload are left out.
- The roll moment uses the CG's acceleration, not each wheel's (with play the wheels' own slides add
  under 2 % of the mass).
- Clearance is checked at the end of each step (0.5 ms, about 2 mm of travel at speed); it changes
  over centimetres.
- A planar car (no lateral description) is taken as centred over the rail.
