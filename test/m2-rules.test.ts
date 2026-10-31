// Local race rules (spec 9.1, CMP-002): an event's own limits and event rules, carried by the design
// as a snapshot and used by inspection, the CERTIFIED guard and the build sheet.

import type { ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetHtml, exportGate } from "../src/build/package.js";
import { inches, ounces } from "../src/core/units.js";
import { type CarDesign, wedgeDesign } from "../src/geometry/design.js";
import { designFromFile, designToFile } from "../src/app/store.js";
import { evaluateBody, loadManifold } from "../src/geometry/solid.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { CCCS_KIT_CAR_2026, inspect, limitOf, localRuleset, rulesOf, violations } from "../src/rules/cccs.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const edit = (limits: Record<string, string | null>) => ({
  name: "Our club 2027",
  organization: "Our club",
  effective: "2027",
  sourceLine: "Club rules sheet",
  limits,
  event: { ...CCCS_KIT_CAR_2026.event, bentAxles: "allowed" as const, lubricant: "dry only" as const, checklist: ["Built by the clubber this year."] },
});
// A wedge with a heavy weight on top: about 5.8 oz in all.
const heavy = (): CarDesign => {
  const d = wedgeDesign();
  return { ...d, ballast: [...d.ballast, { id: "w2", material: "tungsten", shape: { kind: "block", size: [0.02, 0.015, 0.0055] }, center: [0.05, 0, 0.027], mounting: "top" }] };
};

describe("Local race rules", () => {
  it("builds a local ruleset from source-unit values: exact limits, blanks removed, nonsense refused", () => {
    const r = localRuleset(CCCS_KIT_CAR_2026, edit({ "RUL-006": "6.5", "RUL-003": null }), "local-1");
    expect(r.provenance).toBe("LOCAL");
    expect(r.review.status).toBe("UNREVIEWED");
    expect(limitOf(r, "RUL-006")!.si).toBe(ounces(6.5));
    expect(limitOf(r, "RUL-006")!.source).toEqual({ value: "6.5", unit: "oz" });
    expect(limitOf(r, "RUL-003")).toBeUndefined();
    // Limits not edited carry over from the base.
    expect(limitOf(r, "RUL-004")!.si).toBe(inches(0.375));
    expect(r.event.bentAxles).toBe("allowed");
    expect(() => localRuleset(CCCS_KIT_CAR_2026, edit({ "RUL-001": "seven" }), "x")).toThrow(/Overall length/);
  });

  it("inspects, and guards in CERTIFIED context, against the design's own rules", () => {
    const d = heavy();
    const e = evaluateCar(d, evaluateBody(w, d));
    expect(e.total.mass).toBeGreaterThan(ounces(5));
    expect(e.total.mass).toBeLessThan(ounces(6.5));
    // Shipped rules: too heavy. The club's 6.5 oz rules: legal, and no height line at all.
    expect(violations(inspect(e, rulesOf(d))).map((l) => l.id)).toEqual(["RUL-006"]);
    const club = localRuleset(CCCS_KIT_CAR_2026, edit({ "RUL-006": "6.5", "RUL-003": null }), "local-1");
    const ins = inspect(e, rulesOf({ ...d, rules: club }));
    expect(violations(ins)).toEqual([]);
    expect(ins.lines.some((l) => l.id === "RUL-003")).toBe(false);
    expect(ins.ruleset.name).toBe("Our club 2027");
  });

  it("travels with the design: a saved file keeps its rules snapshot; older files get the shipped rules", () => {
    const club = localRuleset(CCCS_KIT_CAR_2026, edit({ "RUL-006": "6.5" }), "local-1");
    const d = { ...wedgeDesign(), rules: club };
    expect(rulesOf(designFromFile(new TextDecoder().decode(new TextEncoder().encode(JSON.stringify({ format: "pinewood-dynamics-design", ...d })))))).toEqual(club);
    expect(designToFile(d).type).toBe("application/json");
    expect(rulesOf(wedgeDesign())).toBe(CCCS_KIT_CAR_2026);
  });

  it("prints the event's rules and check-in checklist on the build sheet", () => {
    const club = localRuleset(CCCS_KIT_CAR_2026, edit({ "RUL-006": null }), "local-1");
    const d = { ...wedgeDesign(), rules: club };
    const e = evaluateCar(d, evaluateBody(w, d));
    const ins = inspect(e, rulesOf(d), "SANDBOX");
    const html = buildSheetHtml(d, e, ins, exportGate(ins, "SANDBOX"), "metric");
    expect(html).toContain("Event rules: Our club 2027");
    expect(html).toContain("Local rules entered for this race.");
    expect(html).toContain("<tr><th>Bent or canted axles</th><td>Allowed</td></tr>");
    expect(html).toContain("<tr><th>Lubricant</th><td>Dry lubricant only</td></tr>");
    expect(html).toContain("☐ Built by the clubber this year.");
    expect(html).toContain("this event sets no mass limit.");
  });
});
