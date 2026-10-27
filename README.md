# Pinewood Dynamics

Gravity-car design, physics simulation and build software. Working name subject to trademark
clearance; see `spec/PinewoodDynamics_Controlling_Specification.txt`, the controlling document.

## Status

Milestone M1: physics core with no graphics. Verified against analytic solutions for gates P0–P5.
Not yet validated against real races. See `docs/physics-model.md`.

## Commands

```
npm install
npm test          # verification suite (P0-P5, numerics, timing, provenance)
npm run typecheck
npm run race      # demo races on the ESTIMATED 35-ft BestTrack profile
```

## Layout

- `src/core`: units (exact conversions, SI internally), provenance labels, 2D vectors
- `src/track`: lane profiles built from lines and arcs, wheel-centre offset paths, track library
- `src/physics`: car description, kinematics, dynamics, race simulation with energy ledger
- `src/kit`: event-kit record (UNKNOWN until measured) and labelled typical-kit estimates
- `test`: verification tests, named by requirement ID and physics gate
- `spec`, `branding`: requirements and brand documents
