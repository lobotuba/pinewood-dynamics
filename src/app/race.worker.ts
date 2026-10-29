// Runs the authoritative solver off the UI thread (spec 11.1: the physics package has no rendering
// dependency). The workspace preview uses a 0.5 ms step; on the Duke track that reproduces the
// 0.1 ms result to 1e-9 s (docs/validation.md, 5). Race sessions (spec 13) race up to four lanes
// at the fidelity the player chose.

import { DEFAULT_ENVIRONMENT } from "../kit/kit.js";
import type { CarSpec } from "../physics/car.js";
import { simulateRace } from "../physics/race.js";
import { type Entry, type Fidelity, type Session, type TrackChoice, buildTrack, raceSession } from "../race/session.js";
import { bestTrack } from "../track/track.js";

export interface RaceRequest {
  readonly kind: "preview";
  readonly seq: number;
  readonly spec: CarSpec;
}

export interface SessionRequest {
  readonly kind: "session";
  readonly seq: number;
  readonly entries: readonly (Entry | null)[];
  readonly fidelity: Fidelity;
  readonly track: TrackChoice;
}

export interface RaceReply {
  readonly kind: "preview";
  readonly seq: number;
  readonly status: string;
  readonly message: string;
  readonly time: number | null;
  readonly finishSpeed: number | null;
  readonly track: string;
  readonly profileStatus: string;
  readonly ledger: { released: number; kinetic: number; axle: number; rolling: number; aero: number; residual: number };
}

export interface SessionReply {
  readonly kind: "session";
  readonly seq: number;
  readonly session: Session;
}

const preview = bestTrack(35);

self.onmessage = (e: MessageEvent<RaceRequest | SessionRequest>): void => {
  const req = e.data;
  if (req.kind === "session") {
    const reply: SessionReply = { kind: "session", seq: req.seq, session: raceSession(req.entries, buildTrack(req.track), DEFAULT_ENVIRONMENT, req.fidelity) };
    self.postMessage(reply);
    return;
  }
  const r = simulateRace(req.spec, preview, DEFAULT_ENVIRONMENT, { dt: 5e-4, traceEvery: 1_000_000 });
  const l = r.ledger;
  const reply: RaceReply = {
    kind: "preview",
    seq: req.seq,
    status: r.status,
    message: r.message,
    time: r.elapsedTime,
    finishSpeed: r.finishSpeed,
    track: preview.name,
    profileStatus: preview.profileStatus,
    ledger: { released: l.released, kinetic: l.kineticBody + l.kineticWheels, axle: l.axleLoss, rolling: l.rollingLoss, aero: l.aeroLoss, residual: l.residual },
  };
  self.postMessage(reply);
};
