// KID level, Add Weight (spec 16, 7.3, SAF-003): weights a child picks by name and slides along the car.
// Each is a rod across the car in a hole drilled from the left side, the way kit weights are usually
// fitted, so the same model, checks and build package apply. A weight only goes where there is wood
// round it; it is never placed where it would break through the surface or into another weight.

import type { ManifoldToplevel } from "manifold-3d";
import { inches } from "../core/units.js";
import { type Ballast, type CarDesign, type MaterialId, blockBox, kitValuesOf } from "../geometry/design.js";
import { accessHole, withSurfaces } from "../geometry/solid.js";
import { MATERIALS } from "../mass/materials.js";

export type KidWeightId = "tungsten-big" | "tungsten-small" | "steel" | "steel-small" | "lead";

export interface KidWeight {
  readonly id: KidWeightId;
  readonly name: string;
  readonly material: MaterialId;
  readonly diameter: number;
}

/** Generic rod weights (DSN-004): common derby-weight diameters, no brands. */
export const KID_WEIGHTS: readonly KidWeight[] = [
  { id: "tungsten-big", name: "Big tungsten rod", material: "tungsten", diameter: inches(3 / 8) },
  { id: "tungsten-small", name: "Small tungsten rod", material: "tungsten", diameter: inches(1 / 4) },
  { id: "steel", name: "Steel rod", material: "steel", diameter: inches(3 / 8) },
  { id: "steel-small", name: "Small steel rod, for topping up", material: "steel", diameter: inches(1 / 4) },
  { id: "lead", name: "Lead rod (a grown-up puts it in)", material: "lead", diameter: inches(3 / 8) },
];

/** Wood kept round a weight: over it, beside its ends, and between two weights. */
export const KID_WOOD = inches(1 / 16);
/** Height of a rod's axis above the block's bottom: clear of the axle slots. */
const ROD_HEIGHT = inches(0.45);
/** Rods stop this far short of each side face. */
const SIDE_WOOD = inches(1 / 8);
const KID_PREFIX = "kw";

/** A kid weight's access hole has the weight's id with "kb" for "kw". */
export const kidBoreId = (weightId: string): string => `kb${weightId.slice(KID_PREFIX.length)}`;
export const isKidWeight = (b: Ballast): boolean => b.id.startsWith(KID_PREFIX);

/** Rod length on this car: the block's width less wood at each end, at most 1.5 in. */
export function rodLength(d: CarDesign): number {
  return Math.min(inches(1.5), kitValuesOf(d).blockWidth.value - 2 * SIDE_WOOD);
}

/** The rod a kid weight is, at `x`. */
export function kidRod(d: CarDesign, kind: KidWeight, id: string, x: number): Ballast {
  const bb = blockBox(kitValuesOf(d));
  return {
    id,
    material: kind.material,
    shape: { kind: "cylinder", diameter: kind.diameter, length: rodLength(d), axis: "y" },
    center: [x, 0, bb.min[2] + Math.max(ROD_HEIGHT, kind.diameter / 2 + inches(0.15))],
    mounting: "cavity",
  };
}

/** The design without a kid weight and its access hole. */
export function withoutKidWeight(d: CarDesign, id: string): CarDesign {
  return { ...d, ballast: d.ballast.filter((b) => b.id !== id), features: d.features.filter((f) => f.id !== kidBoreId(id)) };
}

type Along = Parameters<Parameters<typeof withSurfaces>[2]>[0];

/** Whether rod `b` has wood all round it in `d` (other weights ignored) and keeps clear of the other weights. */
export function rodFits(w: ManifoldToplevel, d: CarDesign, b: Ballast): boolean {
  return withSurfaces(w, d, (along) => fits(along, d, b));
}

function fits(surfaceAt: Along, d: CarDesign, b: Ballast): boolean {
  if (b.shape.kind !== "cylinder") return false;
  const r = b.shape.diameter / 2;
  const half = b.shape.length / 2;
  const [x, , z] = b.center;
  for (const o of d.ballast) {
    if (o.id === b.id) continue;
    const ro = o.shape.kind === "cylinder" ? o.shape.diameter / 2 : Math.max(...o.shape.size) / 2;
    if (Math.abs(o.center[0] - x) < r + ro + KID_WOOD && Math.abs(o.center[2] - z) < r + ro + KID_WOOD) return false;
  }
  // Wood over the rod along its length, and beyond both ends, across its whole diameter.
  for (const dx of [-r, 0, r]) {
    const top = surfaceAt([x + dx, 0, z], "z", 1);
    if (top === null || top < z + r + KID_WOOD) return false;
    for (const y of [-half, half]) {
      const t = surfaceAt([x + dx, y, z], "z", 1);
      if (t === null || t < z + r + KID_WOOD) return false;
    }
    for (const sign of [1, -1] as const) {
      const s = surfaceAt([x + dx, 0, z], "y", sign);
      if (s === null || sign * s < half + KID_WOOD) return false;
    }
  }
  return true;
}

/** Places along the car a weight could go, rear first, every 1/16 in. */
function stations(d: CarDesign, r: number): number[] {
  const bb = blockBox(kitValuesOf(d));
  const out: number[] = [];
  const step = inches(1 / 16);
  for (let x = bb.min[0] + r + KID_WOOD; x <= bb.max[0] - r - KID_WOOD + 1e-12; x += step) out.push(x);
  return out;
}

/**
 * The design with `b` placed, at `x` or, if it does not fit there, at the nearest place it does, with
 * its access hole drilled from the side; null if it fits nowhere.
 */
export function placeKidWeight(w: ManifoldToplevel, d: CarDesign, b: Ballast, x: number): CarDesign | null {
  const base = withoutKidWeight(d, b.id);
  const r = b.shape.kind === "cylinder" ? b.shape.diameter / 2 : 0;
  const order = stations(base, r).sort((p, q) => Math.abs(p - x) - Math.abs(q - x));
  const at = withSurfaces(w, base, (along) => [x, ...order].find((c) => fits(along, base, { ...b, center: [c, b.center[1], b.center[2]] })));
  if (at === undefined) return null;
  const rod: Ballast = { ...b, center: [at, b.center[1], b.center[2]] };
  const withRod = { ...base, ballast: [...base.ballast, rod] };
  const bore = accessHole(w, withRod, rod, kidBoreId(rod.id));
  return { ...withRod, features: bore ? [...withRod.features, bore] : withRod.features };
}

/** A new kid weight of `kind`, as far back as it fits (weight at the back is where most builders start). */
export function addKidWeight(w: ManifoldToplevel, d: CarDesign, kind: KidWeight, id: string): CarDesign | null {
  const bb = blockBox(kitValuesOf(d));
  return placeKidWeight(w, d, kidRod(d, kind, id, bb.min[0]), bb.min[0]);
}

/** Every kid weight put back into the wood after a shape change; the ids of any that no longer fit. */
export function refitKidWeights(w: ManifoldToplevel, d: CarDesign): { design: CarDesign; dropped: string[] } {
  let out = d;
  const dropped: string[] = [];
  for (const b of d.ballast.filter(isKidWeight)) {
    const next = placeKidWeight(w, out, b, b.center[0]);
    if (next) out = next;
    else {
      out = withoutKidWeight(out, b.id);
      dropped.push(b.id);
    }
  }
  return { design: out, dropped };
}

/** The kid weight entry a placed rod came from, by material and diameter. */
export function kidWeightOf(b: Ballast): KidWeight | undefined {
  return KID_WEIGHTS.find((k) => k.material === b.material && b.shape.kind === "cylinder" && Math.abs(b.shape.diameter - k.diameter) < 1e-9);
}

/** One rod's mass, kg. */
export const rodMass = (d: CarDesign, k: KidWeight): number => MATERIALS[k.material].density.value * Math.PI * (k.diameter / 2) ** 2 * rodLength(d);

