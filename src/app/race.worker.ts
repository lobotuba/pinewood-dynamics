// Runs the authoritative solver off the UI thread (spec 11.1: the physics package has no rendering
// dependency). The workspace preview uses a 0.5 ms step; on the Duke track that reproduces the
// 0.1 ms result to 1e-9 s (docs/validation.md, 5).

import { DEFAULT_ENVIRONMENT } from "../kit/kit.js";
import type { CarSpec } from "../physics/car.js";
import { simulateRace } from "../physics/race.js";
import { bestTrack } from "../track/track.js";

export interface RaceRequest {
  readonly seq: number;
  readonly spec: CarSpec;
}

export interface RaceReply {
  readonly seq: number;
  readonly status: string;
  readonly message: string;
  readonly time: number | null;
  readonly finishSpeed: number | null;
  readonly track: string;
  readonly profileStatus: string;
  readonly ledger: { released: number; kinetic: number; axle: number; rolling: number; aero: number; residual: number };
}

const track = bestTrack(35);

self.onmessage = (e: MessageEvent<RaceRequest>): void => {
  const { seq, spec } = e.data;
  const r = simulateRace(spec, track, DEFAULT_ENVIRONMENT, { dt: 5e-4, traceEvery: 1_000_000 });
  const l = r.ledger;
  const reply: RaceReply = {
    seq,
    status: r.status,
    message: r.message,
    time: r.elapsedTime,
    finishSpeed: r.finishSpeed,
    track: track.name,
    profileStatus: track.profileStatus,
    ledger: { released: l.released, kinetic: l.kineticBody + l.kineticWheels, axle: l.axleLoss, rolling: l.rollingLoss, aero: l.aeroLoss, residual: l.residual },
  };
  self.postMessage(reply);
};
