// Build capability (spec 12.6; MFG-001/002, D-10 accepted in principle). Every operation that makes
// the car is listed in shop order with the tier of tools it needs:
//
//   1. Saw the side and top outlines           BASIC by construction (12.6)
//   2. Saw cuts and wedge cuts                 by how the plane sits against the faces
//   3. Drill bores, cut pockets, weight holes  by how the tool gets in and meets the surface
//
// Tool lists, minimum feature size and precision per tier are TBD from characterization, so the
// rules below classify by kind of operation only and are PROVISIONAL.

import { type Sourced, sourced } from "../core/provenance.js";
import type { Axis, CarDesign, Cut } from "../geometry/design.js";
import type { BodySolid, HoleAccess, Opening } from "../geometry/solid.js";
import { MATERIALS } from "../mass/materials.js";

export type Tier = "BASIC" | "INTERMEDIATE" | "ADVANCED" | "CNC/DIGITAL";

export const TIERS: readonly { readonly tier: Tier; readonly tools: string }[] = [
  { tier: "BASIC", tools: "hand tools: coping saw, hand drill, sandpaper" },
  { tier: "INTERMEDIATE", tools: "adds a power drill and a scroll or band saw" },
  { tier: "ADVANCED", tools: "drill press, precise layout, multi-setup work" },
  { tier: "CNC/DIGITAL", tools: "CNC or other digital fabrication" },
];
const rank = (t: Tier): number => TIERS.findIndex((x) => x.tier === t);

/**
 * A drill meeting the surface within this angle of square starts cleanly by hand. PROVISIONAL until
 * the build-capability characterization (12.6) gives a measured figure.
 */
export const SQUARE_ENTRY: Sourced<number> = sourced((5 * Math.PI) / 180, "DEFAULT", "Provisional pending 12.6 characterization");
/** A saw-cut plane whose normal has less than this component along an axis contains that axis. */
const IN_PLANE = 1e-6;
/** Less wood than this (1 mm^3) means the operation removes nothing. */
const NOTHING = 1e-9;

export interface BuildStep {
  readonly id: string;
  readonly label: string;
  /** "ok": can be made with `tier`; "blocked": cannot be made as drawn; "nothing": removes no wood. */
  readonly state: "ok" | "blocked" | "nothing";
  readonly tier: Tier | null;
  readonly how: string;
  /** Wood the operation removes on its own, m^3. */
  readonly removed: number;
}

export interface BuildPlan {
  readonly steps: readonly BuildStep[];
  /** The highest tier any operation needs. */
  readonly tier: Tier;
  readonly blocked: readonly BuildStep[];
  readonly provenance: "PROVISIONAL";
}

const FACE: Record<Axis, Record<"1" | "-1", string>> = {
  x: { "1": "nose", "-1": "tail" },
  y: { "1": "left side", "-1": "right side" },
  z: { "1": "top", "-1": "underside" },
};
export const faceName = (o: Pick<Opening, "axis" | "sign">): string => FACE[o.axis][o.sign === 1 ? "1" : "-1"];
const deg = (r: number): string => `${((r * 180) / Math.PI).toFixed(0)}°`;

function holeStep(id: string, label: string, h: HoleAccess, isWeight: boolean): BuildStep {
  const base = { id, label, removed: h.removed };
  if (h.openings.length === 0)
    return {
      ...base,
      state: "blocked",
      tier: null,
      how: isWeight
        ? "The weight cannot be put in: no end of its hole opens to the outside. Add an access bore or pocket to the surface along its axis."
        : "Enclosed: there is no straight way in from outside to make it.",
    };
  if (h.removed < NOTHING && !isWeight) return { ...base, state: "nothing", tier: null, how: "Outside the body: it removes no wood." };
  const square = h.openings.filter((o) => o.onSurface && o.entryAngle <= SQUARE_ENTRY.value);
  if (h.shape === "cylinder") {
    if (square.length > 0) return { ...base, state: "ok", tier: "BASIC", how: `Drill from the ${faceName(square[0]!)}, square to the face, with a hand drill.` };
    const o = h.openings.reduce((a, b) => (b.entryAngle < a.entryAngle ? b : a));
    return {
      ...base,
      state: "ok",
      tier: "ADVANCED",
      how: o.onSurface
        ? `Drill from the ${faceName(o)}: the bit meets the surface ${deg(o.entryAngle)} off square, so a drill press is needed to hold the angle.`
        : `Drill from the ${faceName(o)}: the bit starts partly off an edge, so a drill press is needed to keep it from wandering.`,
    };
  }
  const through = h.openings.find((o) => h.openings.some((p) => p.axis === o.axis && p.sign === -o.sign));
  if (through)
    return {
      ...base,
      state: "ok",
      tier: "INTERMEDIATE",
      how: `Through-opening from the ${faceName(through)}: drill a starter hole and cut it out with a scroll saw.`,
    };
  return {
    ...base,
    state: "ok",
    tier: "ADVANCED",
    how: `Flat-bottomed pocket from the ${faceName(h.openings[0]!)}: drill out and chisel it square, or rout it, with precise layout.`,
  };
}

/** Axes a plane contains (its normal has no component along them). */
const contains = (n: readonly number[]): Axis[] => {
  const l = Math.hypot(n[0]!, n[1]!, n[2]!);
  return (["x", "y", "z"] as const).filter((_, k) => Math.abs(n[k]!) <= IN_PLANE * l);
};

function cutStep(c: Cut, removed: number): BuildStep {
  const two = c.planes.length === 2;
  const label = two ? "Wedge cut" : "Saw cut";
  const base = { id: c.id, label, removed };
  if (removed < NOTHING) return { ...base, state: "nothing", tier: null, how: "The cut misses the body: it removes no wood." };
  const common = c.planes.map((p) => contains(p.normal)).reduce((a, b) => a.filter((x) => b.includes(x)));
  // A cut square to the side or top face is laid out on that face and sawn like the profiles.
  const face = common.includes("y") ? "side" : common.includes("z") ? "top" : null;
  if (face)
    return { ...base, state: "ok", tier: "BASIC", how: `${two ? "Two straight saw cuts" : "One straight saw cut"}, laid out on the ${face} face and sawn square to it.` };
  if (common.includes("x"))
    return {
      ...base,
      state: "ok",
      tier: "INTERMEDIATE",
      how: `A bevel running the length of the car${two ? " on both planes" : ""}: a band saw with a tilted table.`,
    };
  return { ...base, state: "ok", tier: "ADVANCED", how: "A compound angle: laid out on two faces and cut in more than one setup." };
}

export function planBuild(design: CarDesign, body: BodySolid): BuildPlan {
  const steps: BuildStep[] = [
    { id: "profiles", label: "Side and top outlines", state: "ok", tier: "BASIC", how: "Saw the side outline, then the top outline, with a coping saw.", removed: 0 },
  ];
  for (const f of design.features) if (f.kind === "cut") steps.push(cutStep(f, body.cutRemoved[f.id] ?? 0));
  for (const f of design.features) {
    const h = body.holes[f.id];
    if (f.kind !== "cut" && h) steps.push(holeStep(f.id, f.kind === "bore" ? "Bore" : "Pocket", h, false));
  }
  for (const b of design.ballast) {
    const h = body.holes[b.id];
    if (b.mounting === "cavity" && h) steps.push(holeStep(b.id, `Cavity for the ${MATERIALS[b.material].name.toLowerCase()} weight`, h, true));
  }
  const ok = steps.filter((s) => s.state === "ok" && s.tier !== null);
  const tier = ok.reduce<Tier>((a, s) => (rank(s.tier!) > rank(a) ? s.tier! : a), "BASIC");
  return { steps, tier, blocked: steps.filter((s) => s.state === "blocked"), provenance: "PROVISIONAL" };
}

export const tierTools = (t: Tier): string => TIERS.find((x) => x.tier === t)!.tools;
