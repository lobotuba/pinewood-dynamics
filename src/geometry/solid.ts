// Body solid evaluation (spec 6.1, 6.5; GEO-002, GEO-009) with manifold-3d: guaranteed-manifold
// Booleans, so the body is always a valid closed solid and its mass properties are exact for its mesh.
//
//   Body = Block ∩ Extrude_Y(side) ∩ Extrude_Z(top) − axle slots − features − ballast cavities

import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from "manifold-3d";
import { TYPICAL_KIT_ESTIMATE } from "../kit/kit.js";
import type { Axis, Ballast, BallastShape, CarDesign, P2, V3 } from "./design.js";
import { blockBox, shapeHalfSize } from "./design.js";

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
 */
export const CIRCLE_SEGMENTS = 128;

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

/** The body solid, owned by `s`. */
function buildBody(w: ManifoldToplevel, s: Scope, design: CarDesign, kit = TYPICAL_KIT_ESTIMATE): Manifold {
  const b = blockBox(kit);
  const size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const block = s.keep(s.keep(w.Manifold.cube([...size])).translate([...b.min]));
  const span = 4 * Math.max(...size);

  // Side profile (x, z), swept across Y: extrude along the section's +Z, centre it, then turn the
  // section's Y into the car's Z (rotation +90 deg about X sends section z to car -y).
  const sideSweep = s.keep(s.keep(s.keep(section(w, s, design.side.points).extrude(span)).translate([0, 0, -span / 2])).rotate([90, 0, 0]));
  // Top profile (x, y), swept through Z.
  const topSweep = s.keep(s.keep(section(w, s, design.top.points).extrude(span)).translate([0, 0, -span / 2]));

  let body = s.keep(s.keep(block.intersect(sideSweep)).intersect(topSweep));

  const cuts: Manifold[] = [];
  // Axle slots: grooves across the bottom face, axle diameter wide, up to the top of the axle.
  const r = kit.axleRadius.value;
  for (const x of [0, kit.frontAxleFromRear.value - kit.rearAxleFromRear.value]) {
    const h = r - b.min[2];
    cuts.push(s.keep(s.keep(w.Manifold.cube([2 * r, size[1] + 0.01, h], true)).translate([x, 0, b.min[2] + h / 2])));
  }
  for (const f of design.features)
    cuts.push(
      f.kind === "bore"
        ? shapeSolid(w, s, { kind: "cylinder", diameter: f.diameter, length: f.depth, axis: f.axis }, f.center)
        : shapeSolid(w, s, { kind: "block", size: f.size }, f.center),
    );
  for (const bl of design.ballast) if (bl.mounting === "cavity") cuts.push(shapeSolid(w, s, bl.shape, bl.center));
  if (cuts.length > 0) body = s.keep(body.subtract(s.keep(w.Manifold.union(cuts))));
  return body;
}

export function evaluateBody(w: ManifoldToplevel, design: CarDesign, kit = TYPICAL_KIT_ESTIMATE): BodySolid {
  const s = new Scope();
  try {
    const body = buildBody(w, s, design, kit);
    const mounting: Record<string, MountState> = {};
    for (const bl of design.ballast) {
      if (bl.mounting === "cavity") continue;
      const m = shapeSolid(w, s, bl.shape, bl.center);
      mounting[bl.id] =
        s.keep(body.intersect(m)).volume() > CONTACT_OVERLAP ? "embedded" : body.minGap(m, 2 * CONTACT_GAP) > CONTACT_GAP ? "floating" : "touching";
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
export function seatBallast(w: ManifoldToplevel, design: CarDesign, bl: Ballast, kit = TYPICAL_KIT_ESTIMATE): Ballast {
  if (bl.mounting === "cavity") return bl;
  const s = new Scope();
  try {
    const body = buildBody(w, s, design, kit);
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

/** Wheel centres: rear left, rear right, front left, front right. */
export function wheelCentres(kit = TYPICAL_KIT_ESTIMATE): V3[] {
  const y = kit.blockWidth.value / 2 + kit.wheelBodyGap.value + kit.wheelWidth.value / 2;
  const xf = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
  return [
    [0, y, 0],
    [0, -y, 0],
    [xf, y, 0],
    [xf, -y, 0],
  ];
}
