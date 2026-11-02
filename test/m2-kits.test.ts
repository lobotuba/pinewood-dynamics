// The kit library (KIT-001, CHAR-001..003): every kit is a choice the player makes, carried by the design.
// Changing kit keeps the shape on the wood; the event's kit rule (spec 9.2) checks the choice.

import type { ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { designFromFile } from "../src/app/store.js";
import { inches, toInches } from "../src/core/units.js";
import { type CarDesign, blockBox, kitOf, uncutDesign, upgradeDesign, wedgeDesign, withKit } from "../src/geometry/design.js";
import { evaluateBody, loadManifold } from "../src/geometry/solid.js";
import { BLOCK_KITS, DEFAULT_KIT, TYPICAL_KIT_ESTIMATE as K, WHEEL_SETS, blockKit, kitChoice, kitValues, measuredKit, unmeasured } from "../src/kit/kit.js";
import { evaluateCar } from "../src/mass/carModel.js";
import { CCCS_KIT_CAR_2026, inspect, limitOf, starterRules } from "../src/rules/cccs.js";

let w: ManifoldToplevel;
beforeAll(async () => {
  w = await loadManifold();
});

const ev = (d: CarDesign) => evaluateCar(d, evaluateBody(w, d));
const line = (d: CarDesign, id: string, rules = CCCS_KIT_CAR_2026) => inspect(ev(d), rules).lines.find((l) => l.id === id)!;
const club = blockKit("club")!;
const precision = WHEEL_SETS[0]!;

describe("Kit library", () => {
  it("holds every catalogued kit with its catalogue wheelbase, and names none of them by brand (BRD-007)", () => {
    const wb = Object.fromEntries(BLOCK_KITS.map((b) => [b.id, toInches(b.frontAxleFromRear.value - b.rearAxleFromRear.value)]));
    expect(wb.standard).toBeCloseTo(4.375, 9);
    expect(wb.club).toBeCloseTo(3.8125, 9);
    expect(wb.wide).toBeCloseTo(3.6875, 9);
    expect(wb.hobby).toBeCloseTo(4.4375, 9);
    expect(wb.narrow).toBeCloseTo(4.1875, 9);
    expect(wb.long).toBeCloseTo(5, 9);
    // Centred slots sit symmetrically on the block.
    expect(club.rearAxleFromRear.value).toBeCloseTo(club.length.value - club.frontAxleFromRear.value, 12);
    const shown = [...BLOCK_KITS.flatMap((b) => [b.name, b.notModelled ?? "", b.wheels.name]), ...WHEEL_SETS.map((s) => s.name)].join(" ");
    expect(shown).not.toMatch(/awana|scout|bsa|pinecar|ranger|maximum velocity|csb|royal/i);
  });

  it("seats the axle at the slot's closed end, and evaluates a car on every kit", () => {
    for (const b of BLOCK_KITS) {
      const k = kitChoice(b);
      expect(kitValues(k).axleAboveBlockBottom.value).toBeCloseTo(b.slotDepth.value - b.wheels.axleDiameter.value / 2, 12);
      const d = uncutDesign(k);
      const e = ev(d);
      // The uncut block's length is the kit's (to the solid's single-precision vertices).
      expect(e.extents.max[0] - e.extents.min[0]).toBeGreaterThanOrEqual(b.length.value - 1e-6);
      expect(e.spec.wheelbase.value).toBeCloseTo(b.frontAxleFromRear.value - b.rearAxleFromRear.value, 12);
    }
    // The precision set is the maker's spec.
    expect(precision.diameter.provenance).toBe("MANUFACTURER");
    expect(toInches(precision.diameter.value)).toBeCloseTo(1.192, 9);
  });
});

describe("Changing kit", () => {
  it("keeps the shape on the wood: edges stay on the block's edges, the weight keeps its distance from the rear face", () => {
    const d = wedgeDesign();
    const moved = withKit(d, kitChoice(club));
    const A = blockBox(K);
    const B = blockBox(kitValues(kitChoice(club)));
    // The uncut outline in the top view is the club block's outline.
    expect(moved.top.points.map((p) => p.map((x) => +x.toFixed(9)))).toEqual(
      [
        [B.min[0], B.min[1]],
        [B.max[0], B.min[1]],
        [B.max[0], B.max[1]],
        [B.min[0], B.max[1]],
      ].map((p) => p.map((x) => +x.toFixed(9))),
    );
    // The wedge's 1 in rear deck stays 1 in above the bottom face; its nose stays on the front face.
    const deck = (dd: CarDesign, bb: typeof A) => dd.side.points.map((p) => [p[0] - bb.min[0], p[1] - bb.min[2]]);
    const before = deck(d, A);
    const after = deck(moved, B);
    expect(after[3]![1]).toBeCloseTo(before[3]![1]!, 12);
    expect(after[2]![0]).toBeCloseTo(B.max[0] - B.min[0], 12);
    // The weight keeps its distance from the rear face, so it moves 5/8 in back relative to the new rear axle.
    expect(moved.ballast[0]!.center[0] - B.min[0]).toBeCloseTo(d.ballast[0]!.center[0] - A.min[0], 12);
    expect(toInches(moved.ballast[0]!.center[0] - d.ballast[0]!.center[0])).toBeCloseTo(-(1.5 - 0.875), 9);
    // Its access bore still reaches the side face.
    expect(ev(moved).build.blocked).toEqual([]);
  });

  it("drops a weighed block mass when the block kit changes, and keeps it when the same kit is re-measured", () => {
    const d = { ...withKit(wedgeDesign(), DEFAULT_KIT), measuredBlockMass: 0.03 };
    expect(withKit(d, kitChoice(club)).measuredBlockMass).toBeUndefined();
    expect(withKit(d, measuredKit(kitOf(d), { length: inches(6.98) }, "test")).measuredBlockMass).toBe(0.03);
  });

  it("labels measurements MEASURED and keeps the kit's identity", () => {
    const m = measuredKit(kitChoice(club), { length: inches(6.8), mass: 0.0023 }, "Measured, test");
    expect(m.block.id).toBe("club");
    expect(m.block.length.provenance).toBe("MEASURED");
    expect(m.wheels.mass.value).toBe(0.0023);
    expect(unmeasured(m)).not.toContain("block length");
    expect(unmeasured(m)).toContain("block width");
  });

  it("moves a design saved before kits were chosen onto the default kit without changing its shape on the wood", () => {
    // Drawn when the axle sat 3/16 in above the block's bottom: the uncut block then.
    const old = { ...uncutDesign(), kitId: "typical-kit-estimate" };
    const z0 = -inches(3 / 16);
    const legacy: CarDesign = {
      ...old,
      side: { points: old.side.points.map((p) => [p[0], p[1] === blockBox(K).min[2] ? z0 : p[1] + (z0 - blockBox(K).min[2])] as const) },
    };
    const up = upgradeDesign(legacy);
    expect(up.side.points.map((p) => +p[1].toFixed(12))).toEqual(uncutDesign().side.points.map((p) => +p[1].toFixed(12)));
    expect(up.kit).toBeUndefined();
    expect(upgradeDesign(up)).toBe(up);
    expect(designFromFile(JSON.stringify({ format: "pinewood-dynamics-design", ...legacy })).side).toEqual(up.side);
  });

  it("travels with the design file", () => {
    const d = withKit(wedgeDesign(), kitChoice(club, precision));
    expect(kitOf(designFromFile(JSON.stringify({ format: "pinewood-dynamics-design", ...d })))).toEqual(kitOf(d));
  });
});

describe("The event's kit rule (spec 9.2)", () => {
  it("passes the event's kit with its own wheels, fails another kit or other wheels, and waits while no kit is chosen", () => {
    expect(CCCS_KIT_CAR_2026.event.issuedKit).toBe("club");
    expect(line(wedgeDesign(kitChoice(club)), "RUL-KIT").state).toBe("PASS");
    const other = line(wedgeDesign(DEFAULT_KIT), "RUL-KIT");
    expect(other.state).toBe("FAIL");
    expect(other.note).toMatch(/Club kit/);
    expect(line(wedgeDesign(kitChoice(club, precision)), "RUL-KIT").state).toBe("FAIL");
    expect(line(wedgeDesign(), "RUL-KIT").state).toBe("NOT EVALUATED");
  });

  it("starts an unentered event with length and mass only, on the kit chosen", () => {
    const k = kitChoice(blockKit("wide")!, precision);
    const r = starterRules(k, "local-x");
    expect(r.limits.map((l) => l.id)).toEqual(["RUL-001", "RUL-006"]);
    expect(limitOf(r, "RUL-001")!.source.value).toBe("7.000");
    expect(r.event.issuedKit).toBe("wide");
    // Wheels from outside the kit: the event is taken to allow other parts.
    expect(r.event.kitPartsOnly).toBe(false);
    expect(line(wedgeDesign(k), "RUL-KIT", r).state).toBe("PASS");
    expect(starterRules(kitChoice(blockKit("wide")!), "y").event.kitPartsOnly).toBe(true);
  });
});
