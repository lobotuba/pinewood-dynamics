# 3D race and results, M3 (spec 13)

Status: first slice running in the browser. Choose Race in the top bar. Up to four cars, one per
lane, are raced by the authoritative solver and replayed in 3D, with results. Saved versions of a
design race as ghosts against each other and against the current design.

## 1. Setup (13.1; `src/app/racePanel.ts`)

- **Cars.** Each lane takes the current design, a saved version, or nothing. Save versions in
  Design mode with *Save version*: the design's name with the next free V number (DAT-003). They
  are kept in browser storage with the design; nothing leaves the machine (PLT-004).
- **Track.** BestTrack 35, 42 or 49 ft, profile ESTIMATED from the manufacturer drawing.
- **Ruleset.** Shown, not chosen: the CCCS kit-car ruleset.
- **Compliance and readiness, shown separately.** Each lane shows its car's compliance state from
  inspection, and its model readiness: the weakest provenance among its solver inputs. Today that is
  ESTIMATED for every car, because the kit and friction values are.
- **Fidelity.** Standard races at a 0.5 ms step, as the workspace preview does. Fine races at
  0.1 ms. On BestTrack the two agree to under a microsecond (test/m3-race.test.ts).
- **Identical conditions** (SIM-001). Every lane gets the same track, air, solver and step. The
  lanes share one profile until lanes are calibrated (Release 3), so a car's lane does not change
  its time. The setup panel says so.

## 2. Session (`src/race/session.ts`)

`raceSession` races each entered lane with `simulateRace` in the worker and keeps a replay trace
about every 2 ms: time, distance from the gate, CG speed, and the rear axle's position and pitch.
The rear axle is recovered from the solver's CG and pitch with the car's own body-frame CG, so the
replayed car is exactly the solver's car. At the last sample the nose is on the finish plane.

**Finish order.** Places go by elapsed time. Equal times share a place, the next place skipping
(1, 1, 3): the solver's times are exact and the event timer's resolution is not modelled. A car
that does not finish has no place, and its status and message are shown.

## 3. Replay (13.2; `src/app/raceView.ts`)

- **Track model.** The lane profile swept across four lanes. Guide rails are 1 5/8 by 1/4 in, as the
  lateral model takes them (ESTIMATED). Also drawn: a lane-colour tile at each start, the start gate
  that drops at release, the finish line and gantry, the floor and support posts. The lane pitch
  (4 in) and board thickness are display only, because each lane is raced alone.
- **Cars.** Each lane's own body solid in its own paint, with wheels that turn through the distance
  travelled over their radius.
- **Countdown and release.** 3, 2, 1, GO, in real time; then the race at the replay speed.
- **Readouts.** A large clock that stops on the winning time once every car is in. A lane strip
  with each car's running or final time and speed. The finish order as cars cross.
- **Replay.** 0.25×, 1× and 4×, pause and restart.
- **Cameras.** Full track (which can be orbited), chase (follows the first entered lane), and finish
  line. The camera and replay speed only change what is drawn: they never touch a result (13.2).

## 4. Results (13.3)

- Place, elapsed time, finish speed and maximum speed per lane.
- Validity flags: status and message for a car that did not finish, any inconsistent axle
  friction, the largest ledger residual, wheel hops, planar or lateral model, and the weakest input.
- Profile provenance, solver version and step, and the reminder that the values are ESTIMATED.
- Speed against distance from the gate, and against time. Each chart has one axis and 2 px lane
  lines. Lane colours are categorical slots 1–4 for the dark surface; together they pass the
  palette checks on the panel colour (lightness band, chroma, colour-blind and normal-vision
  separation, 3:1 contrast). Each chart has a legend and end labels, and a crosshair whose tooltip
  reads every lane at the pointer.
- The energy ledger as shares of the energy released, per lane, with the residual. Lateral rows
  appear only when a car ran the lateral model.

## 5. Verification

`test/m3-race.test.ts`:

| Case | Reference |
|---|---|
| A lane's time | Bit-identical to `simulateRace` at the same step |
| The same car in two lanes | Identical times |
| Replay trace | Starts at the gate at t = 0; ends at the finish time with the nose on the finish plane (1e-9 m); residual < 1e-8 J |
| Finish order | Ties share a place, the next place skips; non-finishers have none |
| Replay interpolation | Held at the gate before release and at the finish after; linear between samples |
| Fine against standard fidelity | Within 1 µs |

Browser check (headless Edge with playwright-core): three lanes raced from two saved versions and a
different current design. The views were inspected as screenshots: setup, countdown, all three
cameras, results with the chart tooltip, and the design view after returning from race mode. The
page logged no errors.

## 6. Not yet built

- **Lateral racing in the workspace.** Cars race the planar model. Alignment inputs (toe, camber,
  axial play) are Release 2 controls whose legality at the event is UNKNOWN (WHL-002, WHL-005,
  WHL-009), so a workspace car has no lateral description yet.
- **Saved race results** (DAT-001) and re-running them with a newer solver (DAT-002).
- **Measured local track instance** in the setup. The survey tool exists (`docs/track-survey.md`)
  but the browser cannot load a survey yet.
- **Camera choice for the chase.** It follows the first entered lane.
- **Version management.** Versions can be raced but not yet renamed or deleted in the interface
  (`Store.deleteVersion` exists).
