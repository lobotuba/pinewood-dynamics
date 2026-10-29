// Race sessions (spec 13; SIM-001): up to four cars, one per lane, raced by the authoritative solver
// under identical conditions. The replay only reads the solver's trace; nothing the viewer does (the
// camera, the playback speed) touches a result.
//
// Every lane uses the same profile: lane-specific track calibration is a later release (18.4), so
// lane assignment does not change a car's time, and the session says so.

import type { Provenance } from "../core/provenance.js";
import { rotate, sub } from "../core/vec2.js";
import type { CarSpec, Environment } from "../physics/car.js";
import { type EnergyLedger, type RaceStatus, SOLVER_VERSION, simulateRace } from "../physics/race.js";
import { parseSurveyCsv, surveyedTrack } from "../track/survey.js";
import { type BestTrackLength, type ProfileStatus, TEST_RAMP, type Track, bestTrack, idealRamp } from "../track/track.js";

export const MAX_LANES = 4;

export type Fidelity = "standard" | "fine";

/** Solver step per fidelity, s. Standard is the workspace preview's step; fine is the PHY-005 default. */
export const FIDELITY_STEP: Readonly<Record<Fidelity, number>> = { standard: 5e-4, fine: 1e-4 };

/** Replay samples about this far apart, s. */
const SAMPLE_INTERVAL = 0.002;

/**
 * Which track a session races on, as data (the worker rebuilds it, and a saved result keeps it):
 * BestTrack as drawn, the idealized test ramp, or a survey fitted from its CSV (CHAR-005).
 */
export type TrackChoice =
  | { readonly kind: "besttrack"; readonly length: BestTrackLength }
  | { readonly kind: "ramp" }
  | { readonly kind: "survey"; readonly csv: string };

export function buildTrack(c: TrackChoice): Track {
  if (c.kind === "besttrack") return bestTrack(c.length);
  if (c.kind === "ramp") return idealRamp(TEST_RAMP);
  return surveyedTrack(parseSurveyCsv(c.csv)).track;
}

export interface Entry {
  readonly label: string;
  readonly spec: CarSpec;
}

/** One lane's motion: rear-axle position and pitch in the track's vertical plane, sampled in time. */
export interface LaneTrace {
  readonly t: Float64Array;
  /** Distance the rear axle has travelled from the gate along its path, m. */
  readonly distance: Float64Array;
  /** CG speed, m/s. */
  readonly speed: Float64Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly theta: Float64Array;
}

export interface LaneResult {
  readonly lane: number;
  readonly label: string;
  readonly status: RaceStatus;
  readonly message: string;
  readonly time: number | null;
  readonly finishSpeed: number | null;
  readonly maxSpeed: number;
  readonly ledger: EnergyLedger;
  /** Largest ledger residual over the trace, J. */
  readonly maxResidual: number;
  /** False if axle friction had no consistent solution at any sample. */
  readonly frictionConsistent: boolean;
  readonly hops: number;
  /** Least underside clearance over the lane and the rail, m; null when the car gives no underside. */
  readonly clearance: { readonly lane: number; readonly rail: number } | null;
  readonly lateral: boolean;
  readonly weakestInput: Provenance;
  /** Wheel radius at each axle, m (for drawing the wheels' roll). */
  readonly wheelRadius: readonly [number, number];
  readonly trace: LaneTrace;
}

export interface Session {
  readonly track: string;
  readonly profileStatus: ProfileStatus;
  readonly profileSource: string;
  readonly solverVersion: string;
  readonly dt: number;
  readonly fidelity: Fidelity;
  /** Index = lane; null where no car was entered. */
  readonly lanes: readonly (LaneResult | null)[];
}

export function raceSession(entries: readonly (Entry | null)[], track: Track, env: Environment, fidelity: Fidelity): Session {
  if (entries.length > MAX_LANES) throw new Error(`At most ${MAX_LANES} lanes`);
  const dt = FIDELITY_STEP[fidelity];
  const traceEvery = Math.max(1, Math.round(SAMPLE_INTERVAL / dt));
  const lanes = entries.map((e, lane): LaneResult | null => {
    if (!e) return null;
    const r = simulateRace(e.spec, track, env, { dt, traceEvery });
    const n = r.trace.length;
    const tr = {
      t: new Float64Array(n),
      distance: new Float64Array(n),
      speed: new Float64Array(n),
      x: new Float64Array(n),
      z: new Float64Array(n),
      theta: new Float64Array(n),
    };
    const s0 = r.trace[0]?.s ?? 0;
    r.trace.forEach((p, i) => {
      // The pose's CG is the rear axle plus the body-frame CG turned by the pitch.
      const rear = sub(p.cg, rotate(e.spec.cg.value, p.theta));
      tr.t[i] = p.t;
      tr.distance[i] = p.s - s0;
      tr.speed[i] = p.speedCg;
      tr.x[i] = rear.x;
      tr.z[i] = rear.z;
      tr.theta[i] = p.theta;
    });
    return {
      lane,
      label: e.label,
      status: r.status,
      message: r.message,
      time: r.elapsedTime,
      finishSpeed: r.finishSpeed,
      maxSpeed: r.maxSpeed,
      ledger: r.ledger,
      maxResidual: r.trace.reduce((m, p) => Math.max(m, Math.abs(p.residual)), 0),
      frictionConsistent: r.trace.every((p) => p.frictionConsistent),
      hops: r.hops.count,
      clearance: r.clearance ? { lane: r.clearance.lane, rail: r.clearance.rail } : null,
      lateral: r.record.lateral,
      weakestInput: r.record.weakestInput,
      wheelRadius: [e.spec.rear.wheelRadius.value, e.spec.front.wheelRadius.value],
      trace: tr,
    };
  });
  return {
    track: track.name,
    profileStatus: track.profileStatus,
    profileSource: track.profileSource,
    solverVersion: SOLVER_VERSION,
    dt,
    fidelity,
    lanes,
  };
}

/**
 * Places by elapsed time, 1 first. Equal times share a place (the timer's resolution is not modelled,
 * so ties are exact). Cars that did not finish have no place.
 */
export function finishOrder(lanes: readonly (LaneResult | null)[]): { lane: number; place: number | null }[] {
  const run = lanes.filter((l): l is LaneResult => l !== null);
  const finished = run.filter((l) => l.time !== null).sort((a, b) => a.time! - b.time! || a.lane - b.lane);
  const out: { lane: number; place: number | null }[] = finished.map((l) => ({ lane: l.lane, place: 1 + finished.filter((o) => o.time! < l.time!).length }));
  for (const l of run) if (l.time === null) out.push({ lane: l.lane, place: null });
  return out;
}

export interface ReplayPose {
  readonly x: number;
  readonly z: number;
  readonly theta: number;
  readonly distance: number;
  readonly speed: number;
}

/** Linear interpolation of a lane's trace at time t; held at the gate before 0 and at the last sample after. */
export function poseAt(tr: LaneTrace, t: number): ReplayPose {
  const n = tr.t.length;
  const at = (i: number): ReplayPose => ({ x: tr.x[i]!, z: tr.z[i]!, theta: tr.theta[i]!, distance: tr.distance[i]!, speed: tr.speed[i]! });
  if (n === 0) return { x: 0, z: 0, theta: 0, distance: 0, speed: 0 };
  if (!(t > tr.t[0]!)) return at(0);
  if (t >= tr.t[n - 1]!) return at(n - 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.t[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const u = (t - tr.t[lo]!) / (tr.t[hi]! - tr.t[lo]!);
  const mix = (a: Float64Array): number => a[lo]! + u * (a[hi]! - a[lo]!);
  return { x: mix(tr.x), z: mix(tr.z), theta: mix(tr.theta), distance: mix(tr.distance), speed: mix(tr.speed) };
}
