// KID level (spec 16, 12.7 A, MODE-001): shapes, saw lines and weights a child picks, on the same model.
// Each must be buildable at BASIC, keep the axle slots in wood, and pass the rules the shape can pass;
// what-if races change one thing each.

import type { ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { inches } from "../src/core/units.js";
import { type CarDesign, blockBox, kitValuesOf, uncutDesign } from "../src/geometry/design.js";
import { outline, outlineArea } from "../src/geometry/profile.js";
import { evaluateBody, loadManifold, surfaceAlong } from "../src/geometry/solid.js";
import { KID_SHAPES, MIN_OVER_AXLE, kidShapeProfiles, sawLine, withKidShape } from "../src/kid/shapes.js";
import { KID_WEIGHTS, KID_WOOD, addKidWeight, isKidWeight, kidBoreId, placeKidWeight, refitKidWeights, rodFits } from "../src/kid/weights.js";
import { WHAT_IF_MOVE, whatIfs } from "../src/kid/whatIf.js";
import { balanceWords, carLengths, kidProblem, kidRefusal, lengthsWords } from "../src/kid/words.js";
import { BLOCK_KITS, kitChoice } from "../src/kit/kit.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { inspect, limitOf, starterRules } from "../src/rules/cccs.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const ev = (d: CarDesign) => evaluateCar(d, evaluateBody(w, d));
const fails = (d: CarDesign) =>
  inspect(ev(d), starterRules(d.kit!, "t"))
    .lines.filter((l) => l.state === "FAIL")
    .map((l) => l.id);
const big = KID_WEIGHTS[0]!;

describe("Shape It: the shape gallery", () => {
  it("gives every shape on every kit a body that keeps wood over both axle slots, is sawn at BASIC, and passes", () => {
    for (const b of BLOCK_KITS) {
      const base = uncutDesign(kitChoice(b));
      const k = kitValuesOf(base);
      const bb = blockBox(k);
      const xa = k.frontAxleFromRear.value - k.rearAxleFromRear.value;
      for (const s of KID_SHAPES) {
        const d = withKidShape(base, s.id);
        const e = ev(d);
        expect(evaluateBody(w, d).empty, `${b.id} ${s.id}`).toBe(false);
        expect(e.build.tier, `${b.id} ${s.id}`).toBe("BASIC");
        expect(e.build.blocked).toEqual([]);
        for (const x of [0, xa]) for (const y of [-0.9 * bb.max[1], 0, 0.9 * bb.max[1]]) {
          const top = surfaceAlong(w, d, [x, y, 0], "z", 1)!;
          expect(top - bb.min[2], `${b.id} ${s.id} over the axle at ${x}`).toBeGreaterThanOrEqual(MIN_OVER_AXLE - 1e-9);
        }
        expect(fails(d), `${b.id} ${s.id}`).toEqual([]);
      }
    }
  });

  it("bows the bullet's nose outward, and drops saw lines that belonged to the old shape", () => {
    const k = kitValuesOf(uncutDesign(kitChoice(BLOCK_KITS[0]!)));
    const p = kidShapeProfiles("bullet", k).side;
    expect(outlineArea(p)).toBeGreaterThan(outlineArea({ points: p.points }));
    const d = uncutDesign(kitChoice(BLOCK_KITS[0]!));
    const bb = blockBox(k);
    const cut = sawLine(d, [bb.max[0] - inches(1), bb.max[2]], [bb.max[0], bb.max[2] - inches(0.4)], "c1");
    expect(typeof cut).toBe("object");
    expect(withKidShape({ ...d, features: [cut as never] }, "wedge").features).toEqual([]);
  });
});

describe("Shape It: drawing a saw line", () => {
  const d = uncutDesign(kitChoice(BLOCK_KITS[0]!));
  const k = kitValuesOf(d);
  const bb = blockBox(k);

  it("takes off the piece away from the middle of the car, whichever way the line is drawn", () => {
    const a = [bb.max[0] - inches(2), bb.max[2]] as const;
    const b = [bb.max[0], bb.max[2] - inches(0.6)] as const;
    for (const [p, q] of [
      [a, b],
      [b, a],
    ] as const) {
      const cut = sawLine(d, p, q, "c1");
      if (typeof cut === "string") throw new Error(cut);
      const sawn = { ...d, features: [cut] };
      // The nose top corner is gone; the rear top is not.
      expect(surfaceAlong(w, sawn, [bb.max[0] - inches(0.1), 0, 0], "z", 1)!).toBeLessThan(bb.max[2] - inches(0.4));
      expect(surfaceAlong(w, sawn, [bb.min[0] + inches(0.1), 0, 0], "z", 1)!).toBeCloseTo(bb.max[2], 9);
      expect(ev(sawn).total.mass).toBeLessThan(ev(d).total.mass);
    }
  });

  it("refuses a line that is too short or would saw into an axle slot", () => {
    expect(sawLine(d, [0, 0], [0.001, 0.001], "c")).toMatch(/longer/);
    // Straight down through the front axle, and just ahead of it.
    const xa = k.frontAxleFromRear.value - k.rearAxleFromRear.value;
    expect(sawLine(d, [xa + inches(0.05), bb.max[2]], [xa + inches(0.05), bb.min[2]], "c")).toMatch(/axle slot/);
    expect(sawLine(d, [xa + inches(0.2), bb.max[2]], [xa + inches(0.2), bb.min[2]], "c")).toMatch(/axle slot/);
    expect(typeof sawLine(d, [xa + inches(0.3), bb.max[2]], [xa + inches(0.3), bb.min[2]], "c")).toBe("object");
  });
});

describe("Add Weight: rods in drilled holes", () => {
  const d0 = withKidShape(uncutDesign(kitChoice(BLOCK_KITS[0]!)), "wedge");
  const bb = blockBox(kitValuesOf(d0));

  it("starts a weight as far back as it fits, with wood round it and a hole drilled in from the side", () => {
    const d = addKidWeight(w, d0, big, "kwa")!;
    const b = d.ballast.find(isKidWeight)!;
    const r = big.diameter / 2;
    expect(b.center[0] - r - bb.min[0]).toBeGreaterThanOrEqual(KID_WOOD - 1e-9);
    expect(b.center[0] - r - bb.min[0]).toBeLessThan(KID_WOOD + inches(1 / 16) + 1e-9);
    const bore = d.features.find((f) => f.id === kidBoreId("kwa"));
    expect(bore?.kind).toBe("bore");
    const e = ev(d);
    expect(e.build.blocked).toEqual([]);
    expect(fails(d)).toEqual([]);
  });

  it("keeps weights apart and out of thin wood, and says when there is no room left", () => {
    let d = d0;
    let n = 0;
    for (; n < 30; n++) {
      const next = addKidWeight(w, d, big, `kw${n}`);
      if (!next) break;
      d = next;
    }
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(30);
    for (const b of d.ballast) expect(rodFits(w, d, b)).toBe(true);
    // Asked for the thin nose of the wedge, a weight goes to the nearest place with wood round it.
    const one = addKidWeight(w, d0, big, "kwz")!;
    const moved = placeKidWeight(w, one, one.ballast[0]!, bb.max[0] - inches(0.3))!;
    const x = moved.ballast[0]!.center[0];
    expect(x).toBeLessThan(bb.max[0] - inches(0.3));
    expect(rodFits(w, moved, moved.ballast[0]!)).toBe(true);
    expect(moved.features.filter((f) => f.id === kidBoreId("kwz"))).toHaveLength(1);
  });

  it("puts weights back into the wood after a shape change, or takes out any that no longer fit", () => {
    let d = withKidShape(uncutDesign(kitChoice(BLOCK_KITS[0]!)), "block");
    for (let i = 0; i < 8; i++) d = addKidWeight(w, d, big, `kw${i}`) ?? d;
    const r = refitKidWeights(w, withKidShape(d, "low"));
    expect(r.dropped.length).toBeGreaterThan(0);
    for (const b of r.design.ballast) expect(rodFits(w, r.design, b)).toBe(true);
    expect(r.design.features.filter((f) => f.kind === "bore")).toHaveLength(r.design.ballast.length);
  });
});

describe("Why?: what-if races and plain words", () => {
  it("changes one thing per what-if: weights moved, mass to the limit at the same CG, axles polished", () => {
    const base = { ...withKidShape(uncutDesign(kitChoice(BLOCK_KITS[0]!)), "wedge"), axlePrep: "stock-dry" as const };
    const d = addKidWeight(w, base, big, "kwa")!;
    const moved = placeKidWeight(w, d, d.ballast[0]!, d.ballast[0]!.center[0] + inches(1.5))!;
    const e = ev(moved);
    const limit = limitOf(starterRules(moved.kit!, "t"), "RUL-006")!.si;
    const items = whatIfs(w, moved, e, limit);
    expect(items.map((i) => i.id)).toEqual(["back", "forward", "heavier", "axles"]);
    const byId = Object.fromEntries(items.map((i) => [i.id, i.spec]));
    expect(byId.back!.cg.value.x).toBeLessThan(e.spec.cg.value.x);
    expect(byId.forward!.cg.value.x).toBeGreaterThan(e.spec.cg.value.x);
    expect(byId.heavier!.mass.value).toBe(limit);
    expect(byId.heavier!.cg.value).toEqual(e.spec.cg.value);
    expect(byId.heavier!.pitchInertia).toEqual(e.spec.pitchInertia);
    expect(byId.axles!.rear.axleFriction.value).toBeLessThan(e.spec.rear.axleFriction.value);
    // Moving a weight keeps the mass (to the solid's single-precision vertices, about 10 µg).
    expect(Math.abs(byId.back!.mass.value - e.spec.mass.value)).toBeLessThan(1e-8);
    expect(byId.back!.cg.value.x).toBeGreaterThan(e.spec.cg.value.x - 1.01 * WHAT_IF_MOVE);
  });

  it("says rule problems and refusals in plain words, and time as car lengths", () => {
    const line = { id: "RUL-006", label: "Mass", cls: "PUBLISHED RULE" as const, state: "FAIL" as const, provisional: false, note: "" };
    expect(kidProblem(line)).toMatch(/too heavy/);
    expect(kidRefusal([line, { ...line, id: "RUL-001", label: "Overall length" }])).toBe(
      "That would make your car too heavy and make your car too long, so it is not allowed in the race. Try something else.",
    );
    expect(balanceWords(0.01, 0.111)).toBe("right over the back wheels");
    expect(balanceWords(0.06, 0.111)).toBe("in the middle");
    // 0.01 s at 4 m/s is 4 cm: a fifth of a 7 in car.
    expect(carLengths(0.01, 4, inches(7))).toBeCloseTo(0.04 / inches(7), 12);
    expect(lengthsWords(0.2, true)).toBe("a nose ahead");
    expect(lengthsWords(3.2, false)).toBe("about 3 car lengths behind");
    expect(lengthsWords(0.01, true)).toBe("about level");
  });

  it("draws every shape's outline from its own points (no shape is empty)", () => {
    const k = kitValuesOf(uncutDesign(kitChoice(BLOCK_KITS[0]!)));
    for (const s of KID_SHAPES) expect(outline(kidShapeProfiles(s.id, k).side).length).toBeGreaterThan(3);
  });
});
