// KID level, Shape It (spec 12.7 A, MODE-005): picking a cut shape, or drawing a saw line, on the same
// model as every other level. Each shape is a side and a top outline made of saw lines (and, for the
// bullet, one arc) on the kit's block, so it is buildable with a coping saw at the BASIC tier (12.6).
// Shapes have no performance values of their own (VIS-002): what a shape does is what the solver says.

import { inches } from "../core/units.js";
import { type CarDesign, type Cut, type P2, type Profile, blockBox, kitValuesOf } from "../geometry/design.js";
import type { KitValues } from "../kit/kit.js";

export type KidShapeId = "block" | "wedge" | "low" | "pickup" | "arrow" | "bullet";

export interface KidShape {
  readonly id: KidShapeId;
  readonly name: string;
  /** One line a child can read. */
  readonly blurb: string;
}

export const KID_SHAPES: readonly KidShape[] = [
  { id: "block", name: "Block", blurb: "The block just as it comes. No sawing." },
  { id: "wedge", name: "Wedge", blurb: "Tall at the back, low at the front. One long saw line." },
  { id: "low", name: "Low rider", blurb: "Flat and low, with a sloped nose." },
  { id: "pickup", name: "Pickup", blurb: "A cab in the middle and a truck bed at the back." },
  { id: "arrow", name: "Arrow", blurb: "A wedge with a pointed nose, seen from above." },
  { id: "bullet", name: "Bullet", blurb: "A rounded nose and a smooth roof." },
];

/** Wood left above the bottom face over an axle slot, so the slot keeps its sides. */
export const MIN_OVER_AXLE = inches(3 / 8);
/** Width kept beside the front axle before a pointed nose starts. */
const NOSE_START = inches(0.35);

const rect = (x0: number, a0: number, x1: number, a1: number): Profile => ({
  points: [
    [x0, a0],
    [x1, a0],
    [x1, a1],
    [x0, a1],
  ],
});

/**
 * A wedge's nose height: `want`, raised where needed so the slope from `hr` at `x0` still leaves
 * MIN_OVER_AXLE over the front axle at `xa`.
 */
function noseHeight(hr: number, x0: number, xn: number, xa: number, want: number): number {
  if (xa <= x0) return want;
  const need = hr - ((hr - MIN_OVER_AXLE) * (xn - x0)) / (xa - x0);
  return Math.min(hr, Math.max(want, need));
}

/** The side and top outlines of a shape on this kit's block. */
export function kidShapeProfiles(id: KidShapeId, kit: KitValues): { side: Profile; top: Profile } {
  const b = blockBox(kit);
  const [xr, , zb] = b.min;
  const [xf, yw, zt] = b.max;
  const L = xf - xr;
  const H = zt - zb;
  const xa = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
  const z = (h: number): number => zb + h;
  const top = rect(xr, -yw, xf, yw);
  const pts = (p: P2[]): Profile => ({ points: p });
  switch (id) {
    case "block":
      return { side: rect(xr, zb, xf, zt), top };
    case "wedge":
    case "arrow": {
      const hr = 0.8 * H;
      const x0 = xr + 0.2 * L;
      const hn = noseHeight(hr, x0, xf, xa, 0.2 * H);
      const side = pts([
        [xr, zb],
        [xf, zb],
        [xf, z(hn)],
        [x0, z(hr)],
        [xr, z(hr)],
      ]);
      if (id === "wedge") return { side, top };
      // Pointed seen from above, starting ahead of the front axle so its slot keeps both sides.
      const xs = Math.min(xa + NOSE_START, xf - inches(0.4));
      const tip = 0.2 * yw;
      return {
        side,
        top: pts([
          [xr, -yw],
          [xs, -yw],
          [xf, -tip],
          [xf, tip],
          [xs, yw],
          [xr, yw],
        ]),
      };
    }
    case "low": {
      const h = Math.max(0.55 * H, MIN_OVER_AXLE);
      return {
        side: pts([
          [xr, zb],
          [xf, zb],
          [xf, z(Math.min(h, Math.max(0.3 * H, MIN_OVER_AXLE)))],
          [xf - 0.12 * L, z(h)],
          [xr, z(h)],
        ]),
        top,
      };
    }
    case "pickup": {
      const deck = Math.max(0.5 * H, MIN_OVER_AXLE);
      const roof = 0.95 * H;
      return {
        side: pts([
          [xr, zb],
          [xf, zb],
          [xf, z(Math.max(0.4 * H, MIN_OVER_AXLE))],
          [xf - 0.1 * L, z(deck)],
          [xr + 0.62 * L, z(deck)],
          [xr + 0.52 * L, z(roof)],
          [xr + 0.32 * L, z(roof)],
          [xr + 0.32 * L, z(deck)],
          [xr, z(deck)],
        ]),
        top,
      };
    }
    case "bullet": {
      const hn = Math.max(0.4 * H, MIN_OVER_AXLE);
      const roof = 0.78 * H;
      // The nose-to-roof edge bows outward: the outline runs anticlockwise, so outward is to the right
      // of travel, a negative bulge (about a 70° arc).
      return {
        side: { points: [
          [xr, zb],
          [xf, zb],
          [xf, z(hn)],
          [xr + 0.5 * L, z(roof)],
          [xr, z(roof)],
        ], bulge: [0, 0, -0.33, 0, 0] },
        top,
      };
    }
  }
}

/**
 * The design re-shaped: new side and top outlines, and no saw lines (they belonged to the old shape).
 * Holes and weights stay where they are; the caller puts the weights back into the wood.
 */
export function withKidShape(d: CarDesign, id: KidShapeId): CarDesign {
  const p = kidShapeProfiles(id, kitValuesOf(d));
  return { ...d, side: p.side, top: p.top, features: d.features.filter((f) => f.kind !== "cut") };
}

/** Area-weighted centre of a profile's straight-edge polygon (arcs ignored: it only picks a side). */
function centroid(p: Profile): P2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = p.points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p.points[i]!;
    const [x1, y1] = p.points[(i + 1) % n]!;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  return a === 0 ? p.points[0]! : [cx / (3 * a), cy / (3 * a)];
}

/** Wood a saw line leaves either side of an axle slot's centre, so the slot holds its axle. */
export const SLOT_WOOD = inches(1 / 4);

/** Shortest saw line a child can draw, m. */
export const MIN_SAW_LINE = 0.005;

/**
 * A saw line drawn on the side view from `a` to `b`, (x, z): a straight cut through the whole width that
 * takes off the side away from the middle of the wood. Refused (a reason string) when it is too short
 * or would cut into an axle slot.
 */
export function sawLine(d: CarDesign, a: P2, b: P2, id: string): Cut | string {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < MIN_SAW_LINE) return "Draw a longer line.";
  let n: [number, number] = [-dz / len, dx / len];
  const c = centroid(d.side);
  if (n[0] * (c[0] - a[0]) + n[1] * (c[1] - a[1]) > 0) n = [-n[0], -n[1]];
  const kit = kitValuesOf(d);
  const bb = blockBox(kit);
  const xa = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
  // The wood around each slot: SLOT_WOOD either side of it, from the bottom to a sixteenth above the slot.
  const keep = (x: number): P2[] => {
    const top = bb.min[2] + kit.axleAboveBlockBottom.value + kit.axleRadius.value + inches(1 / 16);
    return [
      [x - SLOT_WOOD, bb.min[2]],
      [x + SLOT_WOOD, bb.min[2]],
      [x - SLOT_WOOD, top],
      [x + SLOT_WOOD, top],
    ];
  };
  const removed = (p: P2): boolean => n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]) > 0;
  if ([...keep(0), ...keep(xa)].some(removed)) return "That line would saw into an axle slot. Keep it away from the wheels.";
  return { kind: "cut", id, planes: [{ point: [a[0], 0, a[1]], normal: [n[0], 0, n[1]] }] };
}
