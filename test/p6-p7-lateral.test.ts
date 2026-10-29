// P6 lateral dynamics and P7 guide-rail contact (spec 11.5): analytic cases for each mechanism, then
// whole races: the planar result is untouched by an aligned car, the energy ledger closes, mass
// scaling still holds, and step halving converges.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { carModel, type CarSpec } from "../src/physics/car.js";
import { NO_LOSSES, dynamics } from "../src/physics/dynamics.js";
import { CarKinematics } from "../src/physics/kinematics.js";
import {
  type LateralCarSpec,
  type LateralModel,
  type LateralState,
  type PlanarForce,
  lateralKinetic,
  lateralStep,
  railGap,
} from "../src/physics/lateral.js";
import { simulateRace } from "../src/physics/race.js";
import { TYPICAL_LANE_LATERAL, type Track, bestTrack } from "../src/track/track.js";
import { G, straightIncline, testCar, testEnv } from "./helpers.js";

const d = <T>(x: T) => sourced(x, "DEFAULT", "test fixture");

const lateralSpec = (o: Partial<{ toeR: number; toeF: number; heading: number; offset: number; spacing: number; muT: number; muC: number; e: number; Iz: number }> = {}): LateralCarSpec => ({
  yawInertia: d(o.Iz ?? 3e-4),
  cgOffset: d(0),
  insideWheelSpacing: d(o.spacing ?? inches(1.81)),
  toe: { rear: d(o.toeR ?? 0), front: d(o.toeF ?? 0) },
  treadFriction: d(o.muT ?? 0.35),
  railFriction: d(o.muC ?? 0.3),
  railRestitution: d(o.e ?? 0.5),
  start: { offset: d(o.offset ?? 0), heading: d(o.heading ?? 0) },
});
const withLateral = (car: CarSpec, l: LateralCarSpec): CarSpec => ({ ...car, lateral: l });
/** A track with a rail too narrow to touch, for motion away from the rail. */
const noRail = (t: Track): Track => ({ ...t, lateral: { ...TYPICAL_LANE_LATERAL, guideRail: { width: d(0), height: d(inches(0.25)) } } });

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
  radius: [0.015, 0.015],
  muT: 0.35,
  muC: 0.3,
  e: 0.5,
  gLat: 0,
  ...o,
});

describe("P7 planar coupling: external forces in the planar equations", () => {
  const car = testCar({ mass: 0.14, wheelMass: 0.005, spinInertia: 4e-7 });
  const cm = carModel(car);
  const track = straightIncline(Math.PI / 9, 3);
  const path = track.surface.offset(cm.rear.r);
  const pose = new CarKinematics(cm, path, path).pose(1);
  const env = { g: G, rho: 1.2, losses: NO_LOSSES };
  const a0 = dynamics(cm, pose, 2, env).a;
  const Meff = cm.mass + (2 * cm.rear.spinInertia) / cm.rear.r ** 2;
  const F = 0.01;
  const at = (onWheel: boolean, n: number): PlanarForce => ({ kind: "rail", axle: 0, onWheel, at: { t: 0, n }, f: { t: F, n: 0 } });

  it("a forward force on the body accelerates the car by F / (m + sum I / r²)", () => {
    expect(dynamics(cm, pose, 2, env, [at(false, 0)]).a - a0).toBeCloseTo(F / Meff, 12);
  });

  it("on a wheel it acts by virtual work: nothing at the resting contact point, twice at the top", () => {
    const r = cm.rear.r;
    expect(dynamics(cm, pose, 2, env, [at(true, -r)]).a - a0).toBeCloseTo(0, 12);
    expect(dynamics(cm, pose, 2, env, [at(true, 0)]).a - a0).toBeCloseTo(F / Meff, 12);
    expect(dynamics(cm, pose, 2, env, [at(true, r)]).a - a0).toBeCloseTo((2 * F) / Meff, 12);
    // Its power is the force times its material point's speed.
    expect(dynamics(cm, pose, 2, env, [at(true, r)]).pRail).toBeCloseTo(F * 4, 12);
    expect(dynamics(cm, pose, 2, env, [at(true, -r)]).pRail).toBeCloseTo(0, 12);
  });
});

describe("P6 lateral kinematics: rolling without sideways slip", () => {
  it("an aligned, centred car stays on the centreline and races exactly as the planar model", () => {
    const planar = simulateRace(demoCar(), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 1e-3 });
    const lat = simulateRace(withLateral(demoCar(), lateralSpec()), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 1e-3 });
    expect(lat.record.lateral).toBe(true);
    expect(lat.elapsedTime).toBe(planar.elapsedTime);
    for (const s of lat.trace) {
      expect(s.lateral!.offset).toBe(0);
      expect(s.lateral!.yaw).toBe(0);
    }
  });

  it("a car pointed off the lane drifts exactly at v tan(psi) and keeps its heading", () => {
    const psi = 0.004;
    const track = noRail(straightIncline(Math.PI / 9, 3));
    const run = (dt: number) => simulateRace(withLateral(testCar(), lateralSpec({ heading: psi, spacing: 1 })), track, testEnv(0), { dt, traceEvery: 1 });
    const err = (dt: number): number => {
      const r = run(dt);
      const s0 = r.trace[0]!.s;
      let worst = 0;
      for (const p of r.trace) {
        expect(p.lateral!.yaw).toBe(psi);
        worst = Math.max(worst, Math.abs(p.lateral!.offset - (p.s - s0) * Math.tan(psi)));
      }
      return worst;
    };
    // Exact to rounding: each step's sticking treads end on the rolling constraint at the speed RK4
    // reached, and positions advance by the mean of the start and end velocities.
    expect(err(1e-3)).toBeLessThan(1e-15);
    expect(err(5e-4)).toBeLessThan(1e-15);
  });

  it("a toed front axle steers like a bicycle: psi' WB cos(psi) = v (tan(psi + delta) - tan(psi))", () => {
    const delta = 0.01;
    const car = testCar();
    const WB = car.wheelbase.value;
    const track = noRail(straightIncline(Math.PI / 9, 3));
    const r = simulateRace(withLateral(car, lateralSpec({ toeF: delta, spacing: 1 })), track, testEnv(0), { dt: 2.5e-4, traceEvery: 1 });
    // The model's own ODE in s, integrated to high accuracy.
    const s0 = r.trace[0]!.s;
    const sEnd = r.trace.at(-1)!.s;
    let psi = 0;
    const f = (p: number): number => (Math.tan(p + delta) - Math.tan(p)) / (WB * Math.cos(p));
    const n = 20000;
    const ds = (sEnd - s0) / n;
    for (let i = 0; i < n; i++) {
      const k1 = f(psi);
      const k2 = f(psi + (ds / 2) * k1);
      const k3 = f(psi + (ds / 2) * k2);
      const k4 = f(psi + ds * k3);
      psi += (ds / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    const got = r.trace.at(-1)!.lateral!.yaw;
    expect(Math.abs(got - psi) / psi).toBeLessThan(2e-3);
    // While yaw is as small as the rail allows (0.03 rad), this is the rigid car's circle,
    // sin(psi) = s tan(delta) / WB, to O(psi²).
    const p = r.trace.find((x) => x.lateral!.yaw >= 0.03)!;
    const circle = Math.asin(((p.s - s0) * Math.tan(delta)) / WB);
    expect(Math.abs(p.lateral!.yaw - circle) / circle).toBeLessThan(1e-3);
    // Both treads roll without slip on every full step. (The finish sub-step can be far shorter than a
    // step, too short for friction to absorb the step-to-step change in the midpoint geometry; that is
    // Moreau's first-order error, over a sub-step of no length to speak of.)
    expect(r.trace.slice(0, -1).every((p) => p.lateral!.slip[0] === 0 && p.lateral!.slip[1] === 0)).toBe(true);
  });
});

describe("P7 guide-rail contact", () => {
  const h = 1e-4;
  const still = { v0: [0, 0] as const, v1: [0, 0] as const, N: [0, 0] as const };
  /** Y that puts a wheel face exactly on the rail at the step's midpoint. */
  const touching = (L: LateralModel, psi: number, dY: number, axle: 0 | 1, side: 1 | -1): number => {
    // side * gap rises with Y, since gap = side * y - w/2.
    const f = (Y: number) => side * railGap(L, Y + 0.5 * h * dY, psi, axle, side);
    let lo = -0.01;
    let hi = 0.01;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid;
      else lo = mid;
    }
    // A nanometre into the rail, so the contact is closed at the midpoint.
    return (lo + hi) / 2 - side * 1e-9;
  };

  it("a square impact of both right wheels reverses the sideways speed by e and loses (1 - e²) of its energy", () => {
    const L = model({ muT: 0, muC: 0, e: 0.5 });
    // Moving left (+y): both right wheels meet the rail's right face at once.
    const dY = 0.05;
    const Y = touching(L, 0, dY, 0, -1);
    const s: LateralState = { Y, psi: 0, dY, dPsi: 0 };
    const st = lateralStep(L, s, { h, ...still });
    expect(st.next.dY).toBeCloseTo(-0.5 * dY, 12);
    expect(st.next.dPsi).toBeCloseTo(0, 12);
    const lost = lateralKinetic(L, s) - lateralKinetic(L, st.next);
    expect(lost).toBeCloseTo(0.5 * L.m * (1 - 0.25) * dY * dY, 15);
    expect(st.work.railNormal).toBeCloseTo(-lost, 15);
  });

  it("a single yawed impact obeys the effective mass 1/m_eff = 1/m + arm²/I_z", () => {
    const L = model({ muT: 0, muC: 0, e: 0.3 });
    const psi = 0.01; // nose left: moving left, the front-right face meets the rail first
    const dY = 0.04;
    const Y = touching(L, psi, dY, 1, -1);
    expect(railGap(L, Y, psi, 0, -1)).toBeGreaterThan(0); // rear clear
    const st = lateralStep(L, { Y, psi, dY, dPsi: 0 }, { h, ...still });
    expect(st.contacts).toHaveLength(1);
    expect(st.contacts[0]).toMatchObject({ axle: 1, side: -1 });
    // Gap rate before and after, from the step's own Jacobian: dg = side (Y' + arm psi').
    const eps = 1e-7;
    const Ym = Y + 0.5 * h * dY;
    const arm = (railGap(L, Ym, psi + eps, 1, -1) - railGap(L, Ym, psi - eps, 1, -1)) / (2 * eps) / -1;
    const before = -(dY + 0);
    const after = -(st.next.dY + arm * st.next.dPsi);
    expect(after).toBeCloseTo(-0.3 * before, 9);
    const mEff = 1 / (1 / L.m + (arm * arm) / L.Iz);
    const lost = lateralKinetic(L, { Y, psi, dY, dPsi: 0 }) - lateralKinetic(L, st.next);
    expect(lost / (0.5 * mEff * (1 - 0.09) * before * before)).toBeCloseTo(1, 6);
  });

  it("rides the rail steadily with a toed front axle: rear sticks, front slides, rail force from the balance", () => {
    const delta = 0.01;
    const L = model({ toe: [0, delta] });
    const v = 4;
    const N: [number, number] = [0.8, 0.6];
    let s: LateralState = { Y: 0, psi: 0, dY: 0, dPsi: 0 };
    let st = lateralStep(L, s, { h: 1e-3, v0: [v, v], v1: [v, v], N });
    for (let i = 0; i < 20000; i++) {
      st = lateralStep(L, s, { h: 1e-3, v0: [v, v], v1: [v, v], N });
      s = st.next;
    }
    expect(st.slip).toEqual([0, -1]);
    expect(st.contacts).toHaveLength(1);
    expect(st.contacts[0]).toMatchObject({ axle: 1, side: -1 });
    expect(Math.abs(s.psi)).toBeLessThan(1e-9);
    // Balance with psi = 0: rear stick force lr, front slide force muT Nf cos(delta) toward +y... solved
    // from the two equations (Y, psi) with the contact's yaw lever including rail friction.
    const r = L.radius[1];
    const hR = L.railHeight;
    const ell = Math.sqrt(r * r - (r - hR) ** 2);
    const len = Math.sqrt(2 * r * hR);
    const xi = ell; // front edge, toed left
    const bx = L.wheelbase + (L.spacing / 2) * Math.sin(delta) + xi * Math.cos(delta);
    const by = -(L.spacing / 2) * Math.cos(delta) + xi * Math.sin(delta);
    const yP = s.Y + (by - L.yc); // psi = 0
    const lf = L.muT * N[1]; // front slides with u < 0, so the force is +
    const Wf = [Math.cos(delta), Math.cos(delta) * (L.wheelbase - L.xc)];
    const Wr = [1, -L.xc];
    const Wc = [-1, -(bx - L.xc) + (yP - s.Y) * ((L.muC * hR) / len)];
    // lr Wr + P Wc = -lf Wf
    const det = Wr[0]! * Wc[1]! - Wc[0]! * Wr[1]!;
    const P = (Wr[0]! * -lf * Wf[1]! - -lf * Wf[0]! * Wr[1]!) / det;
    const lr = (-lf * Wf[0]! * Wc[1]! - Wc[0]! * -lf * Wf[1]!) / det;
    expect(st.contacts[0]!.force / P).toBeCloseTo(1, 6);
    expect(Math.abs(lr)).toBeLessThan(L.muT * N[0]);
  });
});

describe("P6/P7 whole races", () => {
  const wobbly = (mass = 0.139) =>
    withLateral(demoCar({ mass }), lateralSpec({ toeF: 0.004, heading: -0.006, Iz: 3e-4 * (mass / 0.139) }));

  it("closes the energy ledger with rail impacts, rail friction and tread scrub, each a loss", () => {
    const r = simulateRace(wobbly(), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 5e-4, traceEvery: 1 });
    expect(r.status).toBe("FINISHED");
    const L = r.ledger;
    expect(L.railImpactLoss).toBeGreaterThan(0);
    expect(L.railFrictionLoss).toBeGreaterThan(0);
    expect(L.treadLoss).toBeGreaterThan(0);
    expect(Math.abs(L.residual) / L.released).toBeLessThan(1e-6);
    expect(r.trace.some((p) => p.lateral!.contacts.length > 0)).toBe(true);
    // Slower than the same car aligned.
    const aligned = simulateRace(demoCar(), bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(r.elapsedTime!).toBeGreaterThan(aligned.elapsedTime!);
  });

  it("still obeys mass scaling: every mass and inertia times 1.7 leaves the time unchanged without air", () => {
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
    const a = simulateRace(wobbly(), bestTrack(35), env, { dt: 5e-4 });
    const b = simulateRace(scaleCar(wobbly(), 1.7), bestTrack(35), env, { dt: 5e-4 });
    expect(Math.abs(b.elapsedTime! - a.elapsedTime!)).toBeLessThan(1e-9);
  });

  it("converges at first order: the rail bounces then settle into riding it", () => {
    // After the first strike the front wheel bounces with e = 0.5, each flight half the last, until it
    // rides the rail. Once flights are shorter than a step the scheme merges them, so convergence is
    // first order but not monotone. Errors against a 32x finer reference over an 8x range of steps:
    const time = (dt: number) => simulateRace(wobbly(), bestTrack(35), DEFAULT_ENVIRONMENT, { dt }).elapsedTime!;
    const ref = time(3.125e-5);
    const e = [1e-3, 2.5e-4, 1.25e-4].map((dt) => Math.abs(time(dt) - ref));
    expect(e[1]!).toBeLessThan(0.5 * e[0]!);
    expect(e[2]!).toBeLessThan(0.25 * e[0]!);
    // At the workspace's 5e-4 s step the time is good to well under a millisecond.
    expect(Math.abs(time(5e-4) - ref)).toBeLessThan(5e-4);
  }, 180_000);
});
