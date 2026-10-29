// M2 design workspace, headless parts: body solid (GEO-002, GEO-009), mass properties (7.6), the
// design-to-solver bridge, inspection (CMP-004..006) and display rounding (GEO-011).

import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { formatAgainstLimit, formatLength, formatLimit } from "../src/core/display.js";
import { inches, ounces, toInches } from "../src/core/units.js";
import { type Ballast, type CarDesign, blockBox, uncutDesign, wedgeDesign } from "../src/geometry/design.js";
import { CIRCLE_SEGMENTS, evaluateBody, loadManifold, seatBallast } from "../src/geometry/solid.js";
import { DEFAULT_ENVIRONMENT, TYPICAL_KIT_ESTIMATE as K } from "../src/kit/kit.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { type MassPart, boxInertia, combine, meshMassProperties } from "../src/mass/inertia.js";
import { simulateRace } from "../src/physics/race.js";
import { CCCS_KIT_CAR_2026, inspect } from "../src/rules/cccs.js";
import { bestTrack } from "../src/track/track.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const B = blockBox();
const L = B.max[0] - B.min[0];
const W = B.max[1] - B.min[1];
const H = B.max[2] - B.min[2];
const r = K.axleRadius.value;
const xFront = K.frontAxleFromRear.value - K.rearAxleFromRear.value;
/** The two axle slots as negative-density boxes. */
const slots = (rho = 1): MassPart[] =>
  [0, xFront].map((x) => {
    const size = [2 * r, W, r - B.min[2]] as const;
    const m = -rho * size[0] * size[1] * size[2];
    return { mass: m, centroid: [x, 0, (B.min[2] + r) / 2] as const, inertia: boxInertia(m, size) };
  });
const blockPart = (rho = 1): MassPart => {
  const m = rho * L * W * H;
  return {
    mass: m,
    centroid: [(B.min[0] + B.max[0]) / 2, 0, (B.min[2] + B.max[2]) / 2],
    inertia: boxInertia(m, [L, W, H]),
  };
};
// Float32 vertices: about 1e-7 relative.
const close = (a: number, b: number, rel = 2e-6): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(Math.abs(b), 1e-12));

describe("Mesh mass properties", () => {
  it("reproduces a box's volume, centroid and inertia exactly", () => {
    const m = w.Manifold.cube([0.1, 0.04, 0.03]).translate([0.02, -0.01, 0.005]);
    const mesh = m.getMesh();
    const mp = meshMassProperties(mesh.vertProperties, mesh.triVerts, mesh.numProp);
    m.delete();
    close(mp.volume, 0.1 * 0.04 * 0.03);
    mp.centroid.forEach((c, k) => close(c, [0.07, 0.01, 0.02][k]!));
    const I = boxInertia(mp.volume, [0.1, 0.04, 0.03]);
    for (const k of [0, 4, 8]) close(mp.inertia[k]!, I[k]!);
    for (const k of [1, 2, 5]) expect(Math.abs(mp.inertia[k]!)).toBeLessThan(1e-6 * I[0]!);
  });
});

describe("Body solid (GEO-009)", () => {
  it("is the block minus its two axle slots when the profiles cut nothing", () => {
    const body = evaluateBody(w, uncutDesign());
    const exact = combine([blockPart(), ...slots()]);
    close(body.volume, exact.mass);
    const mp = meshMassProperties(body.positions, body.indices);
    close(mp.volume, exact.mass);
    mp.centroid.forEach((c, k) => expect(Math.abs(c - exact.centroid[k]!)).toBeLessThan(1e-7));
    for (const k of [0, 4, 8]) close(mp.inertia[k]!, exact.inertia[k]!, 1e-5);
  });

  it("cuts the side profile through the full width: a wedge's volume is its trapezoid area times the width", () => {
    const d = { ...wedgeDesign(), features: [] };
    const body = evaluateBody(w, { ...d, ballast: [] });
    // Side outline: 1.0 in tall for 1.5 in, then a straight edge falling to 0.25 in at the nose.
    const x1 = inches(1.5);
    const area = x1 * inches(1.0) + 0.5 * (inches(1.0) + inches(0.25)) * (L - x1);
    const exact = area * W + combine(slots()).mass;
    close(body.volume, exact, 1e-5);
  });

  it("removes a cavity for a cavity-mounted weight, to the 128-gon's area", () => {
    const d = { ...wedgeDesign(), features: [] };
    const withCavity = evaluateBody(w, d).volume;
    const without = evaluateBody(w, { ...d, ballast: [] }).volume;
    const s = d.ballast[0]!.shape;
    if (s.kind !== "cylinder") throw new Error("fixture");
    const n = CIRCLE_SEGMENTS;
    const polygon = (n / 2) * Math.sin((2 * Math.PI) / n) * (s.diameter / 2) ** 2 * s.length;
    close(without - withCavity, polygon, 1e-5);
  });

  it("reports the silhouette area seen from the front: block face plus four wheels", () => {
    const body = evaluateBody(w, uncutDesign());
    // Each side's wheels show as a 2R x width rectangle (front hides rear; a 128-gon has vertices at
    // +-90 deg, so it is exactly 2R tall). The slots run along Y and are hidden behind the block.
    const R = K.wheelRadius.value;
    close(body.frontalArea, W * H + 2 * (2 * R) * K.wheelWidth.value, 1e-6);
  });
});

describe("Weight mounting (spec 6.5 geometry validity)", () => {
  const plate = (z: number): Ballast => ({
    id: "p",
    material: "steel",
    shape: { kind: "block", size: [inches(1), inches(1), inches(0.125)] },
    center: [inches(2), 0, z],
    mounting: "top",
  });
  const top = B.max[2];
  const state = (z: number) => {
    const d: CarDesign = { ...uncutDesign(), ballast: [plate(z)] };
    return evaluateBody(w, d).mounting.p;
  };

  it("tells touching, floating and cutting-in apart on a flat top", () => {
    expect(state(top + inches(0.0625))).toBe("touching");
    expect(state(top + inches(0.0625) + 1e-3)).toBe("floating");
    expect(state(top + inches(0.0625) - 1e-3)).toBe("embedded");
  });

  it("seats a top weight on the highest point of a sloping surface under its footprint", () => {
    const d = { ...wedgeDesign(), ballast: [] };
    const seated = seatBallast(w, d, plate(top + 0.05));
    // Wedge top falls from 1.0 in (1.5 in from the rear) to 0.25 in at the nose: the footprint's rear
    // edge (x = 1.5 in ahead of the rear axle) is its highest point.
    const x1 = inches(1.5);
    const x2 = L;
    const rearEdgeX = inches(2) - inches(0.5) * 0.98 - B.min[0];
    const surface = B.min[2] + inches(1.0) + ((inches(0.25) - inches(1.0)) * (rearEdgeX - x1)) / (x2 - x1);
    expect(seated.center[2] - inches(0.0625)).toBeCloseTo(surface, 6);
    const placed = { ...d, ballast: [seated] };
    expect(evaluateBody(w, placed).mounting.p).toBe("touching");
  });
});

describe("Mass model and solver bridge (7.6, MAT-001)", () => {
  it("sums body, wheels, axles and weights; the body is density times the solid's volume", () => {
    // Without its one-sided access bore, so the design is symmetric.
    const d = { ...wedgeDesign(), features: [] };
    const body = evaluateBody(w, d);
    const ev = evaluateCar(d, body);
    const sum = ev.components.reduce((a, c) => a + c.mass, 0);
    close(ev.total.mass, sum, 1e-12);
    // Mesh integral (float32 vertices) against manifold's own volume.
    close(ev.components.find((c) => c.group === "body")!.mass, K.woodDensity.value * body.volume, 1e-6);
    expect(ev.components.filter((c) => c.group === "wheel")).toHaveLength(4);
    expect(ev.components.filter((c) => c.group === "axle")).toHaveLength(4);
    expect(Math.abs(ev.total.centroid[1])).toBeLessThan(1e-7); // symmetric design
    expect(ev.massUncertainty).toBeCloseTo(0.15 * ev.components[0]!.mass, 12);
  });

  it("derives body density from a weighed block (DERIVED) and drops the mass uncertainty", () => {
    const d: CarDesign = { ...uncutDesign(), measuredBlockMass: 0.12 };
    const ev = evaluateCar(d, evaluateBody(w, d));
    expect(ev.bodyDensity.provenance).toBe("DERIVED");
    close(ev.bodyDensity.value, 0.12 / (L * W * H), 1e-12);
    expect(ev.massUncertainty).toBe(0);
  });

  it("races: moving the same weight rearward is faster on BestTrack", () => {
    const time = (x: number): number => {
      const base = wedgeDesign();
      const d: CarDesign = { ...base, ballast: [{ ...base.ballast[0]!, center: [x, 0, base.ballast[0]!.center[2]] }] };
      const r = simulateRace(evaluateCar(d, evaluateBody(w, d)).spec, bestTrack(35), DEFAULT_ENVIRONMENT, { dt: 1e-3 });
      expect(r.status).toBe("FINISHED");
      return r.elapsedTime!;
    };
    expect(time(inches(0.3))).toBeLessThan(time(inches(3)));
  });
});

describe("Inspection (CMP-004..006, spec 9.7)", () => {
  it("passes the uncut block with the length exactly at 7.000 in, and stays provisional (gate unknown)", () => {
    const d = uncutDesign();
    const ins = inspect(evaluateCar(d, evaluateBody(w, d)));
    const len = ins.lines.find((l) => l.id === "RUL-001")!;
    expect(toInches(len.value!)).toBeCloseTo(7, 6);
    expect(len.state).toBe("PASS");
    expect(ins.lines.find((l) => l.id === "RUL-007")!.state).toBe("NOT EVALUATED");
    expect(ins.state).toBe("PROVISIONALLY COMPLIANT");
    const under = ins.lines.find((l) => l.id === "RUL-004")!;
    close(under.value!, K.wheelRadius.value - K.axleAboveBlockBottom.value, 1e-6);
  });

  it("fails an overweight car and says NONCOMPLIANT, never a binary legal badge", () => {
    const base = wedgeDesign();
    const big: CarDesign = {
      ...base,
      ballast: [{ ...base.ballast[0]!, shape: { kind: "block", size: [inches(1.5), inches(1.5), inches(0.6)] }, center: [inches(1), 0, inches(0.9)], mounting: "top" }],
    };
    const ins = inspect(evaluateCar(big, evaluateBody(w, big)));
    const m = ins.lines.find((l) => l.id === "RUL-006")!;
    expect(m.value!).toBeGreaterThan(ounces(5));
    expect(m.state).toBe("FAIL");
    expect(ins.state).toBe("NONCOMPLIANT");
  });

  it("marks the mass line provisional with an advisory when the ±2σ band reaches the limit", () => {
    const d = wedgeDesign();
    const ev = evaluateCar(d, evaluateBody(w, d));
    const atLimit = { ...ev, total: { ...ev.total, mass: ounces(5) - ev.massUncertainty } };
    const m = inspect(atLimit).lines.find((l) => l.id === "RUL-006")!;
    expect(m.state).toBe("PASS");
    expect(m.provisional).toBe(true);
    expect(m.note).toContain("ADVISORY");
  });

  it("rounds measured values toward failure and never shows a failing value as passing", () => {
    const lim = CCCS_KIT_CAR_2026.limits.find((l) => l.id === "RUL-004")!; // >= 0.375 in
    expect(formatAgainstLimit(inches(0.3759), lim.si, "min", "length", "english")).toBe("0.375 in");
    expect(formatAgainstLimit(inches(0.3749999), lim.si, "min", "length", "english")).toBe("0.374 in");
    const len = CCCS_KIT_CAR_2026.limits.find((l) => l.id === "RUL-001")!; // <= 7.000 in
    expect(formatAgainstLimit(inches(7), len.si, "max", "length", "english")).toBe("7.000 in");
    expect(formatAgainstLimit(inches(7.0001), len.si, "max", "length", "english")).toBe("7.001 in");
    expect(formatAgainstLimit(inches(7) + 1e-9, len.si, "max", "length", "metric")).not.toBe("177.80 mm");
    expect(formatLength(inches(7), "metric")).toBe("177.80 mm");
  });

  it("shows limits in the selected units with the source value, marking inexact conversions", () => {
    const [len, , , , , mass] = CCCS_KIT_CAR_2026.limits;
    expect(formatLimit(len!.si, len!.source, "max", "metric")).toBe("≤ 177.80 mm (7.000 in)");
    expect(formatLimit(mass!.si, mass!.source, "max", "metric")).toBe("≤ ≈141.75 g (5.000 oz)");
    expect(formatLimit(len!.si, len!.source, "max", "english")).toBe("≤ 7.000 in");
  });
});
