# Pinewood Dynamics

Gravity-car design, physics simulation and build software. Working name subject to trademark
clearance; see `spec/PinewoodDynamics_Controlling_Specification.txt`, the controlling document.

## Status

Physics core: verified against analytic solutions for gates P0–P7, including lateral dynamics and
guide-rail contact, and compared with one published experiment. Not yet validated against the
owner's track. See `docs/physics-model.md` and `docs/validation.md`.

Milestone M2, 3D design workspace: running in the browser. It has side and top profiles with arcs,
splines and rounded corners; bores, pockets, saw cuts and wedge cuts; weights; a manifold solid;
live mass and CG; a build tier for every operation; inspection; and a race preview. See
`docs/design-workspace.md`.

## Commands

```
npm install
npm run dev       # design workspace in the browser
npm run build     # static offline bundle in dist/
npm test          # verification suite (P0-P5, numerics, timing, provenance)
npm run typecheck
npm run race      # demo races on BestTrack 35 ft (manufacturer drawing, estimated curve shape)
npm run compare:mann2012   # blind comparison with Mann, Gibbs and Sah (2012)
npm run screen:mann2012    # which loss mechanisms could explain that experiment (about 2 min)
npm run screen:lateral     # the same for toe, crooked starts and guide-rail contact (add --search)
npm run survey -- file.csv # fit a track survey and race on it (docs/track-survey.md)
npm run survey:precision   # how precisely a track must be surveyed
```

## Layout

- `src/core`: units (exact conversions, SI internally), provenance labels, 2D vectors
- `src/track`: lane profiles from lines and arcs or from survey points (smoothing spline), wheel-centre
  offset paths, track library
- `data/surveys`: track survey files (the EXAMPLE file is synthetic)
- `src/geometry`: master car model (design schema), profile curves, the manifold-3d body solid,
  and starting points for new holes and cuts
- `src/build`: build capability: the shop-order operations and the tool tier each needs
- `src/mass`: materials, mass properties and inertia, design-to-solver car description
- `src/rules`: data-driven ruleset and inspection
- `src/app`: browser workspace (Three.js viewport, profile editors, panels, race worker)
- `src/physics`: car description, kinematics, dynamics, race simulation with energy ledger
- `src/kit`: event-kit record (UNKNOWN until measured) and labelled typical-kit estimates
- `src/validation`: published comparison datasets, every value labelled published or assumed
- `test`: verification tests, named by requirement ID and physics gate
- `spec`, `branding`: requirements and brand documents
