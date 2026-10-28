// VAL-001 published comparison data: the rebuilt Mann et al. (2012) experiment is self-consistent.
// These tests check the reconstruction, not agreement with the measurements; see docs/validation.md.

import { describe, expect, it } from "vitest";
import { simulateRace } from "../src/physics/race.js";
import { MANN_2012_TABLE2, mann2012Car, mann2012Environment, mann2012Track } from "../src/validation/mann2012.js";

describe("Mann, Gibbs and Sah (2012) reconstruction", () => {
  it("reproduces their published start height d = 1.17 m within 1%", () => {
    const t = mann2012Track();
    const flat = t.surface.at(t.surface.length).p.z;
    const pin = t.surface.at(t.pinS).p.z;
    expect(Math.abs((pin - flat) / MANN_2012_TABLE2.d - 1)).toBeLessThan(0.01);
  });

  it("matches their wheel inertia to the radius of gyration (I_w = m_o k^2) within 1%", () => {
    const T = MANN_2012_TABLE2;
    expect(Math.abs((T.wheelMass * T.wheelGyration ** 2) / T.wheelInertia - 1)).toBeLessThan(0.01);
  });

  it("runs their car with published inputs labelled MEASURED and our assumptions ESTIMATED", () => {
    const r = simulateRace(mann2012Car(), mann2012Track(), mann2012Environment());
    expect(r.status).toBe("FINISHED");
    expect(r.record.inputProvenance["rear.axleFriction"]).toBe("MEASURED");
    expect(r.record.inputProvenance["car.wheelbase"]).toBe("ESTIMATED");
    expect(Math.abs(r.ledger.residual)).toBeLessThan(1e-8);
  });
});
