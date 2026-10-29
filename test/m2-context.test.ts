// Compliance context (MODE-002, spec 5.2, 9.4): the states each context reports, and how the store
// refuses an edit in CERTIFIED context.

import type { ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { Store } from "../src/app/store.js";
import { type CarDesign, contextOf, uncutDesign, wedgeDesign } from "../src/geometry/design.js";
import { evaluateBody, loadManifold } from "../src/geometry/solid.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { inspect, violations } from "../src/rules/cccs.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const ev = (d: CarDesign) => evaluateCar(d, evaluateBody(w, d));
// A wedge carrying far too much tungsten: it fails the mass rule.
const heavy = (): CarDesign => {
  const d = wedgeDesign();
  return { ...d, ballast: [{ ...d.ballast[0]!, shape: { kind: "block", size: [0.04, 0.03, 0.01] }, center: [0.05, 0, 0.0], mounting: "cavity" }] };
};

describe("Compliance context (MODE-002)", () => {
  it("starts new designs CERTIFIED; files from before contexts open as SANDBOX", () => {
    expect(contextOf(wedgeDesign())).toBe("CERTIFIED");
    expect(contextOf(uncutDesign())).toBe("CERTIFIED");
    const { context: _c, ...old } = wedgeDesign();
    expect(contextOf(old as CarDesign)).toBe("SANDBOX");
  });

  it("reports PROVISIONALLY COMPLIANT in CERTIFIED and SANDBOX/RULES DISABLED in SANDBOX for a passing car", () => {
    const e = ev(wedgeDesign());
    expect(violations(inspect(e))).toEqual([]);
    // The gate test is unevaluated and kit lengths are estimated, so certified compliance is out of reach.
    expect(inspect(e, undefined, "CERTIFIED").state).toBe("PROVISIONALLY COMPLIANT");
    expect(inspect(e, undefined, "SANDBOX").state).toBe("SANDBOX/RULES DISABLED");
  });

  it("reports NONCOMPLIANT in either context for a failing car, naming what fails", () => {
    const e = ev(heavy());
    for (const c of ["CERTIFIED", "SANDBOX"] as const) expect(inspect(e, undefined, c).state).toBe("NONCOMPLIANT");
    expect(violations(inspect(e)).map((l) => l.id)).toContain("RUL-006");
  });

  it("enforces rules, locks and protected zones, not the geometry states a design passes through", () => {
    // A cavity weight before its access is drilled: sealed in, so GEO-ACCESS fails, but that is the
    // middle of an edit, not a broken rule.
    const d = wedgeDesign();
    const sealed: CarDesign = { ...d, features: [] };
    const ins = inspect(ev(sealed));
    expect(ins.lines.find((l) => l.id === "GEO-ACCESS")!.state).toBe("FAIL");
    expect(ins.state).toBe("NONCOMPLIANT");
    expect(violations(ins)).toEqual([]);
  });

  it("refuses an edit without a trace in the history, and holds a drag where it last passed", () => {
    const s = new Store();
    const valid = s.design;
    const before = s.canUndo;
    s.update(heavy());
    expect(s.canUndo).toBe(true);
    s.refuse(valid);
    expect(s.design).toBe(valid);
    expect(s.canUndo).toBe(before);
    // A live drag position (not committed) goes back to the committed design.
    s.update({ ...valid, name: "dragging" }, false);
    s.refuse(valid);
    expect(s.design).toBe(valid);
    expect(s.canUndo).toBe(before);
  });
});
