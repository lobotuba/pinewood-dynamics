// Tread creep (Kalker's linear creep, saturating at the Coulomb limit): a rolling tread under a side
// force drifts at a creepage proportional to that force, and slides beyond the limit.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import type { CarSpec } from "../src/physics/car.js";
import { type LateralCarSpec, type LateralModel, type LateralState, lateralStep } from "../src/physics/lateral.js";
import { simulateRace } from "../src/physics/race.js";
import { bestTrack } from "../src/track/track.js";
import { G } from "./helpers.js";

const d = <T>(x: T) => sourced(x, "DEFAULT", "test fixture");
const NU = 3e-4;
const model = (o: Partial<LateralModel> = {}): LateralModel => ({
  m: 0.14,
  Iz: 3e-4,
  xc: 0.05,
  yc: 0,
  wheelbase: 0.111,
  spacing: inches(1.81),
  railWidth: 0,
  railHeight: inches(0.25),
  toe: [0, 0],
  camber: [0, 0],
  treadWidth: 0,
  radius: [0.015, 0.015],
  wheelMass: [0, 0],
  muT: 0.35,
  creep: NU,
  muC: 0.3,
  e: 0,
  gLat: 0,
  ...o,
});
// Static axle loads with the CG at x_c: N_f = m g x_c / WB.
const loads = (L: LateralModel): [number, number] => [L.m * G * (1 - L.xc / L.wheelbase), (L.m * G * L.xc) / L.wheelbase];
const roll = (L: LateralModel, v: number, steps: number, h = 1e-3): LateralState => {
  let s: LateralState = { Y: 0, psi: 0, dY: 0, dPsi: 0 };
  for (let i = 0; i < steps; i++) s = lateralStep(L, s, { h, v0: [v, v], v1: [v, v], N: loads(L) }).next;
  return s;
};

describe("Tread creep", () => {
  it("drifts down a cross slope at the creepage that carries the slope's pull: nu_s v g_lat / (mu_t g)", () => {
    // Steady: the treads' impulses balance gravity across the slope each step, each tread's share in
    // proportion to its load, which is also what keeps the car from yawing.
    const gLat = 0.5;
    const L = model({ gLat });
    const v = 4;
    const s = roll(L, v, 400);
    expect(s.dY).toBeCloseTo((-NU * v * gLat) / (L.muT * G), 12);
    expect(s.dPsi).toBeCloseTo(0, 12);
  });

  it("holds rigidly at the gate, where nothing rolls, and slides beyond the limit", () => {
    const L = model({ gLat: 0.5 });
    expect(Math.abs(roll(L, 0, 50).dY)).toBeLessThan(1e-15);
    // Past the limit (g_lat > mu_t g) the treads slide, once past the creep range (slip nu_s v): the car
    // then accelerates down the slope at the difference.
    const steep = model({ gLat: 4 });
    const h = 1e-3;
    const a = roll(steep, 4, 100, h).dY;
    const b = roll(steep, 4, 200, h).dY;
    expect(b - a).toBeCloseTo(-(4 - steep.muT * G) * 100 * h, 12);
    expect(-a).toBeGreaterThan(NU * 4);
  });

  it("still obeys mass scaling in a race: the creep force is proportional to load", () => {
    const lat = (k: number): LateralCarSpec => ({
      yawInertia: d(3e-4 * k),
      cgOffset: d(0),
      insideWheelSpacing: d(inches(1.81)),
      toe: { rear: d(0), front: d(0.004) },
      treadFriction: d(0.35),
      treadCreep: d(NU),
      railFriction: d(0.3),
      railRestitution: d(0.5),
      start: { offset: d(0), heading: d(-0.006) },
    });
    const scale = (k: number): CarSpec => {
      const c = demoCar({ mass: 0.139 });
      const ax = (a: CarSpec["rear"]) => ({ ...a, wheelMass: d(a.wheelMass.value * k), spinInertia: d(a.spinInertia.value * k) });
      return { ...c, mass: d(c.mass.value * k), pitchInertia: d(c.pitchInertia.value * k), rear: ax(c.rear), front: ax(c.front), lateral: lat(k) };
    };
    const env = { ...DEFAULT_ENVIRONMENT, airDensity: d(0) };
    const a = simulateRace(scale(1), bestTrack(35), env, { dt: 5e-4 });
    const b = simulateRace(scale(1.7), bestTrack(35), env, { dt: 5e-4 });
    expect(a.status).toBe("FINISHED");
    expect(Math.abs(b.elapsedTime! - a.elapsedTime!)).toBeLessThan(1e-9);
    expect(Math.abs(a.ledger.residual) / a.ledger.released).toBeLessThan(1e-9);
  });
});
