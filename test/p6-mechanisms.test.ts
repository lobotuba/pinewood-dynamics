// Loss mechanisms beyond Coulomb axle friction (FRI-001 refinements) and the scaling argument used in
// the Duke mechanism screen (docs/validation.md, 5). Default cars use neither mechanism.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import type { AxleSpec, CarSpec } from "../src/physics/car.js";
import { simulateRace } from "../src/physics/race.js";
import { MANN_2012_TABLE2, mann2012Car, mann2012Environment, mann2012Track } from "../src/validation/mann2012.js";
import { G, straightIncline, testCar, testEnv } from "./helpers.js";

const alpha = Math.PI / 9;
const D = 3;
const d = (x: number) => sourced(x, "DEFAULT", "test fixture");
const withAxles = (c: CarSpec, f: (a: AxleSpec) => AxleSpec): CarSpec => ({ ...c, rear: f(c.rear), front: f(c.front) });

describe("Hub drag: load-independent bore torque (FRI-001 refinement)", () => {
  // Massless, spinless wheels: each wheel pair's torque balance gives T = -Q / r, so
  // a = g sin a - 2 Q / (m r), and the loss is Q times the wheel turn angle D / r on each axle.
  it("matches a = g sin a - 2Q / (m r) on an incline, with the loss in the ledger", () => {
    const m = 0.14;
    const rw = 0.015;
    const Q = 2e-4;
    const car = withAxles(testCar({ mass: m, wheelRadius: rw }), (a) => ({ ...a, hubDrag: d(Q) }));
    const r = simulateRace(car, straightIncline(alpha, D), testEnv(0));
    const a = G * Math.sin(alpha) - (2 * Q) / (m * rw);
    expect(r.elapsedTime!).toBeCloseTo(Math.sqrt((2 * D) / a), 10);
    expect(r.ledger.axleLoss).toBeCloseTo((2 * Q * D) / rw, 10);
    expect(Math.abs(r.ledger.residual)).toBeLessThan(1e-9);
    expect(r.record.inputProvenance["rear.hubDrag"]).toBe("DEFAULT");
  });
});

describe("Load-dependent axle friction (FRI-001 refinement)", () => {
  const law = (exponent: number, referenceLoad: number) => ({ exponent: d(exponent), referenceLoad: d(referenceLoad) });

  it("reduces to Coulomb friction exactly when the exponent is 1", () => {
    const base = testCar({ mu: 0.15, wheelMass: 0.005, spinInertia: 4e-7 });
    const lawCar = withAxles(base, (a) => ({ ...a, frictionLaw: law(1, 0.03) }));
    const track = mann2012Track();
    expect(simulateRace(lawCar, track, testEnv()).elapsedTime).toBe(simulateRace(base, track, testEnv()).elapsedTime);
  });

  it("applies mu (load / reference)^(n - 1) at the converged bore load", () => {
    // Massless wheels and no rolling resistance: T_i = -mu(|R_i|) |R_i| r_axle / r exactly.
    const mu0 = 0.2;
    const ref = 0.02;
    const n = 2 / 3;
    const rw = 0.015;
    const rAx = 0.0025;
    const car = withAxles(testCar({ mu: mu0, wheelRadius: rw, axleRadius: rAx }), (a) => ({ ...a, frictionLaw: law(n, ref) }));
    const r = simulateRace(car, straightIncline(alpha, D), testEnv(0), { traceEvery: 50 });
    expect(r.status).toBe("FINISHED");
    for (const s of r.trace) {
      for (const [T, bore] of [[s.Tr, s.boreR], [s.Tf, s.boreF]] as const) {
        const muEff = mu0 * (bore / 2 / ref) ** (n - 1);
        expect(T).toBeCloseTo((-muEff * bore * rAx) / rw, 12);
      }
      expect(s.frictionConsistent).toBe(true);
    }
    expect(Math.abs(r.ledger.residual)).toBeLessThan(1e-9);
  });
});

describe("Scaling: why the planar model's mass effect is small (VAL-001 screen)", () => {
  // Scale every mass, inertia and load-independent torque by k: with no air and Coulomb friction every
  // equation scales by k, so the race time cannot change. A mass effect needs something that does not
  // scale: the air, fixed wheels, or a friction law that is not proportional to load.
  const k = 1.7;
  const scaled = (c: CarSpec): CarSpec =>
    withAxles(
      {
        ...c,
        mass: d(c.mass.value * k),
        pitchInertia: d(c.pitchInertia.value * k),
      },
      (a) => ({
        ...a,
        wheelMass: d(a.wheelMass.value * k),
        spinInertia: d(a.spinInertia.value * k),
        hubDrag: d((a.hubDrag?.value ?? 0) * k),
      }),
    );
  const noAir = { ...mann2012Environment(), airDensity: d(0) };
  const track = mann2012Track();
  const opts = { dt: 1e-3, traceEvery: 1_000_000 };
  const time = (c: CarSpec, env = noAir) => simulateRace(c, track, env, opts).elapsedTime!;
  const duke = withAxles(mann2012Car(), (a) => ({ ...a, hubDrag: d(1e-4) }));

  it("leaves the time unchanged with no air and Coulomb friction", () => {
    expect(Math.abs(time(scaled(duke)) - time(duke))).toBeLessThan(1e-9);
  });

  it("changes it with air, or with friction growing slower than load", () => {
    expect(time(scaled(duke), mann2012Environment())).toBeLessThan(time(duke, mann2012Environment()) - 1e-3);
    const law = { exponent: d(2 / 3), referenceLoad: d(MANN_2012_TABLE2.wheelMass * G) };
    const sub = withAxles(duke, (a) => ({ ...a, frictionLaw: law }));
    expect(time(scaled(sub))).toBeLessThan(time(sub) - 1e-3);
  });
});
