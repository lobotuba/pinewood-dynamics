# Design workspace, M2 (spec 6, 7, 9, 12)

```sh
npm run dev      # then open the printed localhost address
npm run build    # static, offline bundle in dist/
```

The workspace runs the whole chain live. A design is evaluated to a solid, the solid to mass
properties and a build plan, those to an inspection and to the solver's car description, and the
car is raced in a background worker on BestTrack 35 ft. Every edit updates the 3D view, both
profiles, the panels and the race time.

## 1. What a design is (`src/geometry/design.ts`, spec 6.1)

A design is plain JSON, schema 1, in the car frame of 6.3: origin on the rear axle axis, +X
forward, +Y to the car's left, +Z up, metres.

```text
Blank = Block ∩ Extrude_Y(side) ∩ Extrude_Z(top) − axle slots − saw cuts
Body  = Blank − bores − pockets − weight cavities
Car   = Body + 4 wheels + 4 axles + weights
```

The blank is the sawn piece before any drilling, matching the shop order in 6.1 ("two saw cuts,
then drilling"). Holes are checked against it (section 3).

- **Profiles** (`src/geometry/profile.ts`). Closed outlines: the side in (x, z), the top in (x, y).
  The default outlines lie exactly on the block's edges, so the editor shows where the saw goes.
  Edges are straight unless:
  - a vertex is **smooth**: the outline passes through it as a spline (cubic Bézier, Catmull-Rom
    tangent, handles a third of the chord; it takes an arc's tangent where it meets an arc);
  - an edge has an **arc bulge**, tan(θ/4), a true circular arc;
  - a corner is **rounded**: replaced by an arc tangent to both edges.

  The two optional lists (`smooth` per vertex, `bulge` per edge) are absent on a plain polyline,
  so older schema-1 files still load. Curves are faceted at the same angular step as the 128-gon
  circles, and the faceting is adaptive, so no facet turns more than 2.8°.
- **Features.**
  - **Bore:** a cylinder along x, y or z.
  - **Pocket:** a box.
  - **Saw cut:** a plane; it removes the side its normal points to.
  - **Wedge cut:** two planes; it removes only where both half-spaces overlap, i.e. a V-notch.
- **Weights.** Material, cylinder or block, centre, and mounting. A cavity weight removes a matching
  hole; a top, underside or side weight sits on the surface.
- **Starter wedge.** Its tungsten cylinder now has the access bore it needs, drilled in from the
  left side. That bore makes the car slightly asymmetric: the CG sits 16 µm right of centre, which
  is real.

Projects save and open as `.pdesign.json` files. The current design also persists in browser
storage. Nothing leaves the machine (PLT-004).

## 2. Solid and mass (`src/geometry/solid.ts`, `src/mass/`)

- **Booleans.** manifold-3d, so the body is always a closed, valid solid (GEO-002). Circles are
  128-gons: 0.04 % less area than the true circle, about 3 mg of wood for a 3/8 in cavity.
- **Saw cuts.** A large cube trimmed by each plane gives the removed region, so the cut is exact
  for any orientation.
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
  by casting rays at the footprint's centre and corners; "Seat" re-seats one after a drag.
- **Speed.** A wedge with seven holes and cuts evaluates in about 25 ms, fast enough to stay live
  while dragging.

## 3. Building it (`src/build/tiers.ts`, spec 6.5, 12.6)

Every operation is listed in shop order with the tool tier it needs. The design's tier is the
highest of them.

- **How a hole is checked.** For each bore, pocket and weight cavity, rays are cast across the
  hole's whole footprint: the centre plus 8 rim points, or the corners and edge midpoints.
  - **A way in.** An end of the hole is open when a straight path out of it meets no wood of the
    finished body. A cylinder can only be made or loaded along its axis; a box from any face. So a
    weight behind an access bore narrower than itself is blocked.
  - **Entry angle.** Where the tool enters, the angle between the hole's axis and the sawn blank's
    surface normal is measured. The check also notes when part of the footprint starts off an edge.
- **Tier rules.** These are PROVISIONAL: they classify the kind of operation only, because tool
  lists and precision per tier are TBD (D-10).

  | Operation | Tier |
  |---|---|
  | Side and top outlines | BASIC, by construction (coping saw) |
  | Saw or wedge cut square to the side or top face | BASIC |
  | Bevel running the length of the car (the plane contains X only) | INTERMEDIATE: tilted band-saw table |
  | Compound-angle cut | ADVANCED: layout on two faces, several setups |
  | Bore entering square, within 5° (DEFAULT, pending 12.6 characterization) | BASIC: hand drill |
  | Bore entering a slope, or starting off an edge | ADVANCED: drill press holds the angle |
  | Rectangular through-opening | INTERMEDIATE: starter hole and scroll saw |
  | Flat-bottomed pocket | ADVANCED: drill out and chisel square, or rout |
  | Hole with no way in | cannot be made; inspection FAILS (GEO-ACCESS) |
  | Hole or cut that misses the body | flagged as removing no wood |

- **Drill access.** A sealed weight cavity gets a "Drill access" button. It adds the shortest
  straight hole from the surface to the cavity, with the weight's cross-section, so the weight can
  be pushed in.
- **Wood removed.** Each operation shows the wood it removes on its own, as a mass.

## 4. Inspection (`src/rules/cccs.ts`, spec 9)

- **Ruleset.** "CCCS Grand Prix (kit car), 2026 rules", named neutrally (9.3). Limits are stored
  in their source units and converted exactly.
- **What is checked:**
  - length, width and height of everything, wheels and axle heads included;
  - underside clearance over the full length, from the lowest non-tread point;
  - inside wheel spacing;
  - mass, with a ±2σ band;
  - wheel envelopes;
  - geometry validity: weight mounting, and whether every hole can be made;
  - locked axle datums and wheelbase.
- **Starting-gate face.** NOT EVALUATED until the pin geometry is known (CHAR-004).
- **Compliance state.** The best achievable is PROVISIONALLY COMPLIANT; any failure gives
  NONCOMPLIANT. There is no binary "legal" badge.
- **How measured values are shown.** They round toward failure, and a failing value gets more
  decimals until it reads as failing (CMP-006). A converted limit that isn't exact at display
  precision is marked ≈, with the source value alongside.

## 5. Editing controls

**Profiles** (side and top editors):

| Action | Result |
|---|---|
| Drag a vertex | move it; 0.25 mm snap, Alt turns it off |
| Click an edge | add a vertex; on an arc it lands on the arc and both halves keep the circle |
| Double-click a vertex | delete it |
| Right-click a vertex, or hover it and press S | switch between corner (square handle) and smooth (round handle) |
| Hover a corner and press R | round it off with a 1/4 in tangent arc (smaller if the edges are short) |
| Drag an edge's middle handle | bend the edge into an arc through the pointer, up to a semicircle |
| Double-click the middle handle | straighten the edge |

**Holes and cuts:**

- **Adding.** Use "Add hole or cut" in the Holes and cuts panel. Bores and pockets are made from
  a chosen face, to a depth below where the tool first meets the wood. Saw cuts come as presets:
  - nose or tail chamfer;
  - nose corner, left or right;
  - top-left or top-right edge bevel;
  - V-notch across the top.

  Each is sized from the actual sawn surface, so a chamfer on a wedge's low nose still takes the
  size asked.
- **Editing.** Every hole and cut can be edited by number: position, size, and each plane's facing
  as azimuth and elevation.
- **Dragging.** Drag holes and cuts in either profile. A cut seen edge-on in a view shows its
  removed region, a handle to move it, and a handle per plane to turn it. The selected hole or cut
  is ghosted in 3D, with an arrow toward the side a cut removes.
- **Deleting.** The Delete key removes the selected weight, hole or cut.

## 6. Verification

Headless tests:

- **`test/m2-geometry.test.ts`:**
  - mesh integrals reproduce a box exactly;
  - the uncut body equals the block minus its slots (now with outlines on the block edges);
  - the wedge's volume is its trapezoid area times the width;
  - a cavity removes its 128-gon prism exactly;
  - frontal area;
  - mass sums, and density from a weighed block;
  - a rearward weight races faster;
  - inspection;
  - weight mounting and seating.
- **`test/m2-features.test.ts`:**
  - a plain polyline is unchanged;
  - a dragged arc is the exact circle, with the half 128-gon's area;
  - splitting an arc keeps its circle;
  - a spline vertex is smooth and no facet turns more than 2.8°;
  - a rounded corner is tangent, with the exact area removed and a clamp on short edges;
  - rounding the block's nose corner removes exactly r²(1 − π/4) times the height;
  - a curved body's volume is its clipped outline area times the width;
  - cut volumes are exact for a 45° nose chamfer (a²W/2), a V-notch (d²W), a lengthwise bevel
    (c²L/2) and a compound corner (t³/6), each with its tier;
  - access through the starter's bore is BASIC;
  - a sealed cavity fails inspection, and so does a too-narrow access bore;
  - the access bore moves the CG by exactly the wood it removes;
  - a bore on the wedge's slope reads the slope angle (7.8°) and needs a drill press;
  - pockets tier as through-opening, flat-bottomed or enclosed;
  - holes and cuts that miss the body are flagged.

In the browser, headless Edge was driven through these paths with no page errors:

- **Weight access.** Delete the starter's access bore and it fails inspection; "Drill access"
  restores it.
- **Adding.** It added bores on the slope (ADVANCED) and on the flat (BASIC), a nose chamfer and a
  V-notch (both BASIC), a lengthwise bevel (INTERMEDIATE) and an underside pocket (ADVANCED). The
  design tier became ADVANCED.
- **Turning a cut.** Dragging a cut's turning handle changed its plane from 45.0° to 48.1°.
- **Smoothing and bending.** Smoothing the slope's top vertex added 0.83 g of wood (the spline
  passes outside the corner). Bending the slope upward added 9.5 g and changed the race time.
- **Straighten, undo and delete.** Straightening, undo and vertex delete all work.
- **Rounding.** Rounding both nose corners in the top view removed about 0.023 g each.

## 7. Not yet built (remaining M2 scope)

- **CERTIFIED context.** Profiles and features are not yet stopped at protected zones; violations
  are reported, not prevented.
- **Display modes.** These modes and overlays from 12.2 are missing:
  - "CG and mass properties" as its own mode;
  - wheel swept envelopes drawn in 3D;
  - the gate-contact zone;
  - axle structural zones.
- **Build tiers.** The tier rules are provisional and classify only the kind of operation. Minimum
  feature size, wall thickness and precision per tier wait on characterization (CHAR-007, D-10).
  Nothing yet requires CNC/DIGITAL.
- **Editing.** A cut can be turned in the profiles only when seen edge-on; front-view cuts are
  edited by number. There is no front profile yet (later release, 6.1).
- **Races.** The race preview is one lane on BestTrack 35 ft. The 3D race, multiple lanes and
  ghosts are M3.
- **Kit values.** Every kit dimension is still ESTIMATED. Measuring the event kit (CHAR-001..003)
  replaces them in one place: `TYPICAL_KIT_ESTIMATE` in `src/kit/kit.ts`.
- **Licence notices.** Three.js and manifold-3d ship in `public/THIRD_PARTY_NOTICES.txt` (spec 3.3).
  The libraries compiled into manifold's WebAssembly, such as Clipper2, still need checking before a
  public release.
