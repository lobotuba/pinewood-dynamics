import { describe, expect, it } from "vitest";
import { weakest } from "../src/core/provenance.js";
import { inches, ounces, toInches, toOunces } from "../src/core/units.js";

describe("GEO-006 / GEO-011 exact unit conversions", () => {
  it("uses the exact inch and avoirdupois ounce", () => {
    expect(inches(1)).toBe(0.0254);
    expect(ounces(1)).toBe(0.028349523125);
    expect(inches(0.375)).toBeCloseTo(0.009525, 15); // 3/8 in = 9.525 mm exactly
  });

  it("round-trips without drift", () => {
    expect(toInches(inches(7))).toBeCloseTo(7, 14);
    expect(toOunces(ounces(5))).toBeCloseTo(5, 14);
  });
});

describe("Provenance: weakest input is reported", () => {
  it("ranks UNKNOWN below ESTIMATED below MEASURED", () => {
    expect(weakest(["MEASURED", "ESTIMATED", "RULE"])).toBe("ESTIMATED");
    expect(weakest(["MEASURED", "UNKNOWN"])).toBe("UNKNOWN");
    expect(weakest(["MANUFACTURER", "MEASURED"])).toBe("MEASURED");
  });
});
