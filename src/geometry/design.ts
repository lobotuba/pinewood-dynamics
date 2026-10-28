// Master car model, schema v1 (controlling spec 6.1, GEO-009). Plain JSON data: everything the
// solid, the mass model, the rules and the build package derive from.
//
// Car frame (6.3, GEO-010): origin on the rear axle axis, centred laterally; +X forward, +Y to the
// car's left, +Z up. All lengths in metres (6.4).
//
//   Body = Block ∩ Extrude_Y(side) ∩ Extrude_Z(top) − axle slots − features − ballast cavities

import { inches } from "../core/units.js";
import { TYPICAL_KIT_ESTIMATE } from "../kit/kit.js";

export type P2 = readonly [number, number];
export type V3 = readonly [number, number, number];
export type Axis = "x" | "y" | "z";

/** A closed outline. Side profile points are (x, z); top profile points are (x, y). */
export interface Profile {
  readonly points: readonly P2[];
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

export type Feature = Bore | Pocket;

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

export interface CarDesign {
  readonly schema: 1;
  readonly name: string;
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
}

/** Half-extent of a weight or bore shape along each car axis. */
export function shapeHalfSize(shape: BallastShape): V3 {
  if (shape.kind === "block") return [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
  const r = shape.diameter / 2;
  const l = shape.length / 2;
  return shape.axis === "x" ? [l, r, r] : shape.axis === "y" ? [r, l, r] : [r, r, l];
}

/** The block's extent in the car frame, from the kit's datums. */
export function blockBox(kit = TYPICAL_KIT_ESTIMATE): { min: V3; max: V3 } {
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

/** Profiles that cut nothing: slightly larger than the block. */
export function uncutDesign(kit = TYPICAL_KIT_ESTIMATE): CarDesign {
  const b = blockBox(kit);
  const pad = 0.002;
  return {
    schema: 1,
    name: "Uncut block",
    kitId: "typical-kit-estimate",
    side: rect(b.min[0] - pad, b.min[2] - pad, b.max[0] + pad, b.max[2] + pad),
    top: rect(b.min[0] - pad, b.min[1] - pad, b.max[0] + pad, b.max[1] + pad),
    features: [],
    ballast: [],
    paint: "#c8a46e",
    axlePrep: "polished-graphite",
  };
}

/**
 * A starting design: a wedge falling from 1.0 in at the rear to 0.25 in at the nose, with a full-width
 * tungsten cylinder in a cavity just ahead of the rear axle.
 */
export function wedgeDesign(kit = TYPICAL_KIT_ESTIMATE): CarDesign {
  const b = blockBox(kit);
  const base = uncutDesign(kit);
  const zb = b.min[2];
  const xr = b.min[0];
  const xf = b.max[0];
  return {
    ...base,
    name: "Wedge",
    side: {
      points: [
        [xr - 0.002, zb - 0.002],
        [xf + 0.002, zb - 0.002],
        [xf + 0.002, zb + inches(0.25)],
        [xr + inches(1.5), zb + inches(1.0)],
        [xr - 0.002, zb + inches(1.0)],
      ],
    },
    ballast: [
      {
        id: "w1",
        material: "tungsten",
        shape: { kind: "cylinder", diameter: inches(0.375), length: inches(1.5), axis: "y" },
        center: [inches(0.5), 0, zb + inches(0.45)],
        mounting: "cavity",
      },
    ],
  };
}
