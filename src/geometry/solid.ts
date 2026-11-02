// Body solid evaluation (spec 6.1, 6.5; GEO-002, GEO-009) with manifold-3d: guaranteed-manifold
// Booleans, so the body is always a valid closed solid and its mass properties are exact for its mesh.
//
//   Blank = Block ∩ Extrude_Y(side) ∩ Extrude_Z(top) − axle slots − saw cuts
//   Body  = Blank − bores − pockets − ballast cavities
//
// The blank is the sawn piece before drilling (6.1: "two saw cuts, then drilling"). Holes are checked
// against it for how a drill meets the surface, and against the finished body for a clear way in.

import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from "manifold-3d";
import { type KitValues, TYPICAL_KIT_ESTIMATE } from "../kit/kit.js";
import type { Axis, Ballast, BallastShape, CarDesign, Cut, Feature, P2, V3 } from "./design.js";
import { blockBox, kitValuesOf, shapeHalfSize } from "./design.js";
import { FACETS_PER_TURN, outline } from "./profile.js";

let loading: Promise<ManifoldToplevel> | null = null;

/** Load the WebAssembly module once. In the browser pass the URL the bundler gives manifold.wasm. */
export function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  loading ??= Module(wasmUrl === undefined ? undefined : { locateFile: () => wasmUrl }).then((w) => {
    w.setup();
    return w;
  });
  return loading;
}

/**
 * Facets per full circle for bores, cavities and slots. A 128-gon has 0.04 % less area than its
 * circle, so a 3/8 in cavity 1.5 in deep is off by about 3 mg of wood (GEO-007 tessellation).
 * Profile arcs and splines are faceted at the same angular step.
 */
export const CIRCLE_SEGMENTS = FACETS_PER_TURN;

export interface BodySolid {
  /** Triangle mesh: xyz per vertex, three indices per triangle, outward orientation. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly volume: number;
  readonly bounds: { readonly min: V3; readonly max: V3 };
  readonly empty: boolean;
  /**
   * Frontal area of the whole car: the silhouette, seen along X, of the body, wheels and external
   * ballast together, m^2 (AERO-001 input). Exact for the meshes; wheels are 128-gon cylinders.
   */
  readonly frontalArea: number;
  /**
   * How each surface-mounted weight meets the body (spec 6.5, geometry validity): touching it,
   * floating clear of it, or cutting into it without a cavity. Cavity weights are not listed.
   */
  readonly mounting: Readonly<Record<string, MountState>>;
  /** How each bore, pocket and cavity weight can be made, keyed by feature or weight id. */
  readonly holes: Readonly<Record<string, HoleAccess>>;
  /** Wood each saw cut removes from the profiled block on its own, m^3, keyed by cut id. */
  readonly cutRemoved: Readonly<Record<string, number>>;
}

/** A hole the drill, or the weight, goes in by: a bore, a pocket or a cavity weight's hole. */
export interface HoleAccess {
  readonly id: string;
  readonly source: "feature" | "ballast";
  readonly shape: "cylinder" | "box";
  /** Ends it can be made or loaded from: the way in is clear of the finished body. */
  readonly openings: readonly Opening[];
  /** Wood this hole alone removes from the sawn blank, m^3. */
  readonly removed: number;
}

export interface Opening {
  readonly axis: Axis;
  /** Outward direction along `axis`. */
  readonly sign: 1 | -1;
  /** Largest angle between the hole's axis and the blank's surface normal where the tool enters, rad. */
  readonly entryAngle: number;
  /** The whole footprint enters the blank's surface; false when part of it starts off an edge. */
  readonly onSurface: boolean;
}

export type MountState = "touching" | "floating" | "embedded";

/** A surface weight further than this from the body is floating (GEO-007 contact; provisional). */
export const CONTACT_GAP = 0.1e-3;
/** Overlap below this volume (1 mm^3) counts as touching, not cutting in. */
export const CONTACT_OVERLAP = 1e-9;

/** Owns every manifold object it creates, so one call frees all WASM memory. */
class Scope {
  private readonly owned: { delete(): void }[] = [];
  keep<T extends { delete(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }
  free(): void {
    for (const x of this.owned) x.delete();
    this.owned.length = 0;
  }
}

/** Closed outline as a cross-section; NonZero so either winding works. */
function section(w: ManifoldToplevel, s: Scope, pts: readonly P2[]): CrossSection {
  return s.keep(new w.CrossSection([pts.map((p) => [p[0], p[1]] as [number, number])], "NonZero"));
}

/** Rotate a +Z-aligned solid so its axis lies along `axis`. */
function alongAxis(m: Manifold, s: Scope, axis: Axis): Manifold {
  if (axis === "z") return m;
  return s.keep(axis === "x" ? m.rotate([0, 90, 0]) : m.rotate([90, 0, 0]));
}

/** A ballast shape or bore as a solid centred at `center`. */
function shapeSolid(w: ManifoldToplevel, s: Scope, shape: BallastShape, center: V3): Manifold {
  const m =
    shape.kind === "cylinder"
      ? alongAxis(s.keep(w.Manifold.cylinder(shape.length, shape.diameter / 2, shape.diameter / 2, CIRCLE_SEGMENTS, true)), s, shape.axis)
      : s.keep(w.Manifold.cube([...shape.size], true));
  return s.keep(m.translate([...center]));
}

const AXES: readonly Axis[] = ["x", "y", "z"];

/** The region a saw cut removes: inside every one of its half-spaces. Null if a plane is degenerate. */
function cutRegion(w: ManifoldToplevel, s: Scope, cut: Cut, centre: V3, span: number): Manifold | null {
  let m = s.keep(s.keep(w.Manifold.cube([span, span, span], true)).translate([...centre]));
  for (const pl of cut.planes) {
    const l = Math.hypot(...pl.normal);
    if (!(l > 0)) return null;
    const n: [number, number, number] = [pl.normal[0] / l, pl.normal[1] / l, pl.normal[2] / l];
    // trimByPlane keeps the normal side, which is the side the cut removes.
    m = s.keep(m.trimByPlane(n, n[0] * pl.point[0] + n[1] * pl.point[1] + n[2] * pl.point[2]));
  }
  return m;
}

/** A bore or pocket as the shape of the hole it leaves. */
export const featureShape = (f: Exclude<Feature, Cut>): BallastShape =>
  f.kind === "bore" ? { kind: "cylinder", diameter: f.diameter, length: f.depth, axis: f.axis } : { kind: "block", size: f.size };

interface HoleSolid {
  readonly solid: Manifold;
  readonly shape: BallastShape;
  readonly center: V3;
  readonly source: "feature" | "ballast";
}

interface Solids {
  /** Profiled block with its axle slots, before saw cuts. */
  readonly profiled: Manifold;
  /** After saw cuts: the piece a drill meets. */
  readonly blank: Manifold;
  readonly body: Manifold;
  readonly cutRegions: ReadonlyMap<string, Manifold>;
  readonly holeSolids: ReadonlyMap<string, HoleSolid>;
}

/** All solids of a design, owned by `s`. */
function buildSolids(w: ManifoldToplevel, s: Scope, design: CarDesign, kit: KitValues = kitValuesOf(design)): Solids {
  const b = blockBox(kit);
  const size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const block = s.keep(s.keep(w.Manifold.cube([...size])).translate([...b.min]));
  const span = 4 * Math.max(...size);
  const centre: V3 = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];

  // Side profile (x, z), swept across Y: extrude along the section's +Z, centre it, then turn the
  // section's Y into the car's Z (rotation +90 deg about X sends section z to car -y).
  const sideSweep = s.keep(s.keep(s.keep(section(w, s, outline(design.side)).extrude(span)).translate([0, 0, -span / 2])).rotate([90, 0, 0]));
  // Top profile (x, y), swept through Z.
  const topSweep = s.keep(s.keep(section(w, s, outline(design.top)).extrude(span)).translate([0, 0, -span / 2]));

  // Axle slots: grooves across the bottom face, axle diameter wide, up to the top of the axle.
  const r = kit.axleRadius.value;
  const slots: Manifold[] = [];
  for (const x of [0, kit.frontAxleFromRear.value - kit.rearAxleFromRear.value]) {
    const h = r - b.min[2];
    slots.push(s.keep(s.keep(w.Manifold.cube([2 * r, size[1] + 0.01, h], true)).translate([x, 0, b.min[2] + h / 2])));
  }
  const profiled = s.keep(s.keep(s.keep(block.intersect(sideSweep)).intersect(topSweep)).subtract(s.keep(w.Manifold.union(slots))));

  const cutRegions = new Map<string, Manifold>();
  for (const f of design.features) {
    if (f.kind !== "cut") continue;
    const m = cutRegion(w, s, f, centre, span);
    if (m) cutRegions.set(f.id, m);
  }
  const blank = cutRegions.size > 0 ? s.keep(profiled.subtract(s.keep(w.Manifold.union([...cutRegions.values()])))) : profiled;

  const holeSolids = new Map<string, HoleSolid>();
  for (const f of design.features) {
    if (f.kind === "cut") continue;
    const shape = featureShape(f);
    holeSolids.set(f.id, { solid: shapeSolid(w, s, shape, f.center), shape, center: f.center, source: "feature" });
  }
  for (const bl of design.ballast)
    if (bl.mounting === "cavity") holeSolids.set(bl.id, { solid: shapeSolid(w, s, bl.shape, bl.center), shape: bl.shape, center: bl.center, source: "ballast" });
  const body =
    holeSolids.size > 0 ? s.keep(blank.subtract(s.keep(w.Manifold.union([...holeSolids.values()].map((h) => h.solid))))) : blank;
  return { profiled, blank, body, cutRegions, holeSolids };
}

/** Sample points across a hole's end: centre plus rim (cylinder) or corners and edge midpoints (box). */
function footprint(shape: BallastShape, k: number): [number, number, number][] {
  const h = shapeHalfSize(shape);
  const [i, j] = [0, 1, 2].filter((a) => a !== k) as [number, number];
  const pts: [number, number, number][] = [[0, 0, 0]];
  const add = (u: number, v: number): void => {
    const o: [number, number, number] = [0, 0, 0];
    o[i] = u;
    o[j] = v;
    pts.push(o);
  };
  if (shape.kind === "cylinder")
    for (let q = 0; q < 8; q++) add(0.98 * h[i]! * Math.cos((q * Math.PI) / 4), 0.98 * h[j]! * Math.sin((q * Math.PI) / 4));
  else for (const [u, v] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const) add(0.98 * u * h[i]!, 0.98 * v * h[j]!);
  return pts;
}

/**
 * Which ends a hole can be made from. An end is open when a straight path out of it, across the
 * whole footprint, meets no wood of the finished body; there the entry angle is read off the blank.
 * A cylinder is drilled along its axis; a box can be cut from any face.
 */
function holeAccess(blank: Manifold, body: Manifold, shape: BallastShape, center: V3): Opening[] {
  const h = shapeHalfSize(shape);
  const far = 1;
  const eps = 1e-6;
  const out: Opening[] = [];
  const dirs = shape.kind === "cylinder" ? [AXES.indexOf(shape.axis)] : [0, 1, 2];
  for (const k of dirs)
    for (const sign of [1, -1] as const) {
      const pts = footprint(shape, k);
      // A point on the line through footprint offset `o`, `d` beyond the hole's end on this side.
      const at = (o: readonly number[], d: number): [number, number, number] =>
        [0, 1, 2].map((a) => center[a]! + o[a]! + (a === k ? sign * (h[k]! + d) : 0)) as [number, number, number];
      if (!pts.every((o) => body.rayCast(at(o, eps), at(o, far)).length === 0)) continue;
      let entryAngle = 0;
      let onSurface = true;
      for (const o of pts) {
        // From far outside toward the opposite end of the hole: the first surface met is the entry.
        const hit = blank.rayCast(at(o, far), at(o, -2 * h[k]!))[0];
        if (!hit) {
          onSurface = false;
          continue;
        }
        entryAngle = Math.max(entryAngle, Math.acos(Math.min(1, Math.abs(hit.normal[k]!))));
      }
      out.push({ axis: AXES[k]!, sign, entryAngle, onSurface });
    }
  return out;
}

export function evaluateBody(w: ManifoldToplevel, design: CarDesign, kit: KitValues = kitValuesOf(design)): BodySolid {
  const s = new Scope();
  try {
    const { profiled, blank, body, cutRegions, holeSolids } = buildSolids(w, s, design, kit);
    const mounting: Record<string, MountState> = {};
    for (const bl of design.ballast) {
      if (bl.mounting === "cavity") continue;
      const m = shapeSolid(w, s, bl.shape, bl.center);
      mounting[bl.id] =
        s.keep(body.intersect(m)).volume() > CONTACT_OVERLAP ? "embedded" : body.minGap(m, 2 * CONTACT_GAP) > CONTACT_GAP ? "floating" : "touching";
    }

    const holes: Record<string, HoleAccess> = {};
    for (const [id, hs] of holeSolids)
      holes[id] = {
        id,
        source: hs.source,
        shape: hs.shape.kind === "cylinder" ? "cylinder" : "box",
        openings: holeAccess(blank, body, hs.shape, hs.center),
        removed: s.keep(blank.intersect(hs.solid)).volume(),
      };
    const cutRemoved: Record<string, number> = {};
    for (const f of design.features) {
      if (f.kind !== "cut") continue;
      const region = cutRegions.get(f.id);
      cutRemoved[f.id] = region ? s.keep(profiled.intersect(region)).volume() : 0;
    }

    const parts: Manifold[] = [body];
    for (const c of wheelCentres(kit))
      parts.push(shapeSolid(w, s, { kind: "cylinder", diameter: 2 * kit.wheelRadius.value, length: kit.wheelWidth.value, axis: "y" }, c));
    for (const bl of design.ballast) if (bl.mounting !== "cavity") parts.push(shapeSolid(w, s, bl.shape, bl.center));
    // Rotate -90 deg about Y so car X becomes the projection axis.
    const frontalArea = s.keep(s.keep(s.keep(w.Manifold.union(parts)).rotate([0, -90, 0])).project()).area();

    const mesh = body.getMesh();
    const positions = new Float32Array(mesh.triVerts.length === 0 ? 0 : (mesh.vertProperties.length / mesh.numProp) * 3);
    for (let i = 0; i < positions.length / 3; i++)
      for (let k = 0; k < 3; k++) positions[3 * i + k] = mesh.vertProperties[i * mesh.numProp + k]!;
    const bb = body.boundingBox();
    return {
      positions,
      indices: new Uint32Array(mesh.triVerts),
      volume: body.volume(),
      bounds: { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] },
      empty: body.isEmpty(),
      frontalArea,
      mounting,
      holes,
      cutRemoved,
    };
  } finally {
    s.free();
  }
}

/**
 * Seat a surface weight on the body: rest a top weight on the highest surface under its footprint,
 * hang an underside weight from the lowest, and put a side weight against the outermost face on its
 * side. Rays are cast at the footprint's centre and corners.
 */
export function seatBallast(w: ManifoldToplevel, design: CarDesign, bl: Ballast, kit: KitValues = kitValuesOf(design)): Ballast {
  if (bl.mounting === "cavity") return bl;
  const s = new Scope();
  try {
    const { body } = buildSolids(w, s, design, kit);
    const h = shapeHalfSize(bl.shape);
    const c = bl.center;
    const far = 1;
    // Ray axis k, footprint across the other two axes.
    const k = bl.mounting === "side" ? 1 : 2;
    const sign = bl.mounting === "underside" ? -1 : bl.mounting === "side" ? Math.sign(c[1]) || 1 : 1;
    const [i, j] = [0, 1, 2].filter((a) => a !== k) as [number, number];
    let best: number | null = null;
    for (const [u, v] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      const o = [c[0], c[1], c[2]];
      o[i] = c[i]! + 0.98 * u * h[i]!;
      o[j] = c[j]! + 0.98 * v * h[j]!;
      const from = [...o] as [number, number, number];
      const to = [...o] as [number, number, number];
      from[k] = sign * far;
      to[k] = -sign * far;
      const hit = body.rayCast(from, to)[0];
      if (hit) best = best === null ? hit.position[k]! : sign > 0 ? Math.max(best, hit.position[k]!) : Math.min(best, hit.position[k]!);
    }
    if (best === null) return bl;
    const centre = [...c] as [number, number, number];
    centre[k] = best + sign * h[k]!;
    return { ...bl, center: centre as V3 };
  } finally {
    s.free();
  }
}

/** Where a tool coming in along axis `k` from the `sign` side first meets the blank through `at`. */
function surfaceOn(blank: Manifold, at: V3, k: number, sign: 1 | -1): number | null {
  const from = [...at] as [number, number, number];
  const to = [...at] as [number, number, number];
  from[k] = sign;
  to[k] = -sign;
  const hit = blank.rayCast(from, to)[0];
  return hit ? hit.position[k]! : null;
}

function withBlank<T>(w: ManifoldToplevel, design: CarDesign, kit: KitValues, f: (blank: Manifold) => T): T {
  const s = new Scope();
  try {
    return f(buildSolids(w, s, design, kit).blank);
  } finally {
    s.free();
  }
}

/** A new hole starts this far outside the surface, so its mouth is open rather than coplanar. */
export const HOLE_OVERSHOOT = 0.001;

export interface HoleRequest {
  readonly kind: "bore" | "pocket";
  readonly id: string;
  /** The face it is made from: drilled along `axis`, coming in from the `sign` side. */
  readonly axis: Axis;
  readonly sign: 1 | -1;
  /** Footprint centre; its coordinate along `axis` is ignored. */
  readonly at: V3;
  /** Bore: diameter. Pocket: footprint along the other two axes, in x, y, z order. */
  readonly width: number;
  readonly width2?: number;
  /** Depth into the wood, from where the tool first meets it at the footprint centre. */
  readonly depth: number;
}

/** A bore or pocket made from a face to a depth below the actual (sawn) surface there. */
export function placeHole(w: ManifoldToplevel, design: CarDesign, req: HoleRequest, kit: KitValues = kitValuesOf(design)): Feature {
  const k = AXES.indexOf(req.axis);
  const b = blockBox(kit);
  const surf = withBlank(w, design, kit, (blank) => surfaceOn(blank, req.at, k, req.sign)) ?? (req.sign > 0 ? b.max[k]! : b.min[k]!);
  const len = req.depth + HOLE_OVERSHOOT;
  const center = [...req.at] as [number, number, number];
  center[k] = surf + (req.sign * (HOLE_OVERSHOOT - req.depth)) / 2;
  if (req.kind === "bore") return { kind: "bore", id: req.id, center, axis: req.axis, diameter: req.width, depth: len };
  const size = [0, 0, 0] as [number, number, number];
  const [i, j] = [0, 1, 2].filter((a) => a !== k) as [number, number];
  size[i] = req.width;
  size[j] = req.width2 ?? req.width;
  size[k] = len;
  return { kind: "pocket", id: req.id, center, size };
}

/**
 * The shortest straight access hole from the surface to a cavity weight, matching its cross-section
 * so the weight can be pushed in: a bore along a cylinder's axis, or a pocket off a block's nearest
 * face. It runs from inside the cavity to just outside the surface. Null if no end is buried.
 */
export function accessHole(w: ManifoldToplevel, design: CarDesign, bl: Ballast, id: string, kit: KitValues = kitValuesOf(design)): Feature | null {
  if (bl.mounting !== "cavity") return null;
  const h = shapeHalfSize(bl.shape);
  const dirs = bl.shape.kind === "cylinder" ? [AXES.indexOf(bl.shape.axis)] : [0, 1, 2];
  return withBlank(w, design, kit, (blank) => {
    let best: { k: number; sign: 1 | -1; cap: number; surf: number; dist: number } | null = null;
    for (const k of dirs)
      for (const sign of [1, -1] as const) {
        const surf = surfaceOn(blank, bl.center, k, sign);
        if (surf === null) continue;
        const cap = bl.center[k]! + sign * h[k]!;
        const dist = sign * (surf - cap);
        if (dist > 0 && (!best || dist < best.dist)) best = { k, sign, cap, surf, dist };
      }
    if (!best) return null;
    const a = best.cap - best.sign * HOLE_OVERSHOOT;
    const z = best.surf + best.sign * HOLE_OVERSHOOT;
    const center = [...bl.center] as [number, number, number];
    center[best.k] = (a + z) / 2;
    const len = Math.abs(z - a);
    if (bl.shape.kind === "cylinder") return { kind: "bore", id, center, axis: bl.shape.axis, diameter: bl.shape.diameter, depth: len };
    const size = [...bl.shape.size] as [number, number, number];
    size[best.k] = len;
    return { kind: "pocket", id, center, size };
  });
}

/** Wheel centres: rear left, rear right, front left, front right. */
export function wheelCentres(kit: KitValues = TYPICAL_KIT_ESTIMATE): V3[] {
  const y = kit.blockWidth.value / 2 + kit.wheelBodyGap.value + kit.wheelWidth.value / 2;
  const xf = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
  return [
    [0, y, 0],
    [0, -y, 0],
    [xf, y, 0],
    [xf, -y, 0],
  ];
}

/**
 * Where a tool coming in along `axis` from the `sign` side first meets the sawn blank through `at`
 * (its coordinate along `axis`), or null if it misses the body.
 */
export function surfaceAlong(w: ManifoldToplevel, design: CarDesign, at: V3, axis: Axis, sign: 1 | -1, kit: KitValues = kitValuesOf(design)): number | null {
  return withBlank(w, design, kit, (blank) => surfaceOn(blank, at, AXES.indexOf(axis), sign));
}
