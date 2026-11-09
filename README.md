# Pinewood Dynamics

Gravity-car design, physics simulation and build software: shape a car in 3D, race it on a simulated
track, and print the templates to build it. Runs in the browser, offline.

Version 1.0.0. "Pinewood Dynamics" is a working name, subject to trademark clearance. The controlling
document is `spec/PinewoodDynamics_Controlling_Specification.txt`.

## Running it

You need [Node.js](https://nodejs.org/) 20.19 or later (or 22.12 or later).

```
npm install
npm run dev
```

Open the address Vite prints (normally http://localhost:5173/). On first launch the app asks which block
kit and race rules your car uses. Pick **Kid** or **Builder** in the top bar.

## Known limits in 1.0

- Kit sizes come from retailers' catalogues and are ESTIMATED until you measure your own kit. Where a
  catalogue gives a wheelbase but not where offset slots sit, the rear slot is placed as on the standard
  kit (7/8 in from the rear face). Measure your block and enter the slot positions in the Kit panel.
- The physics is verified against analytic solutions and one published experiment, but is not yet
  validated against filmed runs on a real track.
- The KID level has no Add Parts step yet, and the Engineering level is not offered.

## Status

Physics core: verified against analytic solutions for gates P0–P7, including lateral dynamics,
guide-rail contact, camber, thrust-face friction, axial play and roll load transfer, with a monitor for
the body touching the lane or rail; compared with one published experiment. Not yet validated against the
owner's track. See `docs/physics-model.md` and `docs/validation.md`.

Milestone M2, 3D design workspace: running in the browser. It has side and top profiles with arcs,
splines and rounded corners; bores, pockets, saw cuts and wedge cuts; weights; a manifold solid;
live mass and CG; a build tier for every operation; inspection; and a race preview. See
`docs/design-workspace.md`.

Milestone M3, 3D race: up to four lanes raced by the solver and replayed in 3D, with saved versions
as ghosts, three cameras, replay speeds, and results with speed charts and the energy ledger. See
`docs/race.md`.

Milestone M4, build outputs: 1:1 side and top templates with scale-check bars, a printable build
sheet (targets, operations, holes, weights), and the body STL. Designs carry a compliance context:
CERTIFIED refuses any edit that breaks a rule, SANDBOX blocks nothing and watermarks everything. See
`docs/build.md` and `docs/design-workspace.md`.

KID level, first slice: a Kid / Builder switch; Shape It (a shape gallery and drawn saw lines), Add Weight
(rods that drill their own holes), Why? (rule problems in plain words, and what-if races said as car
lengths), Race and Build It. Add Parts is next. See `docs/kid-level.md`.

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
npm run screen:lateral     # the same for toe, crooked starts, rail contact, camber and axial play
                           # (--search: about 30 min; --search --play 0.8: with 0.8 mm play)
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
- `src/build`: build capability (the shop-order operations and the tool tier each needs) and the build
  package (templates, build sheet, STL, export gate)
- `src/mass`: materials, mass properties and inertia, design-to-solver car description
- `src/rules`: data-driven ruleset and inspection
- `src/app`: browser workspace (Three.js viewport, profile editors, panels, race mode, race worker)
- `src/race`: race sessions: lanes under identical conditions, replay traces, finish order
- `src/physics`: car description, kinematics, dynamics, race simulation with energy ledger
- `src/kit`: the kit library (every catalogued block kit, its wheels, a precision wheel set), each value labelled, and the player's measured kits
- `src/validation`: published comparison datasets, every value labelled published or assumed
- `test`: verification tests, named by requirement ID and physics gate
- `spec`, `branding`: requirements and brand documents

## Trademarks

Kits, tracks and race organizations are named generically in the app. Any product or organization names
in the source records and documents belong to their owners. This project is not affiliated with or
endorsed by any of them.

## License

Copyright (c) 2026 Robert Voss. All rights reserved. The source is published to read; no licence to
use, copy, modify or distribute it is granted (see `LICENSE`). Third-party components keep their own
licences (`public/THIRD_PARTY_NOTICES.txt`).
