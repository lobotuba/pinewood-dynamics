// KID level, Why? (spec 16): "what if" races. Each is the car changed one way and raced by the same
// solver on the same track, so what it says about speed is the physics', never a rule of thumb
// (VIS-002). The comparison is put in car lengths at the finish, which is what a child sees.

import type { ManifoldToplevel } from "manifold-3d";
import { sourced } from "../core/provenance.js";
import { inches } from "../core/units.js";
import type { CarDesign } from "../geometry/design.js";
import { evaluateBody } from "../geometry/solid.js";
import { type CarEvaluation, evaluateCar } from "../mass/carModel.js";
import type { CarSpec } from "../physics/car.js";
import { isKidWeight, placeKidWeight } from "./weights.js";

export interface WhatIf {
  readonly id: "back" | "forward" | "heavier" | "axles";
  /** "If your weights were further back". */
  readonly label: string;
  readonly spec: CarSpec;
}

/** How far the weights move in the further-back and further-forward races. */
export const WHAT_IF_MOVE = inches(1 / 2);

/** The car with every kid weight moved by `dx` where the wood allows; null if none could move. */
function movedWeights(w: ManifoldToplevel, d: CarDesign, dx: number): CarDesign | null {
  let out = d;
  let moved = false;
  for (const b of d.ballast.filter(isKidWeight)) {
    const next = placeKidWeight(w, out, b, b.center[0] + dx);
    const now = next?.ballast.find((x) => x.id === b.id);
    if (!next || !now) continue;
    // placeKidWeight falls back to the nearest place that fits: only a move the right way counts.
    if (Math.sign(now.center[0] - b.center[0]) === Math.sign(dx) && Math.abs(now.center[0] - b.center[0]) > inches(1 / 32)) {
      out = next;
      moved = true;
    }
  }
  return moved ? out : null;
}

const specOf = (w: ManifoldToplevel, d: CarDesign): CarSpec | null => {
  const body = evaluateBody(w, d);
  return body.empty ? null : evaluateCar(d, body).spec;
};

/**
 * The what-if cars for `d`: weights further back and further forward, as heavy as the rules allow
 * (the extra mass at the balance point, so only the mass changes), and polished axles.
 */
export function whatIfs(w: ManifoldToplevel, d: CarDesign, ev: CarEvaluation, massLimit: number | null): WhatIf[] {
  const out: WhatIf[] = [];
  const back = movedWeights(w, d, -WHAT_IF_MOVE);
  const backSpec = back && specOf(w, back);
  if (backSpec) out.push({ id: "back", label: "If your weights were a little further back", spec: backSpec });
  const fwd = movedWeights(w, d, WHAT_IF_MOVE);
  const fwdSpec = fwd && specOf(w, fwd);
  if (fwdSpec) out.push({ id: "forward", label: "If your weights were a little further forward", spec: fwdSpec });
  if (massLimit !== null && ev.total.mass < massLimit - 0.001) {
    // A point mass at the CG: total mass changes, CG and pitch inertia about the CG do not.
    out.push({
      id: "heavier",
      label: "If your car were as heavy as the rules allow",
      spec: { ...ev.spec, mass: sourced(massLimit, ev.spec.mass.provenance, "What if: extra mass at the balance point, up to the rule limit") },
    });
  }
  if (d.axlePrep === "stock-dry") {
    const s = specOf(w, { ...d, axlePrep: "polished-graphite" });
    if (s) out.push({ id: "axles", label: "If the axles were polished and given graphite", spec: s });
  }
  return out;
}
