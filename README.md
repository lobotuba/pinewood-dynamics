# Pinewood Dynamics

Gravity-car design, physics simulation and build software. Working name subject to trademark
clearance; see `spec/PinewoodDynamics_Controlling_Specification.txt`, the controlling document.

## Status

Milestone M1: physics core with no graphics. Verified against analytic solutions for gates P0–P5.
Compared with one published experiment; not yet validated against the owner's track. See
`docs/physics-model.md` and `docs/validation.md`.

## Commands

```
npm install
npm test          # verification suite (P0-P5, numerics, timing, provenance)
npm run typecheck
npm run race      # demo races on BestTrack 35 ft (manufacturer drawing, estimated curve shape)
npm run compare:mann2012   # blind comparison with Mann, Gibbs and Sah (2012)
npm run survey -- file.csv # fit a track survey and race on it (docs/track-survey.md)
npm run survey:precision   # how precisely a track must be surveyed
```

## Layout

- `src/core`: units (exact conversions, SI internally), provenance labels, 2D vectors
- `src/track`: lane profiles from lines and arcs or from survey points (smoothing spline), wheel-centre
  offset paths, track library
- `data/surveys`: track survey files (the EXAMPLE file is synthetic)
- `src/physics`: car description, kinematics, dynamics, race simulation with energy ledger
- `src/kit`: event-kit record (UNKNOWN until measured) and labelled typical-kit estimates
- `src/validation`: published comparison datasets, every value labelled published or assumed
- `test`: verification tests, named by requirement ID and physics gate
- `spec`, `branding`: requirements and brand documents
