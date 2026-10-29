// M2 shape editing, second slice: profile arcs and splines (6.1), saw and wedge cuts (12.3), and
// how holes are made: access, entry angle and build tier (6.5, 12.6).

import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { planBuild } from "../src/build/tiers.js";
import { inches } from "../src/core/units.js";
import { type CarDesign, type Feature, type P2, type Profile, blockBox, uncutDesign, wedgeDesign } from "../src/geometry/design.js";
import {
  arcOf,
  bendEdge,
  deleteVertex,
  edgePoints,
  filletVertex,
  insertVertex,
  outline,
  outlineArea,
  toggleSmooth,
} from "../src/geometry/profile.js";
import { CIRCLE_SEGMENTS, evaluateBody, loadManifold } from "../src/geometry/solid.js";
import { TYPICAL_KIT_ESTIMATE as K } from "../src/kit/kit.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { inspect } from "../src/rules/cccs.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const B = blockBox();
const L = B.max[0] - B.min[0];
const W = B.max[1] - B.min[1];
const [xr, xf, zb, zt] = [B.min[0], B.max[0], B.min[2], B.max[2]];
const r = K.axleRadius.value;
const xFront = K.frontAxleFromRear.value - K.rearAxleFromRear.value;
const slotVolume = 2 * (2 * r) * W * (r - zb);
const close = (a: number, b: number, rel = 2e-6): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(Math.abs(b), 1e-12));
const sq = Math.SQRT1_2;

/** Polygon clipped to x0 <= x <= x1, y0 <= y <= y1 (Sutherland-Hodgman). */
function clipRect(poly: P2[], x0: number, x1: number, y0: number, y1: number): P2[] {
  const edges: [(p: P2) => number][] = [[(p) => p[0] - x0], [(p) => x1 - p[0]], [(p) => p[1] - y0], [(p) => y1 - p[1]]];
  let out = poly;
  for (const [f] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i]!;
      const b = inp[(i + 1) % inp.length]!;
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) {
        const t = fa / (fa - fb);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
  }
  return out;
}
const area = (q: P2[]): number => Math.abs(q.reduce((a, u, i) => a + u[0] * q[(i + 1) % q.length]![1] - q[(i + 1) % q.length]![0] * u[1], 0)) / 2;

const square: Profile = { points: [[0, 0], [2, 0], [2, 2], [0, 2]] };

describe("Profile curves (spec 6.1)", () => {
  it("leaves an all-corner profile exactly its polyline", () => {
    expect(outline(square)).toEqual(square.points);
    expect(edgePoints(square, 1)).toEqual([[2, 0], [2, 2]]);
  });

  it("bends an edge into a circular arc through the dragged point, faceted like the 128-gon circles", () => {
    // Edge 0 runs (0,0) to (2,0); dragging its middle to (1,-1) makes a semicircle of radius 1 below.
    const p = bendEdge(square, 0, [1, -1]);
    expect(p.bulge).toEqual([-1, 0, 0, 0]);
    const arc = arcOf(p, 0)!;
    expect(arc.radius).toBeCloseTo(1, 12);
    expect(arc.centre[0]).toBeCloseTo(1, 12);
    expect(arc.centre[1]).toBeCloseTo(0, 12);
    for (const q of edgePoints(p, 0)) expect(Math.hypot(q[0] - 1, q[1])).toBeCloseTo(1, 12);
    // The half 128-gon has 64 facets: area (64/2) sin(pi/64) R^2 on top of the square.
    expect(edgePoints(p, 0)).toHaveLength(CIRCLE_SEGMENTS / 2 + 1);
    expect(outlineArea(p)).toBeCloseTo(4 + 32 * Math.sin(Math.PI / 64), 12);
  });

  it("splits an arc at a clicked point without changing its circle", () => {
    const p = bendEdge(square, 0, [1, -1]);
    const q = insertVertex(p, 0, [1 + Math.cos(-Math.PI / 4) * 3, Math.sin(-Math.PI / 4) * 3]);
    expect(q.points).toHaveLength(5);
    const v = q.points[1]!;
    expect(Math.hypot(v[0] - 1, v[1])).toBeCloseTo(1, 12);
    const a = arcOf(q, 0)!;
    const b = arcOf(q, 1)!;
    expect(a.sweep + b.sweep).toBeCloseTo(arcOf(p, 0)!.sweep, 12);
    expect(a.radius).toBeCloseTo(1, 12);
    expect(b.radius).toBeCloseTo(1, 12);
    expect(a.centre[0]).toBeCloseTo(1, 12);
  });

  it("passes smoothly through a spline vertex, and no facet anywhere turns more than a 128-gon's", () => {
    const step = (2 * Math.PI) / CIRCLE_SEGMENTS;
    const dir = (a: P2, b: P2): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const p = toggleSmooth(square, 2);
    expect(p.smooth).toEqual([false, false, true, false]);
    const into = edgePoints(p, 1);
    const out = edgePoints(p, 2);
    expect(into.at(-1)).toEqual([2, 2]);
    // The corner was 90°; across the spline vertex the facets meet at under two facet steps (each
    // facet's chord lies within one step of the shared tangent).
    expect(Math.abs(dir(out[0]!, out[1]!) - dir(into.at(-2)!, into.at(-1)!))).toBeLessThanOrEqual(2 * step + 1e-9);
    for (const e of [into, out])
      for (let i = 2; i < e.length; i++) {
        let t = dir(e[i - 1]!, e[i]!) - dir(e[i - 2]!, e[i - 1]!);
        t = Math.atan2(Math.sin(t), Math.cos(t));
        expect(Math.abs(t)).toBeLessThanOrEqual(step + 1e-9);
      }
    // Edges between two corners stay straight.
    expect(edgePoints(p, 0)).toEqual([[0, 0], [2, 0]]);
  });

  it("rounds the uncut block's nose corner in the top view: the outline lies on the block edge", () => {
    const u = uncutDesign();
    const r = inches(0.25);
    const rounded: CarDesign = { ...u, top: filletVertex(u.top, 2, r) };
    const removed = (r * r * (1 - 16 * Math.sin(Math.PI / 64))) * (zt - zb);
    close(evaluateBody(w, u).volume - evaluateBody(w, rounded).volume, removed, 1e-5);
  });

  it("rounds a corner with an arc tangent to both edges, taking wood off inside the corner", () => {
    const r = 0.5;
    const f = filletVertex(square, 2, r);
    expect(f.points).toEqual([[0, 0], [2, 0], [2, 2 - r], [2 - r, 2], [0, 2]]);
    const arc = arcOf(f, 2)!;
    expect(arc.radius).toBeCloseTo(r, 12);
    expect(arc.centre[0]).toBeCloseTo(2 - r, 12);
    expect(arc.centre[1]).toBeCloseTo(2 - r, 12);
    // Removed: the r x r corner square less the 32-facet quarter circle about the centre.
    expect(4 - outlineArea(f)).toBeCloseTo(r * r * (1 - 16 * Math.sin(Math.PI / 64)), 12);
    // Too big a radius for the edges: each tangent point stops halfway along its edge.
    const g = filletVertex(square, 2, 5);
    expect(g.points.slice(2, 4)).toEqual([[2, 1], [1, 2]]);
    expect(arcOf(g, 2)!.radius).toBeCloseTo(1, 12);
    // Clockwise outlines round the same way.
    const cw: Profile = { points: [...square.points].reverse() };
    expect(4 - outlineArea(filletVertex(cw, 1, r))).toBeCloseTo(r * r * (1 - 16 * Math.sin(Math.PI / 64)), 12);
  });

  it("drops the optional lists when they return to defaults, and deleting a vertex merges its edges", () => {
    expect(toggleSmooth(toggleSmooth(square, 1), 1)).toEqual(square);
    const bent = bendEdge(square, 3, [-1, 1]);
    const d = deleteVertex(bent, 0);
    expect(d.points).toEqual([[2, 0], [2, 2], [0, 2]]);
    expect(d.bulge).toBeUndefined();
    expect(deleteVertex({ points: [[0, 0], [1, 0], [0, 1]] }, 0).points).toHaveLength(3);
  });

  it("builds the body from the curved outline: volume is the clipped outline area times the width", () => {
    const pad = 0.002;
    const base = uncutDesign();
    const side = bendEdge(
      { points: [[xr - pad, zb - pad], [xf + pad, zb - pad], [xf + pad, zb + inches(0.25)], [xr - pad, zb + inches(0.25)]] },
      2,
      [(xr + xf) / 2, zb + inches(0.25) + 0.018],
    );
    expect(side.bulge![2]).toBeLessThan(0); // travelling -x, an upward bow is to the right
    const d: CarDesign = { ...base, side };
    const inside = area(clipRect(outline(side), xr, xf, zb, zt));
    close(evaluateBody(w, d).volume, inside * W - slotVolume, 1e-5);
  });
});

const cut = (id: string, planes: [P2 | number[], number[]][]): Feature => ({
  kind: "cut",
  id,
  planes: planes.map(([p, n]) => ({ point: p as unknown as readonly [number, number, number], normal: n as unknown as readonly [number, number, number] })) as never,
});
const evalD = (d: CarDesign) => {
  const body = evaluateBody(w, d);
  const ev = evaluateCar(d, body);
  return { body, ev, ins: inspect(ev), plan: planBuild(d, body) };
};
const stepOf = (d: CarDesign, id: string) => evalD(d).plan.steps.find((s) => s.id === id)!;

describe("Saw cuts and wedge cuts (spec 12.3)", () => {
  const uncut = evaluateBodyLazy();
  function evaluateBodyLazy() {
    let v: number | null = null;
    return (): number => (v ??= evaluateBody(w, uncutDesign()).volume);
  }

  it("removes a 45° nose chamfer: a right triangle a²/2 times the width", () => {
    const a = 0.01;
    const d: CarDesign = { ...uncutDesign(), features: [cut("c", [[[xf - a, 0, zt], [sq, 0, sq]]])] };
    const { body } = evalD(d);
    close(body.cutRemoved.c!, (a * a * W) / 2, 1e-5);
    close(uncut() - body.volume, (a * a * W) / 2, 1e-5);
    expect(stepOf(d, "c")).toMatchObject({ state: "ok", tier: "BASIC" });
  });

  it("removes a V-notch across the top: two planes, apex depth d, area d² times the width", () => {
    const dd = 0.005;
    const x0 = xFront / 2;
    const p = [x0, 0, zt - dd];
    const d: CarDesign = { ...uncutDesign(), features: [cut("v", [[p, [-sq, 0, sq]], [p, [sq, 0, sq]]])] };
    close(evalD(d).body.cutRemoved.v!, dd * dd * W, 1e-5);
    expect(stepOf(d, "v")).toMatchObject({ label: "Wedge cut", tier: "BASIC" });
  });

  it("tiers cuts by how the plane meets the faces: lengthwise bevel INTERMEDIATE, compound ADVANCED", () => {
    const c = 0.004;
    const bevel: CarDesign = { ...uncutDesign(), features: [cut("b", [[[0, W / 2 - c, zt], [0, sq, sq]]])] };
    close(evalD(bevel).body.cutRemoved.b!, ((c * c) / 2) * L, 1e-5);
    expect(stepOf(bevel, "b").tier).toBe("INTERMEDIATE");
    // Corner tetrahedron with legs t: volume t³/6.
    const t = 0.006;
    const n = 1 / Math.sqrt(3);
    const corner: CarDesign = { ...uncutDesign(), features: [cut("k", [[[xf - t, W / 2, zt], [n, n, n]]])] };
    close(evalD(corner).body.cutRemoved.k!, t ** 3 / 6, 1e-4);
    expect(stepOf(corner, "k").tier).toBe("ADVANCED");
    expect(evalD(corner).plan.tier).toBe("ADVANCED");
  });

  it("says a cut that misses the body removes nothing", () => {
    const d: CarDesign = { ...uncutDesign(), features: [cut("m", [[[0, 0, zt + 0.01], [0, 0, 1]]])] };
    expect(stepOf(d, "m")).toMatchObject({ state: "nothing", tier: null });
  });
});

describe("Making holes: access, entry angle and build tier (6.5, 12.6)", () => {
  const xm = xFront / 2;
  const bore = (id: string, center: number[], axis: "x" | "y" | "z", diameter: number, depth: number): Feature => ({
    kind: "bore",
    id,
    center: center as unknown as readonly [number, number, number],
    axis,
    diameter,
    depth,
  });
  const pocket = (id: string, center: number[], size: number[]): Feature => ({
    kind: "pocket",
    id,
    center: center as unknown as readonly [number, number, number],
    size: size as unknown as readonly [number, number, number],
  });

  it("loads the starter's tungsten through its access bore from the left side, square: BASIC", () => {
    const { body, plan, ins } = evalD(wedgeDesign());
    expect(body.holes.w1!.openings).toHaveLength(1);
    expect(body.holes.w1!.openings[0]).toMatchObject({ axis: "y", sign: 1, onSurface: true });
    expect(body.holes.w1!.openings[0]!.entryAngle).toBeLessThan(1e-6);
    expect(plan.steps.find((s) => s.id === "w1")).toMatchObject({ state: "ok", tier: "BASIC" });
    expect(plan.tier).toBe("BASIC");
    expect(ins.lines.find((l) => l.id === "GEO-ACCESS")!.state).toBe("PASS");
  });

  it("fails inspection when a weight's cavity is sealed in wood", () => {
    const { ins, plan } = evalD({ ...wedgeDesign(), features: [] });
    expect(plan.blocked.map((s) => s.id)).toEqual(["w1"]);
    expect(ins.lines.find((l) => l.id === "GEO-ACCESS")!.state).toBe("FAIL");
    expect(ins.state).toBe("NONCOMPLIANT");
  });

  it("blocks a weight whose access bore is narrower than the weight", () => {
    const d = wedgeDesign();
    const f = d.features[0]!;
    if (f.kind !== "bore") throw new Error("fixture");
    expect(evalD({ ...d, features: [{ ...f, diameter: inches(0.25) }] }).plan.blocked.map((s) => s.id)).toEqual(["w1"]);
  });

  it("moves the CG by exactly the wood the one-sided access bore removes", () => {
    const d = wedgeDesign();
    const sym = evalD({ ...d, features: [] }).ev;
    const one = evalD(d).ev;
    const f = d.features[0]!;
    if (f.kind !== "bore") throw new Error("fixture");
    // Extra wood: the bore's 128-gon from the cavity's end (0.75 in) to the left face.
    const a = (CIRCLE_SEGMENTS / 2) * Math.sin((2 * Math.PI) / CIRCLE_SEGMENTS) * (f.diameter / 2) ** 2;
    const y0 = inches(0.75);
    const V = a * (W / 2 - y0);
    const rho = K.woodDensity.value;
    close(sym.total.mass - one.total.mass, rho * V, 1e-4);
    close(one.total.mass * one.total.centroid[1], -rho * V * ((y0 + W / 2) / 2), 1e-4);
  });

  it("drills square into a flat top at BASIC, but needs a drill press on the wedge's slope", () => {
    const wedge = { ...wedgeDesign(), features: [], ballast: [] };
    const len = zt + 0.001 - (zb + 0.003);
    const zc = (zt + 0.001 + zb + 0.003) / 2;
    const flat = { ...wedge, features: [bore("f", [xr + inches(0.75), 0, zc], "z", inches(0.25), len)] };
    const fb = evalD(flat);
    expect(fb.body.holes.f!.openings).toHaveLength(1);
    expect(fb.body.holes.f!.openings[0]!.entryAngle).toBeLessThan(1e-6);
    expect(stepOf(flat, "f").tier).toBe("BASIC");

    const sloped = { ...wedge, features: [bore("f", [xr + inches(4), 0, zc], "z", inches(0.25), len)] };
    const slope = Math.atan(inches(0.75) / (xf - (xr + inches(1.5))));
    const o = evalD(sloped).body.holes.f!.openings[0]!;
    expect(o.entryAngle).toBeCloseTo(slope, 5);
    expect(stepOf(sloped, "f")).toMatchObject({ tier: "ADVANCED" });
    expect(stepOf(sloped, "f").how).toMatch(/drill press/);
  });

  it("tiers pockets: through-opening INTERMEDIATE, flat-bottomed ADVANCED, enclosed blocked", () => {
    const u = uncutDesign();
    const H = zt - zb;
    const through = { ...u, features: [pocket("p", [xm, 0, (zb + zt) / 2], [0.01, 0.01, H + 0.004])] };
    const t = evalD(through).body.holes.p!;
    expect(t.openings.map((o) => `${o.axis}${o.sign}`).sort()).toEqual(["z-1", "z1"]);
    close(t.removed, 0.01 * 0.01 * H, 1e-6);
    expect(stepOf(through, "p").tier).toBe("INTERMEDIATE");

    const blind = { ...u, features: [pocket("p", [xm, 0, zb + 0.002], [0.01, 0.01, 0.006])] };
    expect(evalD(blind).body.holes.p!.openings.map((o) => `${o.axis}${o.sign}`)).toEqual(["z-1"]);
    expect(stepOf(blind, "p").tier).toBe("ADVANCED");

    const sealed = { ...u, features: [pocket("p", [xm, 0, (zb + zt) / 2], [0.005, 0.005, 0.005])] };
    expect(stepOf(sealed, "p")).toMatchObject({ state: "blocked", tier: null });
    expect(evalD(sealed).ins.state).toBe("NONCOMPLIANT");
  });

  it("says a bore entirely outside the body removes nothing", () => {
    const d = { ...uncutDesign(), features: [bore("f", [xm, 0, zt + 0.01], "z", inches(0.25), 0.005)] };
    expect(stepOf(d, "f")).toMatchObject({ state: "nothing" });
    expect(evalD(d).ins.lines.find((l) => l.id === "GEO-ACCESS")!.state).toBe("PASS");
  });
});
