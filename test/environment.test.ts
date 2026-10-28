// AERO-001 environment: air density from room conditions.

import { describe, expect, it } from "vitest";
import { airDensity, environmentFrom, saturationVapourPressure } from "../src/physics/environment.js";

describe("air density", () => {
  it("gives 1.2041 kg/m^3 for dry air at 20 C and 101325 Pa", () => {
    expect(airDensity(20, 101325)).toBeCloseTo(1.20412, 5);
  });

  it("matches the IAPWS saturation vapour pressure (2339.2 Pa at 20 C) within Buck's 0.05%", () => {
    expect(Math.abs(saturationVapourPressure(20) / 2339.2 - 1)).toBeLessThan(5e-4);
  });

  it("makes humid air lighter than dry air (water vapour is lighter than N2/O2)", () => {
    expect(airDensity(25, 101325, 0.8)).toBeLessThan(airDensity(25, 101325, 0));
  });

  it("labels density from measured room conditions DERIVED", () => {
    const env = environmentFrom({ temperatureC: 20, pressurePa: 101325, relativeHumidity: 0, note: "test", measured: true });
    expect(env.airDensity.provenance).toBe("DERIVED");
  });
});
