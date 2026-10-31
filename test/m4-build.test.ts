// M4 build package (spec 14; BLD-001, BLD-002, BLD-004): 1:1 templates from the profiles, the export
// gate, the body STL, and the build sheet.

import type { ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { formatLength, formatMass } from "../src/core/display.js";
import { toMm } from "../src/core/units.js";
import { blockBox, wedgeDesign } from "../src/geometry/design.js";
import { outline } from "../src/geometry/profile.js";
import { evaluateBody, loadManifold } from "../src/geometry/solid.js";
import { buildSheetHtml, bodyStl, exportGate, packageFileName, templatesSvg } from "../src/build/package.js";
import { TYPICAL_KIT_ESTIMATE as K } from "../src/kit/kit.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { inspect } from "../src/rules/cccs.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const B = blockBox();

describe("M4 build package", () => {
  const setup = () => {
    const d = wedgeDesign();
    const body = evaluateBody(w, d);
    const ev = evaluateCar(d, body);
    const ins = inspect(ev, undefined, "SANDBOX");
    return { d, body, ev, ins, gate: exportGate(ins, "SANDBOX") };
  };

  it("exports SANDBOX from SANDBOX, PROVISIONAL from CERTIFIED short of certain compliance, and says why (14.2)", () => {
    const { d, ev, gate } = setup();
    expect(gate.certified).toBe(false);
    expect(gate.watermark).toBe("SANDBOX");
    expect(gate.reasons[0]).toMatch(/SANDBOX context/);
    // CERTIFIED context: the starting-gate test is unevaluated and kit lengths are estimated.
    const certified = inspect(ev, undefined, "CERTIFIED");
    expect(certified.state).toBe("PROVISIONALLY COMPLIANT");
    const g = exportGate(certified, "CERTIFIED");
    expect(g.certified).toBe(false);
    expect(g.watermark).toBe("PROVISIONAL");
    expect(g.reasons.join(" ")).toMatch(/Not yet evaluated: Starting-gate face/);
    expect(g.reasons.join(" ")).toMatch(/Passed provisionally/);
    expect(d.context).toBe("CERTIFIED");
  });

  it("draws the templates at 1:1 in millimetres: the profiles themselves, and 100 mm and 4 in scale bars", () => {
    const { d, ev, gate } = setup();
    const svg = templatesSvg(d, ev, gate, "CCCS Grand Prix (kit car), 2026 rules");
    const L = toMm(B.max[0] - B.min[0]);
    expect(svg).toContain(`width="${(L + 16).toFixed(2)}mm"`);
    expect(svg).toMatch(new RegExp(`viewBox="0 0 ${(L + 16).toFixed(2)} `));
    // The side outline's polygon, vertex by vertex, at 1 mm per unit from the block's tail.
    const polys = [...svg.matchAll(/<polygon points="([^"]+)" class="outline"\/>/g)].map((m) => m[1]!.split(" "));
    expect(polys).toHaveLength(2);
    const side = outline(d.side);
    expect(polys[0]).toHaveLength(side.length);
    const [px, py] = polys[0]![0]!.split(",").map(Number);
    expect(px).toBeCloseTo(8 + toMm(side[0]![0] - B.min[0]), 2);
    const [px2, py2] = polys[0]![1]!.split(",").map(Number);
    // Distances between vertices are true millimetres.
    expect(Math.hypot(px2! - px!, py2! - py!)).toBeCloseTo(toMm(Math.hypot(side[1]![0] - side[0]![0], side[1]![1] - side[0]![1])), 2);
    expect(svg).toContain(`h100.00" class="bar"`);
    expect(svg).toContain(`h101.60" class="bar"`);
    expect(svg).toContain("SANDBOX · NOT CERTIFIED");
    expect(svg).toContain("REAR AXLE (LOCAL/FROZEN)");
    expect(svg).toMatch(/Print-scale tolerance: not yet set \(GEO-007\)/);
  });

  it("writes the evaluated solid as binary STL in the chosen unit: every triangle, same volume and extent", () => {
    const { d, body } = setup();
    for (const [unit, k] of [
      ["mm", 1000],
      ["in", 1 / 0.0254],
    ] as const) {
      const stl = bodyStl(body, unit, d.name);
      const v = new DataView(stl.buffer);
      const n = v.getUint32(80, true);
      expect(n).toBe(body.indices.length / 3);
      expect(stl.byteLength).toBe(84 + 50 * n);
      expect(new TextDecoder().decode(stl.slice(0, 80))).toContain(`units ${unit}`);
      let vol = 0;
      let xmax = -Infinity;
      for (let t = 0; t < n; t++) {
        const p = [0, 1, 2].map((q) => [0, 1, 2].map((j) => v.getFloat32(84 + 50 * t + 12 + 12 * q + 4 * j, true)));
        const [a, b, c] = p as [number[], number[], number[]];
        vol += (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) / 6;
        xmax = Math.max(xmax, a[0]!, b[0]!, c[0]!);
      }
      expect(vol / (body.volume * k ** 3)).toBeCloseTo(1, 5);
      expect(xmax / (body.bounds.max[0] * k)).toBeCloseTo(1, 6);
    }
    expect(packageFileName(d, "body", "mm")).toMatch(/\.body\.mm\.stl$/);
  });

  it("lists targets, operations, holes and weights on the build sheet, in the chosen units", () => {
    const { d, ev, ins, gate } = setup();
    for (const units of ["metric", "english"] as const) {
      const html = buildSheetHtml(d, ev, ins, gate, units);
      expect(html).toContain(formatMass(ev.total.mass, units));
      expect(html).toContain(formatLength(K.frontAxleFromRear.value - K.rearAxleFromRear.value, units) + ", LOCAL/FROZEN");
      expect(html).toContain(`${formatLength(ev.total.centroid[0], units)} ahead of the rear axle`);
      for (const s of ev.build.steps) expect(html).toContain(s.label.replace(/&/g, "&amp;"));
      for (const f of d.features.filter((f) => f.kind !== "cut")) expect(html).toContain(`<td>${f.id}</td>`);
      for (const b of d.ballast) expect(html).toContain(`<td>${b.id}</td>`);
      expect(html).toContain("SANDBOX: not a certified export");
      expect(html).toContain("<svg");
    }
  });
});
