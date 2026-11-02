// Master car model, schema v1 (controlling spec 6.1, GEO-009). Plain JSON data: everything the
// solid, the mass model, the rules and the build package derive from.
//
// Car frame (6.3, GEO-010): origin on the rear axle axis, centred laterally; +X forward, +Y to the
// car's left, +Z up. All lengths in metres (6.4).
//
//   Body = Block ∩ Extrude_Y(side) ∩ Extrude_Z(top) − axle slots − features − ballast cavities

import { sourced } from "../core/provenance.js";
import { inches } from "../core/units.js";
import { DEFAULT_KIT, type KitChoice, type KitValues, TYPICAL_KIT_ESTIMATE, kitValues } from "../kit/kit.js";
import type { Ruleset } from "../rules/cccs.js";

export type P2 = readonly [number, number];
export type V3 = readonly [number, number, number];
export type Axis = "x" | "y" | "z";

/**
 * A closed outline. Side profile points are (x, z); top profile points are (x, y). Edges are straight
 * unless a vertex is smooth (spline) or an edge has an arc bulge; see `profile.ts`.
 */
export interface Profile {
  readonly points: readonly P2[];
  /** Per vertex: the outline passes smoothly through it. Absent means all corners. */
  readonly smooth?: readonly boolean[];
  /** Per edge i (vertex i to i+1): arc bulge tan(θ/4), + bowing left of travel. Absent means none. */
  readonly bulge?: readonly number[];
}

/** Cylindrical hole; `center` is the centre of the cylinder, `depth` its length along `axis`. */
export interface Bore {
  readonly kind: "bore";
  readonly id: string;
  readonly center: V3;
  readonly axis: Axis;
  readonly diameter: number;
  readonly depth: number;
}

/** Rectangular pocket; `center` and full `size` along x, y, z. */
export interface Pocket {
  readonly kind: "pocket";
  readonly id: string;
  readonly center: V3;
  readonly size: V3;
}

/** A plane through `point`; the side `normal` points to is the side a cut removes. */
export interface Plane {
  readonly point: V3;
  readonly normal: V3;
}

/**
 * A flat saw cut (spec 6.1, 12.3). One plane removes everything on its normal side; two planes make
 * a wedge cut (V-notch), removing only where both half-spaces overlap. Cuts are sawn before any
 * hole is drilled (6.1: "two saw cuts, then drilling").
 */
export interface Cut {
  readonly kind: "cut";
  readonly id: string;
  readonly planes: readonly [Plane] | readonly [Plane, Plane];
}

export type Feature = Bore | Pocket | Cut;

export type MaterialId = "tungsten" | "lead" | "steel" | "brass" | "zinc" | "tin" | "copper" | "aluminium";

export type BallastShape =
  | { readonly kind: "cylinder"; readonly diameter: number; readonly length: number; readonly axis: Axis }
  | { readonly kind: "block"; readonly size: V3 };

/**
 * A weight (BAL-001). `cavity` mounting removes a matching hole from the body; the other mountings
 * sit on the surface and remove nothing.
 */
export interface Ballast {
  readonly id: string;
  readonly material: MaterialId;
  readonly shape: BallastShape;
  readonly center: V3;
  readonly mounting: "cavity" | "top" | "underside" | "side";
}

export type AxlePrepId = "stock-dry" | "polished-graphite";

/**
 * Compliance context (MODE-002), per project version. CERTIFIED enforces every hard rule and lock:
 * an edit that would break one is refused. SANDBOX blocks nothing and watermarks every result and
 * export.
 */
export type ComplianceContext = "CERTIFIED" | "SANDBOX";

/** A design's context; files saved before contexts existed open in SANDBOX, where nothing was enforced. */
export const contextOf = (d: Pick<CarDesign, "context">): ComplianceContext => d.context ?? "SANDBOX";

export interface CarDesign {
  readonly schema: 1;
  readonly name: string;
  /** The kit, as "block/wheels" ids; "typical-kit-estimate" marks a design saved before kits were chosen. */
  readonly kitId: string;
  readonly side: Profile;
  readonly top: Profile;
  readonly features: readonly Feature[];
  readonly ballast: readonly Ballast[];
  /** Body paint, CSS hex colour. */
  readonly paint: string;
  readonly axlePrep: AxlePrepId;
  /** Weighed uncut block mass, kg. Given, it replaces the estimated wood density (MAT-001). */
  readonly measuredBlockMass?: number;
  /** Compliance context (MODE-002). Omitted: SANDBOX. */
  readonly context?: ComplianceContext;
  /** The ruleset this version is held to, as an immutable snapshot (9.1). Omitted: the shipped ruleset. */
  readonly rules?: Ruleset;
  /** The kit the player said the car is built from, as a snapshot (KIT-001). Omitted: not chosen; the default kit is assumed. */
  readonly kit?: KitChoice;
}

/** The kit a design is built from: its own choice, or the default kit when none was made. */
export const kitOf = (d: Pick<CarDesign, "kit">): KitChoice => d.kit ?? DEFAULT_KIT;
/** The kit's values for the geometry and the mass model. */
export const kitValuesOf = (d: Pick<CarDesign, "kit">): KitValues => (d.kit ? kitValues(d.kit) : TYPICAL_KIT_ESTIMATE);
const kitKey = (k: KitChoice): string => `${k.block.id}/${k.wheels.id}`;

/** Half-extent of a weight or bore shape along each car axis. */
export function shapeHalfSize(shape: BallastShape): V3 {
  if (shape.kind === "block") return [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
  const r = shape.diameter / 2;
  const l = shape.length / 2;
  return shape.axis === "x" ? [l, r, r] : shape.axis === "y" ? [r, l, r] : [r, r, l];
}

/** The block's extent in the car frame, from the kit's datums. */
export function blockBox(kit: KitValues = TYPICAL_KIT_ESTIMATE): { min: V3; max: V3 } {
  const xr = -kit.rearAxleFromRear.value;
  const zb = -kit.axleAboveBlockBottom.value;
  const w = kit.blockWidth.value / 2;
  return {
    min: [xr, -w, zb],
    max: [xr + kit.blockLength.value, w, zb + kit.blockHeight.value],
  };
}

const rect = (x0: number, a0: number, x1: number, a1: number): Profile => ({
  points: [
    [x0, a0],
    [x1, a0],
    [x1, a1],
    [x0, a1],
  ],
});

/**
 * Profiles that cut nothing: exactly the block's outlines, so what the editor shows on the block's
 * edge is where the saw goes (manifold resolves the coincident faces exactly).
 */
export function uncutDesign(kit?: KitChoice): CarDesign {
  const b = blockBox(kit ? kitValues(kit) : TYPICAL_KIT_ESTIMATE);
  return {
    schema: 1,
    name: "Uncut block",
    kitId: kitKey(kit ?? DEFAULT_KIT),
    ...(kit ? { kit } : {}),
    side: rect(b.min[0], b.min[2], b.max[0], b.max[2]),
    top: rect(b.min[0], b.min[1], b.max[0], b.max[1]),
    features: [],
    ballast: [],
    paint: "#c8a46e",
    axlePrep: "polished-graphite",
    context: "CERTIFIED",
  };
}

/**
 * A starting design: a wedge falling from 1.0 in at the rear to 0.25 in at the nose, with a tungsten
 * cylinder in a cavity across the car just ahead of the rear axle, drilled in from the left side.
 */
export function wedgeDesign(kit?: KitChoice): CarDesign {
  const b = blockBox(kit ? kitValues(kit) : TYPICAL_KIT_ESTIMATE);
  const base = uncutDesign(kit);
  const zb = b.min[2];
  const xr = b.min[0];
  const xf = b.max[0];
  const cyl = { diameter: inches(0.375), length: inches(1.5) };
  const wz = zb + inches(0.45);
  // The access bore runs from 1 mm outside the left face to 1 mm into the cavity.
  const y0 = cyl.length / 2 - 0.001;
  const y1 = b.max[1] + 0.001;
  return {
    ...base,
    name: "Wedge",
    side: {
      points: [
        [xr, zb],
        [xf, zb],
        [xf, zb + inches(0.25)],
        [xr + inches(1.5), zb + inches(1.0)],
        [xr, zb + inches(1.0)],
      ],
    },
    features: [{ kind: "bore", id: "f1", center: [inches(0.5), (y0 + y1) / 2, wz], axis: "y", diameter: cyl.diameter, depth: y1 - y0 }],
    ballast: [
      {
        id: "w1",
        material: "tungsten",
        shape: { kind: "cylinder", ...cyl, axis: "y" },
        center: [inches(0.5), 0, wz],
        mounting: "cavity",
      },
    ],
  };
}

/**
 * A coordinate on axis k moved from one block to another. What lies on or beyond a face of the old block
 * keeps its place relative to that face; anything inside keeps its distance from the rear face (X), the
 * centreline (Y) or the bottom face (Z). So the shape stays on the wood and the wheels go wherever the new
 * kit's slots are.
 */
function mover(from: KitValues, to: KitValues): (c: number, k: number) => number {
  const a = blockBox(from);
  const b = blockBox(to);
  const EPS = 1e-7;
  return (c, k) => {
    if (c >= a.max[k]! - EPS) return c + b.max[k]! - a.max[k]!;
    if (c <= a.min[k]! + EPS) return c + b.min[k]! - a.min[k]!;
    return k === 1 ? c : c + b.min[k]! - a.min[k]!;
  };
}

/** The design moved from one set of kit values to another (see `mover`). */
export function moveDesign(d: CarDesign, from: KitValues, to: KitValues): CarDesign {
  const m = mover(from, to);
  const pt = (p: V3): V3 => [m(p[0], 0), m(p[1], 1), m(p[2], 2)];
  const prof = (pr: Profile, ka: number): Profile => ({ ...pr, points: pr.points.map((q) => [m(q[0], 0), m(q[1], ka)] as const) });
  /** A span [c - s/2, c + s/2] on axis k moved end by end, so a hole open to a face stays open to it. */
  const span = (c: number, size: number, k: number): [number, number] => {
    const lo = m(c - size / 2, k);
    const hi = m(c + size / 2, k);
    return [(lo + hi) / 2, hi - lo];
  };
  const features = d.features.map((f): Feature => {
    if (f.kind === "cut") return { ...f, planes: f.planes.map((pl) => ({ ...pl, point: pt(pl.point) })) as unknown as Cut["planes"] };
    if (f.kind === "pocket") {
      const s = [0, 1, 2].map((k) => span(f.center[k]!, f.size[k]!, k));
      return { ...f, center: [s[0]![0], s[1]![0], s[2]![0]], size: [s[0]![1], s[1]![1], s[2]![1]] };
    }
    const k = "xyz".indexOf(f.axis);
    const [c, depth] = span(f.center[k]!, f.depth, k);
    const center = pt(f.center).map((x, i) => (i === k ? c : x)) as unknown as V3;
    return { ...f, center, depth };
  });
  return {
    ...d,
    side: prof(d.side, 2),
    top: prof(d.top, 1),
    features,
    ballast: d.ballast.map((bl) => ({ ...bl, center: pt(bl.center) })),
  };
}

/**
 * The design on another kit, or on the same kit re-measured. A weighed block mass belongs to the block
 * it was weighed on, so it goes when the block kit changes.
 */
export function withKit(d: CarDesign, kit: KitChoice): CarDesign {
  const { measuredBlockMass, ...rest } = moveDesign(d, kitValuesOf(d), kitValues(kit));
  const sameBlock = kitOf(d).block.id === kit.block.id;
  return { ...rest, kitId: kitKey(kit), kit, ...(sameBlock && measuredBlockMass !== undefined ? { measuredBlockMass } : {}) };
}

/**
 * The kit values designs were drawn on before kits were chosen: the standard kit, with the axle 3/16 in
 * above the block's bottom (an estimate the slot depth has since replaced).
 */
const EARLIER_ESTIMATE: KitValues = { ...TYPICAL_KIT_ESTIMATE, axleAboveBlockBottom: sourced(inches(3 / 16), "ESTIMATED", "Earlier estimate") };

/**
 * A design saved before kits were chosen, moved onto the default kit so its shape keeps its place on the
 * wood. The kit stays not chosen. Anything newer comes back unchanged.
 */
export function upgradeDesign(d: CarDesign): CarDesign {
  if (d.kitId !== "typical-kit-estimate" || d.kit) return d;
  return { ...moveDesign(d, EARLIER_ESTIMATE, TYPICAL_KIT_ESTIMATE), kitId: kitKey(DEFAULT_KIT) };
}
