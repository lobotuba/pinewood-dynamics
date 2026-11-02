// Starting points for new holes and cuts (spec 12.3, 12.7 A). Each is placed against the actual
// sawn surface, not the uncut block, so a chamfer on a wedge's low nose still takes the size asked.

import type { ManifoldToplevel } from "manifold-3d";
import type { KitValues } from "../kit/kit.js";
import type { Axis, CarDesign, Cut, Feature, V3 } from "./design.js";
import { blockBox, kitValuesOf } from "./design.js";
import { placeHole, surfaceAlong } from "./solid.js";

export type HoleFace = "top" | "underside" | "left" | "right" | "nose" | "tail";
export const HOLE_FACES: Readonly<Record<HoleFace, { axis: Axis; sign: 1 | -1; label: string }>> = {
  top: { axis: "z", sign: 1, label: "Top" },
  underside: { axis: "z", sign: -1, label: "Underside" },
  left: { axis: "y", sign: 1, label: "Left side" },
  right: { axis: "y", sign: -1, label: "Right side" },
  nose: { axis: "x", sign: 1, label: "Nose" },
  tail: { axis: "x", sign: -1, label: "Tail" },
};

export type CutPreset = "nose" | "tail" | "corner-left" | "corner-right" | "bevel-left" | "bevel-right" | "notch";
export const CUT_PRESETS: Readonly<Record<CutPreset, string>> = {
  nose: "Nose chamfer, 45° (side view)",
  tail: "Tail chamfer, 45° (side view)",
  "corner-left": "Nose corner, left, 45° (top view)",
  "corner-right": "Nose corner, right, 45° (top view)",
  "bevel-left": "Top-left edge bevel, 45° (front view)",
  "bevel-right": "Top-right edge bevel, 45° (front view)",
  notch: "V-notch across the top, 90° (wedge cut)",
};

const S = Math.SQRT1_2;
const NUDGE = 1e-4;

/** A bore or pocket made from `face`, `depth` into the wood; `x` places it along the car. */
export function newHole(
  w: ManifoldToplevel,
  design: CarDesign,
  kind: "bore" | "pocket",
  id: string,
  face: HoleFace,
  x: number,
  width: number,
  width2: number,
  depth: number,
  kit: KitValues = kitValuesOf(design),
): Feature {
  const b = blockBox(kit);
  const f = HOLE_FACES[face];
  // Side and end holes go in halfway up the wood at that point.
  const xs = face === "nose" ? b.max[0] - NUDGE : face === "tail" ? b.min[0] + NUDGE : x;
  const top = surfaceAlong(w, design, [xs, 0, 0], "z", 1, kit) ?? b.max[2];
  const at: V3 = [xs, 0, f.axis === "z" ? 0 : (top + b.min[2]) / 2];
  return placeHole(w, design, { kind, id, axis: f.axis, sign: f.sign, at, width, width2, depth }, kit);
}

/** A preset saw or wedge cut of leg (or notch depth) `size`; `x` places bevels and notches. */
export function newCut(w: ManifoldToplevel, design: CarDesign, preset: CutPreset, id: string, size: number, x: number, kit: KitValues = kitValuesOf(design)): Cut {
  const b = blockBox(kit);
  const zTop = (at: number): number => surfaceAlong(w, design, [at, 0, 0], "z", 1, kit) ?? b.max[2];
  const zMid = (b.min[2] + b.max[2]) / 2;
  const yLeft = (at: number): number => surfaceAlong(w, design, [at, 0, zMid], "y", 1, kit) ?? b.max[1];
  const yRight = (at: number): number => surfaceAlong(w, design, [at, 0, zMid], "y", -1, kit) ?? b.min[1];
  const one = (point: V3, normal: V3): Cut => ({ kind: "cut", id, planes: [{ point, normal }] });
  const xn = b.max[0] - NUDGE;
  const xt = b.min[0] + NUDGE;
  switch (preset) {
    case "nose":
      return one([b.max[0], 0, zTop(xn) - size], [S, 0, S]);
    case "tail":
      return one([b.min[0], 0, zTop(xt) - size], [-S, 0, S]);
    case "corner-left":
      return one([b.max[0], yLeft(xn) - size, zMid], [S, S, 0]);
    case "corner-right":
      return one([b.max[0], yRight(xn) + size, zMid], [S, -S, 0]);
    case "bevel-left":
      return one([x, yLeft(x) - size, zTop(x)], [0, S, S]);
    case "bevel-right":
      return one([x, yRight(x) + size, zTop(x)], [0, -S, S]);
    case "notch": {
      const p: V3 = [x, 0, zTop(x) - size];
      return { kind: "cut", id, planes: [{ point: p, normal: [-S, 0, S] }, { point: p, normal: [S, 0, S] }] };
    }
  }
}
