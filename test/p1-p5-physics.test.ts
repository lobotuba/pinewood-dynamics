// Physics validation gates P1-P5 against analytic solutions (controlling spec 11.5; PHY-001..009, ANA-001).
// Straight-incline cases have closed forms because the car does not pitch and the loads are static.

import { describe, expect, it } from "vitest";
import { v2 } from "../src/core/vec2.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { NO_LOSSES } from "../src/physics/dynamics.js";
import { simulateRace } from "../src/physics/race.js";
import { bestTrack35Estimated, finishS, idealRamp } from "../src/track/track.js";
import { sourced } from "../src/core/provenance.js";
import { G, straightIncline, testCar, testEnv } from "./helpers.js";

const alpha = Math.PI / 9; // 20 deg
const D = 3; // timed distance, m
const sin = Math.sin(alpha);
const cos = Math.cos(alpha);

describe("P1 ideal gravity and energy conservation (PHY-001)", () => {
  it("frictionless point-wheel car on an incline matches t = sqrt(2D / (g sin a))", () => {
    const r = simulateRace(testCar(), straightIncline(alpha, D), testEnv(), { losses: NO_LOSSES });
    expect(r.status).toBe("FINISHED");
    expect(r.elapsedTime!).toBeCloseTo(Math.sqrt((2 * D) / (G * sin)), 10);
  });

  it("conserves energy through a curved transition, including pitch (ANA-001)", () => {
    const r = simulateRace(testCar({ spinInertia: 2e-7 }), bestTrack35Estimated(), testEnv(), { losses: NO_LOSSES });
    const l = r.ledger;
    expect(r.status).toBe("FINISHED");
    expect(Math.abs(l.residual)).toBeLessThan(1e-8);
    expect(l.kineticBody + l.kineticWheels).toBeCloseTo(l.released, 8);
  });
});

describe("P2 wheel rotational inertia (PHY-002)", () => {
  it("reduces acceleration to m g sin a / (m + sum I / r^2)", () => {
    const m = 0.14;
    const I = 4e-7; // per axle
    const rw = 0.015;
    const a = (m * G * sin) / (m + (2 * I) / (rw * rw));
    const r = simulateRace(testCar({ mass: m, spinInertia: I, wheelRadius: rw }), straightIncline(alpha, D), testEnv(), {
      losses: NO_LOSSES,
    });
    expect(r.elapsedTime!).toBeCloseTo(Math.sqrt((2 * D) / a), 10);
    expect(r.ledger.kineticWheels / (r.ledger.kineticWheels + r.ledger.kineticBody)).toBeCloseTo(
      (2 * I) / (rw * rw) / (m + (2 * I) / (rw * rw)),
      10,
    );
  });
});

describe("P3 axle friction and rolling loss (PHY-003, FRI-001)", () => {
  it("matches a = [m g sin a - (mu r_axle / r + Crr) m g cos a] / (m + sum I / r^2)", () => {
    const m = 0.14;
    const I = 4e-7;
    const rw = 0.015;
    const rAx = 0.0011;
    const mu = 0.15;
    const crr = 0.003;
    const a = (m * G * sin - ((mu * rAx) / rw + crr) * m * G * cos) / (m + (2 * I) / (rw * rw));
    const car = testCar({ mass: m, spinInertia: I, wheelRadius: rw, axleRadius: rAx, mu, crr });
    const r = simulateRace(car, straightIncline(alpha, D), testEnv(0), { traceEvery: 1 });
    expect(r.elapsedTime!).toBeCloseTo(Math.sqrt((2 * D) / a), 10);
    // Losses equal the friction work: (mu r_axle / r + Crr) m g cos a * D.
    const axleWork = ((mu * rAx) / rw) * m * G * cos * D;
    expect(r.ledger.axleLoss).toBeCloseTo(axleWork, 9);
    expect(r.ledger.rollingLoss).toBeCloseTo(crr * m * G * cos * D, 9);
    for (const s of r.trace) expect(s.Nr + s.Nf).toBeCloseTo(m * G * cos, 10);
  });

  it("reports a car that friction holds at the gate as STALLED", () => {
    const r = simulateRace(testCar({ mu: 20, axleRadius: 0.01 }), straightIncline(alpha, D), testEnv());
    expect(r.status).toBe("STALLED");
    expect(r.elapsedTime).toBeNull();
  });
});

describe("P4 aerodynamic drag and limiting case (AERO-001)", () => {
  it("matches s(t) = (vt^2 / g sin a) ln cosh(g sin a t / vt)", () => {
    const m = 0.14;
    const rho = 1.2;
    const cda = 0.05; // exaggerated so drag matters over the distance
    const vt = Math.sqrt((2 * m * G * sin) / (rho * cda));
    const k = G * sin;
    const t = (vt / k) * Math.acosh(Math.exp((D * k) / (vt * vt)));
    const r = simulateRace(testCar({ mass: m, dragArea: cda }), straightIncline(alpha, D), testEnv(rho), {
      losses: { axleFriction: false, rollingResistance: false, aero: true },
    });
    expect(r.elapsedTime!).toBeCloseTo(t, 9);
    expect(Math.abs(r.ledger.residual)).toBeLessThan(1e-10);
  });
});

describe("P5 CG and rigid-body loads (PHY-007)", () => {
  it("splits static load on an incline as N_f = m g cos a * x_cg / WB", () => {
    const m = 0.14;
    const wb = 0.111;
    const xcg = 0.03;
    const r = simulateRace(testCar({ mass: m, wheelbase: wb, cg: v2(xcg, 0.01) }), straightIncline(alpha, D), testEnv(), {
      losses: NO_LOSSES,
      traceEvery: 100,
    });
    for (const s of r.trace) {
      expect(s.Nf).toBeCloseTo((m * G * cos * xcg) / wb, 10);
      expect(s.Nr).toBeCloseTo(m * G * cos * (1 - xcg / wb), 10);
    }
  });

  it("makes a more rearward CG faster on a track with a transition (higher start, longer drop)", () => {
    const track = bestTrack35Estimated();
    const times = [0.04, 0.03, 0.02].map(
      (x) => simulateRace(testCar({ cg: v2(x, 0.008), spinInertia: 2e-7 }), track, testEnv(), { losses: NO_LOSSES }).elapsedTime!,
    );
    expect(times[1]!).toBeLessThan(times[0]!);
    expect(times[2]!).toBeLessThan(times[1]!);
  });

  it("flags front-wheel lift in the transition instead of reporting a time", () => {
    const r = simulateRace(demoCar({ cgX: 0.25 * 0.0254 }), bestTrack35Estimated(), DEFAULT_ENVIRONMENT);
    expect(r.status).toBe("OUTSIDE_MODEL_VALIDITY");
    expect(r.message).toMatch(/front wheels lift/);
    expect(r.elapsedTime).toBeNull();
  });
});

describe("PHY-005 numerics: convergence, determinism", () => {
  const track = bestTrack35Estimated();
  const car = demoCar();

  it("gives the same time to 1e-8 s when the step is halved, with residual below 1e-8 J", () => {
    const coarse = simulateRace(car, track, DEFAULT_ENVIRONMENT, { dt: 2e-4 });
    const fine = simulateRace(car, track, DEFAULT_ENVIRONMENT, { dt: 1e-4 });
    expect(Math.abs(coarse.elapsedTime! - fine.elapsedTime!)).toBeLessThan(1e-8);
    expect(Math.abs(fine.ledger.residual)).toBeLessThan(1e-8);
  });

  it("is bit-for-bit reproducible on the same engine", () => {
    const a = simulateRace(car, track, DEFAULT_ENVIRONMENT);
    const b = simulateRace(car, track, DEFAULT_ENVIRONMENT);
    expect(a.elapsedTime).toBe(b.elapsedTime);
    expect(a.ledger).toEqual(b.ledger);
  });
});

describe("TIM-001 / GATE-004 start and finish events", () => {
  it("starts with the nose on the pin plane", () => {
    const track = straightIncline(alpha, D);
    const r = simulateRace(testCar(), track, testEnv(), { losses: NO_LOSSES, traceEvery: 1 });
    const pin = track.surface.at(track.pinS).p;
    const nose0 = r.trace[0]!.nose;
    expect((nose0.x - pin.x) * Math.cos(-alpha) + (nose0.z - pin.z) * Math.sin(-alpha)).toBeCloseTo(0, 12);
  });

  it("stops the clock when the nose, not the CG, reaches the finish plane", () => {
    const track = idealRamp({
      slope: alpha,
      slopeLength: 2,
      transitionRadius: 2,
      flatLength: 6,
      pinS: 0.3,
      timedDistance: sourced(6, "DEFAULT"),
    });
    const r = simulateRace(testCar(), track, testEnv(), { losses: NO_LOSSES });
    const finishX = track.surface.at(finishS(track)).p.x; // finish plane is vertical on the flat
    const last = r.trace[r.trace.length - 1]!;
    expect(last.t).toBe(r.elapsedTime);
    expect(last.nose.x).toBeCloseTo(finishX, 9);
    expect(last.cg.x).toBeLessThan(finishX - 0.1);
  });
});

describe("MODE-004 result record", () => {
  it("records solver version, track profile status and the weakest input", () => {
    const r = simulateRace(demoCar(), bestTrack35Estimated(), DEFAULT_ENVIRONMENT);
    expect(r.record.solverVersion).toMatch(/^phy-009\//);
    expect(r.record.trackProfile).toBe("ESTIMATED");
    expect(r.record.weakestInput).toBe("ESTIMATED");
    expect(r.record.inputProvenance["car.mass"]).toBe("ESTIMATED");
  });
});
