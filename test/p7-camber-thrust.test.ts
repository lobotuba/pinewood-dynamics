// P7 with camber, and the thrust faces that carry each wheel's axial load: the tilted face's contact
// with the rail against hand geometry, the slow slide of a tops-out face near the line the wheel rolls
// about, the incline's closed-form acceleration with thrust-face friction, and whole races.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import type { CarSpec } from "../src/physics/car.js";
import { type LateralCarSpec, type LateralModel, lateralStep, railGap } from "../src/physics/lateral.js";
import { simulateRace } from "../src/physics/race.js";
import { TYPICAL_LANE_LATERAL, type Track, bestTrack } from "../src/track/track.js";
import { G, straightIncline, testCar, testEnv } from "./helpers.js";

const d = <T>(x: T) => sourced(x, "DEFAULT", "test fixture");

const B = 0.0076; // tread width, m
const model = (o: Partial<LateralModel> = {}): LateralModel => ({
  m: 0.14,
  Iz: 3e-4,
  xc: 0.03,
  yc: 0,
  wheelbase: 0.111,
  spacing: inches(1.81),
  railWidth: inches(1.625),
  railHeight: inches(0.25),
  toe: [0, 0],
  camber: [0, 0],
  treadWidth: B,
  radius: [0.015, 0.015],
  wheelMass: [0, 0],
  muT: 0,
  muC: 0.3,
  e: 0,
  gLat: 0,
  ...o,
});

const lateralSpec = (o: Partial<{ toeF: number; heading: number; spacing: number; camberR: number; camberF: number }> = {}): LateralCarSpec => ({
  yawInertia: d(3e-4),
  cgOffset: d(0),
  insideWheelSpacing: d(o.spacing ?? inches(1.81)),
  toe: { rear: d(0), front: d(o.toeF ?? 0) },
  treadFriction: d(0.35),
  railFriction: d(0.3),
  railRestitution: d(0.5),
  start: { offset: d(0), heading: d(o.heading ?? 0) },
  camber: { rear: d(o.camberR ?? 0), front: d(o.camberF ?? 0), treadWidth: d(B) },
});
const HEAD = { radius: d(0.0015), friction: d(0.2) };
const BODY = { radius: d(0.0025), friction: d(0.4) };
const withFaces = (c: CarSpec): CarSpec => ({
  ...c,
  rear: { ...c.rear, thrustFaces: { head: HEAD, body: BODY } },
  front: { ...c.front, thrustFaces: { head: HEAD, body: BODY } },
});
const noRail = (t: Track): Track => ({ ...t, lateral: { ...TYPICAL_LANE_LATERAL, guideRail: { width: d(0), height: d(inches(0.25)) } } });

describe("P7 camber: where a tilted face meets the rail", () => {
  const h = 1e-4;
  const half = inches(1.81) / 2;
  const w = inches(1.625);
  const r = 0.015;

  it("tops out: the face's lowest rim, b sin(gamma) above the lane, meets the rail's side face", () => {
    const g = 0.05;
    const L = model({ camber: [g, g] });
    for (const Y of [0, 1e-3, -2e-3]) {
      // Left and right faces' lowest rims sit r sin(gamma) inside their face centres.
      expect(railGap(L, Y, 0, 0, 1)).toBeCloseTo(Y + half - r * Math.sin(g) - w / 2, 15);
      expect(railGap(L, Y, 0, 0, -1)).toBeCloseTo(-Y + half - r * Math.sin(g) - w / 2, 15);
    }
  });

  it("tops in: the face leans over the rail, meeting its top edge along the chord, gap along the face normal", () => {
    const g = -0.05;
    const L = model({ camber: [g, g] });
    // The inner tread edge rests on the lane, so the face centre is r cos(gamma) up; the rail's top is
    // zeta_h below it in the face's plane, where the face is zeta_h |sin(gamma)| further out.
    const zetaH = (L.railHeight - r * Math.cos(g)) / Math.cos(g);
    const Y = 1e-3;
    expect(railGap(L, Y, 0, 0, 1)).toBeCloseTo(Math.cos(g) * (Y + half + zetaH * Math.sin(g) - w / 2), 15);
  });

  /**
   * A step with the car's left faces pressed on the rail, moving into it. Yawed, the axle the nose
   * turns toward the rail touches first; square, both touch at once.
   */
  const pressed = (L: LateralModel, psi: number) => {
    const axle = psi < 0 ? 1 : 0;
    const f = (Y: number) => railGap(L, Y - 0.5 * h * 0.01, psi, axle, 1);
    let lo = -0.01;
    let hi = 0.01;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid;
      else lo = mid;
    }
    const Y = (lo + hi) / 2 - 1e-9;
    if (psi !== 0) expect(railGap(L, Y, psi, axle === 0 ? 1 : 0, 1)).toBeGreaterThan(0); // the other axle clear
    const v = 4;
    return lateralStep(L, { Y, psi, dY: -0.01, dPsi: 0 }, { h, v0: [v, v], v1: [v, v], N: [0.5, 0.5] });
  };

  it("tops out, square: the rim touches on the line the wheel rolls about, so the rail exerts no friction", () => {
    const st = pressed(model({ camber: [0.05, 0.05], toe: [0, 0] }), 0);
    const rail = st.forces.filter((f) => f.kind === "rail");
    expect(rail).toHaveLength(2);
    rail.forEach((f, j) => {
      const F = st.contacts[j]!.force;
      expect(F).toBeGreaterThan(0);
      expect(f).toMatchObject({ axle: j, side: 1, f: { t: 0, n: 0 }, spin: 0, y: F });
    });
  });

  it("tops in, square: the face normal tilts up, so the rail lifts the wheel by P sin|gamma|; friction is mu P back", () => {
    const g = -0.05;
    const st = pressed(model({ camber: [g, g] }), 0);
    const f = st.forces.find((x) => x.kind === "rail")!;
    const F = st.contacts[0]!.force;
    expect(f.f.n / F).toBeCloseTo(Math.sin(-g), 14);
    expect(f.f.t / F).toBeCloseTo(-0.3, 14);
    expect(f.y! / F).toBeCloseTo(Math.cos(g), 14);
  });

  it("tops out, yawed: the contact moves round the rim by phi = atan(sin a / (sin gamma cos a)) and slides at 2 v sin(phi/2)", () => {
    const g = 0.05;
    const v = 4;
    const ratio = (camber: number, psi: number) => {
      const L = model({ camber: [camber, camber] });
      const st = pressed(L, psi);
      const f = st.forces.find((x) => x.kind === "rail")!;
      const F = st.contacts[0]!.force;
      // Friction power at the face point, per mu P v: the along-lane force times v plus the axle torque
      // times the spin v / r (the normal does no work there); the sideways part is held still.
      return -(f.f.t * v + (v / L.radius[0]) * f.spin!) / (L.muC * F * v);
    };
    for (const psi of [-0.004, -0.002, 0.002, 0.004]) {
      const phi = Math.atan2(Math.abs(Math.sin(psi)), Math.sin(g) * Math.cos(psi));
      // The slide's sideways part, across the rail's face, is not friction's: a 1e-3 correction here.
      expect(ratio(g, psi) / (2 * Math.sin(phi / 2))).toBeCloseTo(1, 2);
    }
    // A square face slides over the rail's top edge at sqrt(2 h / r) of v, some 20 times faster.
    const square = ratio(0, -0.002);
    expect(square / Math.sqrt((2 * inches(0.25)) / 0.015)).toBeCloseTo(1, 3);
    expect(square / ratio(g, -0.002)).toBeGreaterThan(15);
  });
});

describe("P7 thrust faces: axial load costs friction at the axle head or the body", () => {
  it("on an incline a cambered car accelerates at g (sin - k (1 - m_w/m) cos) / (1 + sum I / (m r²)), k = mu_f r_f |sin gamma| / r", () => {
    const theta = Math.PI / 9;
    const mw = 0.005;
    const I = 4e-7;
    const car = testCar({ wheelMass: mw, spinInertia: I });
    const r = car.rear.wheelRadius.value;
    const m = car.mass.value;
    for (const [g, face] of [
      [0.05, BODY], // tops out: the wheels slide in, onto the body
      [-0.05, HEAD], // tops in: out, onto the axle heads
    ] as const) {
      const spec = { ...withFaces(car), lateral: lateralSpec({ camberR: g, camberF: g, spacing: 1 }) };
      const run = simulateRace(spec, noRail(straightIncline(theta, 3)), testEnv(0), { dt: 1e-3, traceEvery: 10 });
      expect(run.status).toBe("FINISHED");
      const k = (face.friction.value * face.radius.value * Math.abs(Math.sin(g))) / r;
      const expected = (G * (m * Math.sin(theta) - k * (m - 2 * mw) * Math.cos(theta))) / (m + (2 * I) / (r * r));
      for (const s of run.trace.slice(1, -1)) expect(s.a / expected).toBeCloseTo(1, 12);
      expect(run.ledger.thrustLoss).toBeGreaterThan(0);
      expect(Math.abs(run.ledger.residual) / run.ledger.released).toBeLessThan(1e-9);
    }
  });

  const toed = (o: { camber?: number; faces?: boolean; mass?: number } = {}) => {
    const k = (o.mass ?? 0.139) / 0.139;
    const base = demoCar({ mass: o.mass ?? 0.139 });
    const l = lateralSpec({ toeF: 0.004, heading: -0.006, camberR: o.camber ?? 0, camberF: o.camber ?? 0 });
    const car: CarSpec = { ...base, lateral: { ...l, yawInertia: d(3e-4 * k) } };
    return o.faces ? withFaces(car) : car;
  };

  it("square wheels riding the rail: tread and rail forces load the faces; the ledger closes", () => {
    const free = simulateRace(toed(), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    const faced = simulateRace(toed({ faces: true }), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(faced.status).toBe("FINISHED");
    expect(faced.ledger.thrustLoss).toBeGreaterThan(0);
    expect(faced.elapsedTime!).toBeGreaterThan(free.elapsedTime!);
    expect(Math.abs(faced.ledger.residual) / faced.ledger.released).toBeLessThan(1e-6);
  });

  it("tops-out camber cuts the rail-rubbing loss of a car riding the rail; the ledger closes", () => {
    const square = simulateRace(toed({ faces: true }), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    const out = simulateRace(toed({ faces: true, camber: 0.05 }), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(out.status).toBe("FINISHED");
    expect(out.ledger.railFrictionLoss).toBeLessThan(0.2 * square.ledger.railFrictionLoss);
    expect(Math.abs(out.ledger.residual) / out.ledger.released).toBeLessThan(1e-6);
  });

  it("converges with camber and thrust faces: every step from 1 ms down is within 0.1 ms of a 16x finer one", () => {
    // Bounces at e = 0.5 settle fast; the errors are tens of microseconds and not monotone at that level.
    const time = (dt: number) => simulateRace(toed({ faces: true, camber: 0.05 }), bestTrack(35), DEFAULT_ENVIRONMENT, { dt }).elapsedTime!;
    const ref = time(6.25e-5);
    for (const dt of [1e-3, 5e-4, 2.5e-4]) expect(Math.abs(time(dt) - ref)).toBeLessThan(1e-4);
  }, 120_000);

  it("still obeys mass scaling with camber and thrust faces: friction there is proportional to load", () => {
    const scaleCar = (c: CarSpec, k: number): CarSpec => {
      const ax = (a: CarSpec["rear"]) => ({ ...a, wheelMass: d(a.wheelMass.value * k), spinInertia: d(a.spinInertia.value * k) });
      return {
        ...c,
        mass: d(c.mass.value * k),
        pitchInertia: d(c.pitchInertia.value * k),
        rear: ax(c.rear),
        front: ax(c.front),
        lateral: { ...c.lateral!, yawInertia: d(c.lateral!.yawInertia.value * k) },
      };
    };
    const env = { ...DEFAULT_ENVIRONMENT, airDensity: d(0) };
    const car = toed({ faces: true, camber: 0.05 });
    const a = simulateRace(car, bestTrack(35), env, { dt: 5e-4 });
    const b = simulateRace(scaleCar(car, 1.7), bestTrack(35), env, { dt: 5e-4 });
    expect(Math.abs(b.elapsedTime! - a.elapsedTime!)).toBeLessThan(1e-9);
  });
});
