# Design workspace, M2 first slice (spec 6, 7, 9, 12)

```
npm run dev      # then open the printed localhost address
npm run build    # static, offline bundle in dist/
```

The workspace runs the whole chain live. A design is evaluated to a solid, the solid to mass
properties, those to an inspection and to the solver's car description, and the car is raced in a
background worker on BestTrack 35 ft. Every edit updates the 3D view, both profiles, the panels and
the race time.

## 1. What a design is (`src/geometry/design.ts`, spec 6.1)

A design is plain JSON, schema 1, in the car frame of 6.3: origin on the rear axle axis, +X
forward, +Y to the car's left, +Z up, metres.

```
Body = Block ∩ Extrude_Y(side) ∩ Extrude_Z(top) − axle slots − bores/pockets − weight cavities
Car  = Body + 4 wheels + 4 axles + weights
```

- **Profiles.** Closed polylines: the side profile in (x, z), the top in (x, y). They may extend
  past the block, because the block bounds the result.
- **Features.** Bores and pockets. They are in the schema and the solid, but have no editing UI yet.
- **Weights.** Material, cylinder or block, centre, and mounting. A cavity weight removes a matching
  hole from the body; a top, underside or side weight sits on the surface.
- **Other fields.** Axle preparation state, paint, and an optional weighed uncut-block mass.

Projects save and open as `.pdesign.json` files. The current design also persists in browser
storage. Nothing leaves the machine (PLT-004).

## 2. Solid and mass (`src/geometry/solid.ts`, `src/mass/`)

- **Booleans.** manifold-3d, so the body is always a closed, valid solid (GEO-002). Circles are
  128-gons: 0.04 % less area than the true circle, about 3 mg of wood for a 3/8 in cavity.
- **Body mass properties.** Exact closed-mesh integrals (divergence theorem) for volume, centroid
  and inertia tensor, times the wood density.
- **Wood density.** ESTIMATED at 0.42 g/cm³ ± 15 %. Entering the weighed uncut block makes it
  DERIVED, and the mass band drops to zero (MAT-001).
- **Other parts.** Wheels, axles (shaft plus head, steel) and weights use closed forms, combined by
  the parallel-axis theorem.
- **Solver car.** Mass and CG come from the sum. Pitch inertia is I_yy about the CG, with wheels
  as point masses; their spin inertia is separate. The nose is the foremost point of the solid.
- **Drag area.** C_D 0.45 (ESTIMATED) times the true silhouette area of body, wheels and surface
  weights, from manifold's projection.
- **Weight mounting.** Each surface weight is checked against the body: touching, floating more
  than 0.1 mm clear, or cutting more than 1 mm³ in without a cavity. New surface weights are seated
  by casting rays at the footprint's centre and corners. "Seat" re-seats a weight after a drag.

## 3. Inspection (`src/rules/cccs.ts`, spec 9)

- **Ruleset.** "CCCS Grand Prix (kit car), 2026 rules", named neutrally (9.3). Limits are stored
  in their source units and converted exactly.
- **What is checked:**
  - length, width and height of everything, wheels and axle heads included;
  - underside clearance over the full length, from the lowest non-tread point;
  - inside wheel spacing;
  - mass, with a ±2σ band;
  - wheel envelopes;
  - weight mounting (geometry validity);
  - locked axle datums and wheelbase.
- **Starting-gate face.** NOT EVALUATED until the pin geometry is known (CHAR-004).
- **Compliance state.** The best achievable is PROVISIONALLY COMPLIANT; any failure gives
  NONCOMPLIANT. There is no binary "legal" badge.
- **How measured values are shown.** They round toward failure, and a failing value gets more
  decimals until it reads as failing (CMP-006). A converted limit that isn't exact at display
  precision is marked ≈, with the source value alongside.

## 4. Verification

Headless, in `test/m2-geometry.test.ts`:

- **Mesh integrals.** They reproduce a box exactly.
- **Uncut body.** It equals the block minus its two slots, in volume, centroid and inertia.
- **Wedge.** Its volume equals the side-outline area times the width.
- **Cavities.** A cavity removes exactly its 128-gon prism.
- **Frontal area.** It equals the block face plus both wheel pairs.
- **Mass and density.** Mass sums are exact, and density is DERIVED from a weighed block.
- **Racing.** A rearward weight is faster on BestTrack.
- **Inspection:**
  - length exactly at 7.000 in passes;
  - an overweight car is NONCOMPLIANT;
  - the mass band gives an ADVISORY;
  - rounding goes toward failure, and limits are formatted per 6.4.
- **Mounting.** Touching, floating and cutting in are told apart at ±1 mm, and seating lands on a
  sloping top to 1 µm.

In the browser, headless Edge was driven through these paths with no page errors:

- the page loads;
- dragging a profile vertex changes mass and race time;
- undo restores them exactly;
- a lead weight sized to a target mass of 10 g comes out at 10.00 g, with the SAF-003 notice,
  the adult-installs tag and the tungsten alternative;
- English units work;
- the Bottom and Left views work in X-ray;
- dragging a weight in 3D moves it by the dragged distance;
- a weight lifted off the body fails inspection, and Seat fixes it.

## 5. Not yet built (remaining M2 scope)

- **Editing UI.** Bores, pockets and plane cuts are in the solid model but have no UI; plane cuts
  are not modelled at all.
- **Profile curves.** Polylines only; arcs and smooth splines (6.1) are next.
- **CERTIFIED context.** Profiles are not yet stopped at protected zones; violations are reported,
  not prevented.
- **Display modes.** These modes and overlays from 12.2 are missing:
  - "CG and mass properties" as its own mode;
  - wheel swept envelopes drawn in 3D;
  - the gate-contact zone;
  - axle structural zones.
- **Build tiers.** Pockets and bores don't yet flag the build tier they need (12.6).
- **Races.** The race preview is one lane on BestTrack 35 ft. The 3D race, multiple lanes and
  ghosts are M3.
- **Kit values.** Every kit dimension is still ESTIMATED. Measuring the event kit (CHAR-001..003)
  replaces them in one place: `TYPICAL_KIT_ESTIMATE` in `src/kit/kit.ts`.
- **Licence notices.** Three.js and manifold-3d ship in `public/THIRD_PARTY_NOTICES.txt` (spec 3.3).
  The libraries compiled into manifold's WebAssembly, such as Clipper2, still need checking before a
  public release.
