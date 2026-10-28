// P0 track geometry validation (controlling spec 11.5; TRK-003, TRK-004).

import { describe, expect, it } from "vitest";
import { inches } from "../src/core/units.js";
import { dot, norm, sub, v2 } from "../src/core/vec2.js";
import { Path } from "../src/track/path.js";
import { bestTrack, finishS } from "../src/track/track.js";

const ramp = () =>
  Path.build(v2(0, 1), -Math.PI / 6, [
    { kind: "line", length: 2 },
    { kind: "arc", radius: 2, turn: Math.PI / 6 },
    { kind: "line", length: 5 },
  ]);

describe("P0 track geometry", () => {
  it("has the analytic length of its pieces", () => {
    expect(ramp().length).toBeCloseTo(2 + (2 * Math.PI) / 6 + 5, 14);
  });

  it("is continuous in position and tangent across every join", () => {
    const p = ramp();
    for (const j of p.joins().slice(0, -1)) {
      const a = p.at(j - 1e-9);
      const b = p.at(j + 1e-9);
      expect(norm(sub(a.p, b.p))).toBeLessThan(1e-8);
      expect(dot(a.t, b.t)).toBeCloseTo(1, 12);
    }
  });

  it("ends the transition level, with the drop of slope plus arc", () => {
    const p = ramp();
    const end = p.at(p.length);
    expect(end.t.z).toBeCloseTo(0, 14);
    const drop = 2 * Math.sin(Math.PI / 6) + 2 * (1 - Math.cos(Math.PI / 6));
    expect(1 - end.p.z).toBeCloseTo(drop, 13);
  });

  it("offsets a concave arc to radius R - r and keeps the offset at distance r", () => {
    const r = 0.015;
    const p = ramp();
    const c = p.offset(r);
    expect(c.length).toBeCloseTo(2 + (2 - r) * (Math.PI / 6) + 5, 13);
    for (const s of [0.3, 2.5, 2.9, 6]) {
      const surf = p.at(s);
      const cen = c.at(p.mapToOffset(s, c));
      expect(norm(sub(cen.p, surf.p))).toBeCloseTo(r, 13);
      expect(dot(sub(cen.p, surf.p), surf.n)).toBeCloseTo(r, 13);
    }
  });

  it("rejects a wheel larger than a concave arc's radius", () => {
    const p = Path.build(v2(0, 0), 0, [{ kind: "arc", radius: 0.01, turn: 1 }]);
    expect(() => p.offset(0.015)).toThrow(/cannot follow/);
  });

  it("TRK-001: BestTrack 35 ft puts the finish 358 in from the pin and labels the profile ESTIMATED (TRK-004)", () => {
    const t = bestTrack(35);
    expect(t.timedDistance.provenance).toBe("MANUFACTURER");
    expect(finishS(t) - t.pinS).toBeCloseTo(inches(358), 12);
    expect(t.profileStatus).toBe("ESTIMATED");
    expect(finishS(t)).toBeLessThan(t.surface.length);
  });

  it("reproduces the manufacturer drawing's independent dimensions", () => {
    for (const [len, overall, footprint] of [[35, 417, 407], [42, 501, 491], [49, 585, 575]] as const) {
      const t = bestTrack(len);
      // Overall lane length 34'9", 41'9", 48'9"; footprint 33'11", 40'11", 47'11" (to the inch).
      expect(t.surface.length).toBeCloseTo(inches(overall), 12);
      const end = t.surface.at(t.surface.length).p;
      expect(Math.abs(end.x - inches(footprint))).toBeLessThan(inches(0.5));
      // Middle timer hole 11 in from the end of the last 7 ft section, before the 40 in stop section.
      expect(t.surface.length - inches(40) - finishS(t)).toBeCloseTo(inches(11), 12);
    }
    // Curve top 11-3/8 in above the floor and pin about 45 in above it imply flat lanes about
    // 2.2 in above the floor: the drop from the curve top to the flat must be under 11-3/8 in.
    const t = bestTrack(35);
    const curveTop = t.surface.at(inches(84)).p.z;
    const pinHeightAboveCurveTop = t.surface.at(t.pinS).p.z - curveTop;
    expect(curveTop).toBeLessThan(inches(11.375));
    expect(Math.abs(pinHeightAboveCurveTop - inches(45 - 11.375))).toBeLessThan(inches(0.5));
  });
});
