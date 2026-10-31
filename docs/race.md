# 3D race and results, M3 (spec 13)

Status: first slice running in the browser. Choose Race in the top bar. Up to four cars, one per
lane, are raced by the authoritative solver and replayed in 3D, with results. Saved versions of a
design race as ghosts against each other and against the current design.

## 1. Setup (13.1; `src/app/racePanel.ts`)

- **Cars.** Each lane takes the current design, a saved version, or nothing. Save versions in
  Design mode with *Save version*: the design's name with the next free V number (DAT-003). They
  are kept in browser storage with the design; nothing leaves the machine (PLT-004).
- **Track.** BestTrack 35, 42 or 49 ft, profile ESTIMATED from the manufacturer drawing; the
  idealized test ramp (IDEALIZED, an exact verification profile, not a real track, 10.3); or a
  survey loaded from its CSV and fitted with the smoothing spline (`docs/track-survey.md`). A survey
  is MEASURED if its file says so, otherwise ESTIMATED, like the synthetic example. A surveyed lane
  gets the rulebook guide rail, ESTIMATED, as BestTrack does. The session carries the track as data
  (`TrackChoice`), and the worker rebuilds it.
- **Saved versions.** Listed below the setup, where they can be renamed or deleted.
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
  (3.5 in, BestTrack's) and board thickness are display only, because each lane is raced alone.
- **Cars.** Each lane's own body solid in its own paint, with wheels that turn through the distance
  travelled over their radius.
- **Countdown and release.** 3, 2, 1, GO, in real time; then the race at the replay speed.
- **Readouts.** A large clock that stops on the winning time once every car is in. A lane strip
  with each car's running or final time and speed. The finish order as cars cross.
- **Replay.** 0.25×, 1× and 4×, pause and restart.
- **Cameras.** Full track (which can be orbited), chase (following the lane chosen beside it), and finish
  line. The camera and replay speed only change what is drawn: they never touch a result (13.2).

## 4. Results (13.3)

- **Save result** keeps the result (DAT-001) with what MODE-004 asks every saved result to record:
  - compliance context, per lane and overall (CERTIFIED only if every lane's design was);
  - simulation fidelity and step;
  - ruleset;
  - track, as chosen and as named, with its profile status;
  - solver version;
  - seed (none: the solver is deterministic).

  Each lane keeps its design, compliance state and outcome.
- **Saved results** are listed in the setup panel, newest first, with their solver version, flagged
  when it is older than the current one. *Race again* (or *Re-run with* a newer solver) races the
  saved designs on the saved track and fidelity. The result is new and compared lane by lane with
  the saved one: identical, or the difference in time. A saved result is never changed (DAT-002).

- Place, elapsed time, finish speed and maximum speed per lane.
- Validity flags: status and message for a car that did not finish, any inconsistent axle
  friction, the largest ledger residual, wheel hops, the least underside clearance over the rail and
  the lane during the run, planar or lateral model, and the weakest input.
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
| Track choices | BestTrack by length; the ramp IDEALIZED with a DEFAULT timed distance; the example survey ESTIMATED with the rulebook rail, racing within 1 ms of the drawn profile it was sampled from |

Browser check (headless Edge with playwright-core): three lanes raced from two saved versions and a
different current design. The views were inspected as screenshots: setup, countdown, all three
cameras, results with the chart tooltip, and the design view after returning from race mode. A
second check covered:
- saving a result, renaming a version, and racing the saved result again ("identical" on both lanes);
- following lane 2 with the chase camera;
- loading the example survey and racing on it, then on the ramp.

The page logged no errors.

## 6. Not yet built

- **Lateral racing in the workspace.** Cars race the planar model. Alignment inputs (toe, camber,
  axial play) are Release 2 controls whose legality at the event is UNKNOWN (WHL-002, WHL-005,
  WHL-009), so a workspace car has no lateral description yet.
- **Replaying a saved result as it ran.** Saved results keep outcomes, not traces; *Race again*
  replays a fresh run.
- **Exporting saved results** with the project file (DAT-001 lists them in the project schema).
- **Lane-specific profiles** (Release 3): every lane of a track uses one profile.
