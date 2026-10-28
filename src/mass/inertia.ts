// Mass properties (spec 7.6): closed-mesh integrals for the body, closed forms for primitives, and
// the parallel-axis sum. Tensors are 3x3 row-major, about the part's own centroid, in the car frame.

import type { Axis, V3 } from "../geometry/design.js";

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface MassPart {
  readonly mass: number;
  readonly centroid: V3;
  /** Inertia tensor about the centroid, kg m^2. */
  readonly inertia: Mat3;
}

export const ZERO3: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const diag = (a: number, b: number, c: number): Mat3 => [a, 0, 0, 0, b, 0, 0, 0, c];

/**
 * Volume, centroid and inertia (unit density) of a closed, outward-oriented triangle mesh, by the
 * divergence theorem: each triangle with a reference point forms a signed tetrahedron. Exact for the
 * mesh; integrals are taken about the bounding-box centre to limit cancellation.
 */
export function meshMassProperties(positions: ArrayLike<number>, indices: ArrayLike<number>, numProp = 3): {
  volume: number;
  centroid: V3;
  inertia: Mat3;
} {
  const n = positions.length / numProp;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const v = positions[i * numProp + k]!;
      lo[k] = Math.min(lo[k]!, v);
      hi[k] = Math.max(hi[k]!, v);
    }
  const o = [0, 1, 2].map((k) => 0.5 * (lo[k]! + hi[k]!)) as [number, number, number];
  const p = (i: number, k: number): number => positions[i * numProp + k]! - o[k]!;

  let V = 0;
  const S1 = [0, 0, 0];
  // Second moments: xx, yy, zz, xy, yz, zx.
  const S2 = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ax = p(a, 0), ay = p(a, 1), az = p(a, 2);
    const bx = p(b, 0), by = p(b, 1), bz = p(b, 2);
    const cx = p(c, 0), cy = p(c, 1), cz = p(c, 2);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    V += det / 6;
    const sx = ax + bx + cx, sy = ay + by + cy, sz = az + bz + cz;
    S1[0]! += (det * sx) / 24;
    S1[1]! += (det * sy) / 24;
    S1[2]! += (det * sz) / 24;
    // Integral of u v over a tetrahedron with one vertex at the origin:
    // det/120 * (sum over the other three of u_k v_k + (sum u_k)(sum v_k)).
    const m = (u: [number, number, number], w: [number, number, number], su: number, sw: number): number =>
      (det / 120) * (u[0] * w[0] + u[1] * w[1] + u[2] * w[2] + su * sw);
    const X: [number, number, number] = [ax, bx, cx];
    const Y: [number, number, number] = [ay, by, cy];
    const Z: [number, number, number] = [az, bz, cz];
    S2[0]! += m(X, X, sx, sx);
    S2[1]! += m(Y, Y, sy, sy);
    S2[2]! += m(Z, Z, sz, sz);
    S2[3]! += m(X, Y, sx, sy);
    S2[4]! += m(Y, Z, sy, sz);
    S2[5]! += m(Z, X, sz, sx);
  }
  const c = [S1[0]! / V, S1[1]! / V, S1[2]! / V] as const;
  // Second moments about the centroid, then I = trace(M) 1 - M.
  const xx = S2[0]! - V * c[0] * c[0];
  const yy = S2[1]! - V * c[1] * c[1];
  const zz = S2[2]! - V * c[2] * c[2];
  const xy = S2[3]! - V * c[0] * c[1];
  const yz = S2[4]! - V * c[1] * c[2];
  const zx = S2[5]! - V * c[2] * c[0];
  return {
    volume: V,
    centroid: [c[0] + o[0], c[1] + o[1], c[2] + o[2]],
    inertia: [yy + zz, -xy, -zx, -xy, zz + xx, -yz, -zx, -yz, xx + yy],
  };
}

export const scaleMat = (m: Mat3, k: number): Mat3 => m.map((x) => x * k) as unknown as Mat3;

/** Solid cylinder about its centroid, with its axis along `axis`. */
export function cylinderInertia(mass: number, radius: number, length: number, axis: Axis): Mat3 {
  const along = 0.5 * mass * radius * radius;
  const across = (mass * (3 * radius * radius + length * length)) / 12;
  return axis === "x" ? diag(along, across, across) : axis === "y" ? diag(across, along, across) : diag(across, across, along);
}

/** Solid box about its centroid. */
export function boxInertia(mass: number, size: V3): Mat3 {
  const [a, b, c] = size;
  return diag((mass * (b * b + c * c)) / 12, (mass * (c * c + a * a)) / 12, (mass * (a * a + b * b)) / 12);
}

/** Total mass, CG and inertia about the CG (parallel-axis theorem). */
export function combine(parts: readonly MassPart[]): MassPart {
  let m = 0;
  const s = [0, 0, 0];
  for (const p of parts) {
    m += p.mass;
    for (let k = 0; k < 3; k++) s[k]! += p.mass * p.centroid[k]!;
  }
  const cg: V3 = [s[0]! / m, s[1]! / m, s[2]! / m];
  const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of parts) {
    const d = [p.centroid[0] - cg[0], p.centroid[1] - cg[1], p.centroid[2] - cg[2]];
    const d2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) I[3 * i + j]! += p.inertia[3 * i + j]! + p.mass * ((i === j ? d2 : 0) - d[i]! * d[j]!);
  }
  return { mass: m, centroid: cg, inertia: I as unknown as Mat3 };
}
