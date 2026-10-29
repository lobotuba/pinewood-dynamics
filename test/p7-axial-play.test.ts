// P7 with axial play: wheels that slide along their axles between the body and the axle heads. The
// bore's friction against the slide, static hold and Coulomb sliding at the gate, a hub striking its
// face, against closed forms; then whole races.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import type { CarSpec } from "../src/physics/car.js";
import type { LateralCarSpec, LateralModel, LateralState, LateralStep, WheelLoad } from "../src/physics/lateral.js";
import { playKinetic, playStep } from "../src/physics/play.js";
import { simulateRace } from "../src/physics/race.js";
import { bestTrack } from "../src/track/track.js";

const d = <T>(x: T) => sourced(x, "DEFAULT", "test fixture");

const MW = 0.0027; // one wheel, kg
const TRAVEL = 1e-3;
// A car too heavy to move: each wheel slides on its own.
const model = (o: Partial<LateralModel> = {}): LateralModel => ({
  m: 1e6,
  Iz: 1e6,
  xc: 0.03,
  yc: 0,
  wheelbase: 0.111,
  spacing: inches(1.81),
  railWidth: inches(1.625),
  railHeight: inches(0.25),
  toe: [0, 0],
  camber: [0, 0],
  treadWidth: 0.0076,
  radius: [0.015, 0.015],
  wheelMass: [2 * MW, 2 * MW],
  muT: 0,
  muC: 0.3,
  e: 0,
  gLat: 0,
  play: { travel: [TRAVEL, TRAVEL], e: 0, start: 0.5 },
  ...o,
});

const at = (xi0: number, v0: number): LateralState => ({ Y: 0, psi: 0, dY: 0, dPsi: 0, xi: [xi0, 0.5 * TRAVEL, 0.5 * TRAVEL, 0.5 * TRAVEL], dXi: [v0, 0, 0, 0] });
const loads = (friction: number, slip: number, normal = 0): WheelLoad[] => [0, 1, 2, 3].map(() => ({ friction, slip, normal }));
const run = (L: LateralModel, s0: LateralState, h: number, n: number, ld: WheelLoad[]) => {
  let s = s0;
  let st: LateralStep | null = null;
  const work = { boreSlide: 0, stops: 0, heave: 0 };
  for (let i = 0; i < n; i++) {
    st = playStep(L, s, { h, v0: [0, 0], v1: [0, 0], N: [1, 1], loads: ld, prev: st?.modes ?? {} });
    work.boreSlide += st.work.boreSlide;
    work.stops += st.work.stops;
    work.heave += st.work.heave;
    s = st.next;
  }
  return { s, st: st!, work };
};

describe("P7 axial play: a wheel sliding on its axle", () => {
  it("bore friction brakes the slide as a damper of rate mu |R| / w while the wheel turns, energy exact", () => {
    // Coulomb friction opposes the bore surface's slip (w around, xi' along): its axial part is
    // F xi' / sqrt(w^2 + xi'^2), so for xi' << w the slide decays as exp(-F t / (w m_w)).
    const L = model();
    const F = 0.07;
    const w = 0.1;
    const v0 = 1e-3;
    const h = 1e-5;
    const n = 500;
    const s0 = at(0.4e-3, v0);
    const { s, st, work } = run(L, s0, h, n, loads(F, w));
    expect(s.dXi![0]! / v0).toBeCloseTo(Math.exp((-F * n * h) / (w * MW)), 2);
    // The bore's work is exactly the kinetic energy the slide lost.
    expect(-work.boreSlide).toBeCloseTo(playKinetic(L, s0) - playKinetic(L, s), 15);
    expect((playKinetic(L, s0) - playKinetic(L, s)) / (0.5 * MW * (v0 * v0 - s.dXi![0]! ** 2))).toBeCloseTo(1, 5);
    // The spin keeps the rest of the bore's limit (at the step's starting slide rate).
    expect(st.wheels[0][0].boreSpin).toBeCloseTo(w / Math.hypot(w, s.dXi![0]!), 6);
  });

  it("at the gate, not yet turning, a wheel is held by static friction, or slides at the Coulomb limit", () => {
    // Tops-out camber: the axle's 1 N load lifts the body as the wheel slides in, a push of
    // sin(gamma) N along the axle. The bore holds it if its friction exceeds that, else the wheel
    // slides in at (sin(gamma) - F) / (m_w cos^2(gamma)).
    const g = 0.05;
    const L = model({ camber: [g, g] });
    const held = run(L, at(0.5e-3, 0), 1e-5, 100, loads(0.06, 0, -1));
    expect(held.s.dXi![0]).toBe(0);
    expect(held.s.xi![0]).toBe(0.5e-3);
    const T = 0.01;
    const slid = run(L, at(0.5e-3, 0), 1e-5, Math.round(T / 1e-5), loads(0.03, 0, -1));
    const expected = ((0.03 - Math.sin(g)) / (MW * Math.cos(g) ** 2)) * T;
    expect(slid.s.dXi![0]! / expected).toBeCloseTo(1, 1);
    expect(Math.abs(slid.s.dXi![0]! / expected - 1)).toBeLessThan(0.02);
    // All four wheels slide in alike. The lift is stored: the heave's work is the push times the slides.
    const slides = slid.s.xi!.reduce((acc, x) => acc + (x - 0.5e-3), 0);
    for (const x of slid.s.xi!) expect((x - 0.5e-3) / (slid.s.xi![0]! - 0.5e-3)).toBeCloseTo(1, 6);
    expect(slid.work.heave).toBeCloseTo(-Math.sin(g) * slides, 12);
  });

  it("a hub striking the axle head rebounds at -e times its speed, losing (1 - e^2) of its energy", () => {
    const e = 0.4;
    const L = model({ play: { travel: [TRAVEL, TRAVEL], e, start: 0.5 } });
    const v = 0.05;
    let s = at(TRAVEL - 2e-6, v);
    let st: LateralStep | null = null;
    let lost = 0;
    let struck: LateralStep | null = null;
    for (let i = 0; i < 50 && s.dXi![0]! > 0; i++) {
      st = playStep(L, s, { h: 1e-5, v0: [0, 0], v1: [0, 0], N: [1, 1], loads: loads(0, 0.1), prev: st?.modes ?? {} });
      lost -= st.work.stops;
      if (st.stops.length > 0) struck = st;
      s = st.next;
    }
    expect(s.dXi![0]!).toBeCloseTo(-e * v, 12);
    expect(lost / (0.5 * MW * v * v * (1 - e * e))).toBeCloseTo(1, 6);
    expect(struck!.stops[0]).toMatchObject({ wheel: 0, face: "head" });
    // The head carries the blow: an inward face load.
    expect(struck!.wheels[0][0].thrust!).toBeLessThan(0);
  });
});

const lateralSpec = (o: Partial<{ toeF: number; heading: number; camber: number; play: number; e: number; start: number }> = {}): LateralCarSpec => ({
  yawInertia: d(3e-4),
  cgOffset: d(0),
  insideWheelSpacing: d(inches(1.81)),
  toe: { rear: d(0), front: d(o.toeF ?? 0) },
  treadFriction: d(0.35),
  railFriction: d(0.3),
  railRestitution: d(0.5),
  start: { offset: d(0), heading: d(o.heading ?? 0) },
  camber: { rear: d(o.camber ?? 0), front: d(o.camber ?? 0), treadWidth: d(0.0076) },
  ...(o.play === 0 ? {} : { play: { rear: d(o.play ?? 0.8e-3), front: d(o.play ?? 0.8e-3), restitution: d(o.e ?? 0.3), start: d(o.start ?? 0.5) } }),
});
const HEAD = { radius: d(0.0015), friction: d(0.2) };
const BODY = { radius: d(0.0025), friction: d(0.4) };
const car = (l: LateralCarSpec, mass = 0.139): CarSpec => {
  const c = demoCar({ mass });
  return {
    ...c,
    rear: { ...c.rear, thrustFaces: { head: HEAD, body: BODY } },
    front: { ...c.front, thrustFaces: { head: HEAD, body: BODY } },
    lateral: { ...l, yawInertia: d(3e-4 * (mass / 0.139)) },
  };
};
const OPTS = { dt: 5e-4, traceEvery: 1 };

describe("P7 axial play in whole races", () => {
  it("an aligned, centred car with play races exactly as the planar model: nothing pushes a wheel along its axle", () => {
    const planar = simulateRace(demoCar({ mass: 0.139 }), bestTrack(35), DEFAULT_ENVIRONMENT, OPTS);
    const r = simulateRace(car(lateralSpec()), bestTrack(35), DEFAULT_ENVIRONMENT, OPTS);
    expect(r.record.lateral).toBe(true);
    expect(r.elapsedTime).toBe(planar.elapsedTime);
  });

  it("the rail pushes the wheel riding it out against its axle head", () => {
    const r = simulateRace(car(lateralSpec({ toeF: 0.004 })), bestTrack(35), DEFAULT_ENVIRONMENT, OPTS);
    expect(r.status).toBe("FINISHED");
    const last = r.trace[r.trace.length - 1]!.lateral!;
    expect(last.contacts.length).toBeGreaterThan(0);
    for (const c of last.contacts) expect(last.slides![2 * c.axle + (c.side === 1 ? 0 : 1)]!).toBeGreaterThan(0.8e-3 - 2e-6);
  });

  it("closes the energy ledger with hub strikes, bore sliding and camber's heave", () => {
    const r = simulateRace(car(lateralSpec({ toeF: 0.004, heading: -0.006, camber: -0.05 })), bestTrack(35), DEFAULT_ENVIRONMENT, OPTS);
    expect(r.status).toBe("FINISHED");
    const L = r.ledger;
    expect(L.stopImpactLoss).toBeGreaterThan(0);
    expect(L.boreSlideLoss).toBeGreaterThan(0);
    expect(L.heaveEnergy).not.toBe(0);
    expect(L.thrustLoss).toBeGreaterThan(0);
    expect(Math.abs(L.residual) / L.released).toBeLessThan(1e-9);
  });

  it("approaches the fixed-wheel model as the play goes to zero", () => {
    // Not exactly: with play a rail strike is two impacts, the rail on the light wheel and the wheel
    // on its head, which lose a little less than one strike of the rigid car.
    const fixed = simulateRace(car(lateralSpec({ toeF: 0.004, play: 0 })), bestTrack(35), DEFAULT_ENVIRONMENT, OPTS).elapsedTime!;
    const err = [1e-4, 1e-5, 1e-6].map((p) => Math.abs(simulateRace(car(lateralSpec({ toeF: 0.004, play: p })), bestTrack(35), DEFAULT_ENVIRONMENT, OPTS).elapsedTime! - fixed));
    expect(err[1]!).toBeLessThan(err[0]!);
    expect(err[2]!).toBeLessThan(err[1]!);
    expect(err[2]!).toBeLessThan(1.5e-4);
  }, 60_000);

  it("still obeys mass scaling: wheel strikes, bore sliding and heave all scale with the masses and loads", () => {
    const scale = (c: CarSpec, k: number): CarSpec => {
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
    // Inelastic hubs: bouncing ones make the race sensitive to rounding (see the next test).
    const c = car(lateralSpec({ toeF: 0.004, camber: -0.05, e: 0 }));
    const a = simulateRace(c, bestTrack(35), env, OPTS);
    const b = simulateRace(scale(c, 1.7), bestTrack(35), env, OPTS);
    // Equal to rounding, which the contact decisions of the light wheels amplify to about 1e-7 s.
    expect(Math.abs(b.elapsedTime! - a.elapsedTime!)).toBeLessThan(1e-6);
  });

  it("converges at first order, to within a millisecond at the workspace's step, with or without bouncing hubs", () => {
    const time = (dt: number, e: number) => simulateRace(car(lateralSpec({ toeF: 0.004, e })), bestTrack(35), DEFAULT_ENVIRONMENT, { dt }).elapsedTime!;
    const ref = time(5e-5, 0);
    const err = [4e-4, 2e-4].map((dt) => Math.abs(time(dt, 0) - ref));
    expect(err[1]!).toBeLessThan(0.6 * err[0]!);
    expect(Math.abs(time(5e-4, 0) - ref)).toBeLessThan(1e-3);
    // Hubs that bounce between the rail and the head: the error is noisier, still under a millisecond.
    expect(Math.abs(time(5e-4, 0.3) - time(5e-5, 0.3))).toBeLessThan(1e-3);
  }, 240_000);
});
