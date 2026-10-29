// Profile curves (spec 6.1): closed outlines made of straight edges, circular arcs and smooth
// splines. A profile is its vertices plus two optional per-element lists, so a plain polyline stays
// the schema-1 shape it always was:
//
//   smooth[i]  vertex i is a spline vertex: the outline passes through it without a corner
//   bulge[i]   edge i (vertex i to i+1) is a circular arc; bulge = tan(θ/4), θ the included angle,
//              positive bowing to the left of the direction of travel (sagitta = bulge · half-chord)
//
// An edge that is not an arc is a cubic Bézier whose end tangents are the chord at a corner vertex
// and, at a spline vertex, the Catmull-Rom direction (an arc's own tangent where an arc meets it);
// handles are a third of the chord. Between two corners that is exactly the chord.
//
// A spline through a corner vertex passes outside the corner. To round a corner off the way a saw
// or sandpaper does, `filletVertex` replaces it with an arc tangent to both edges.

import type { P2, Profile } from "./design.js";

/** Facets per full turn of a curve, matching the 128-gon circles of bores and cavities (GEO-007). */
export const FACETS_PER_TURN = 128;
const STEP = (2 * Math.PI) / FACETS_PER_TURN;
/** Largest arc bulge the editor makes: a semicircle. */
export const MAX_BULGE = 1;

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const len = (a: P2): number => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [1, 0];
};
const rot = (a: P2, t: number): P2 => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];
/** Left normal of a direction. */
const left = (a: P2): P2 => [-a[1], a[0]];
const angleBetween = (a: P2, b: P2): number => (len(a) === 0 || len(b) === 0 ? 0 : Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])));

const n = (p: Profile): number => p.points.length;
const at = <T>(xs: readonly T[], i: number): T => xs[((i % xs.length) + xs.length) % xs.length]!;
export const isSmooth = (p: Profile, i: number): boolean => p.smooth?.[((i % n(p)) + n(p)) % n(p)] === true;
export const bulgeOf = (p: Profile, i: number): number => p.bulge?.[((i % n(p)) + n(p)) % n(p)] ?? 0;

/** Arc through edge i: centre, signed radius and sweep (radians, + anticlockwise). */
export function arcOf(p: Profile, i: number): { centre: P2; radius: number; start: number; sweep: number } | null {
  const b = bulgeOf(p, i);
  if (b === 0) return null;
  const A = at(p.points, i);
  const B = at(p.points, i + 1);
  const c = len(sub(B, A)) / 2;
  if (c === 0) return null;
  const s = b * c;
  const R = (c * c + s * s) / (2 * s);
  const mid = mul(add(A, B), 0.5);
  const centre = add(mid, mul(left(unit(sub(B, A))), s - R));
  return { centre, radius: Math.abs(R), start: Math.atan2(A[1] - centre[1], A[0] - centre[0]), sweep: -4 * Math.atan(b) };
}

/** Unit tangent of edge i where it leaves vertex i (`end` false) or arrives at vertex i+1 (`end` true). */
function edgeTangent(p: Profile, i: number, end: boolean): P2 {
  const A = at(p.points, i);
  const B = at(p.points, i + 1);
  const chord = unit(sub(B, A));
  const b = bulgeOf(p, i);
  if (b !== 0) return rot(chord, (end ? -2 : 2) * Math.atan(b));
  const v = end ? i + 1 : i;
  if (!isSmooth(p, v)) return chord;
  // A spline vertex next to an arc takes the arc's tangent, so the join stays smooth.
  if (end && bulgeOf(p, v) !== 0) return edgeTangent(p, v, false);
  if (!end && bulgeOf(p, v - 1) !== 0) return edgeTangent(p, v - 1, true);
  // Catmull-Rom: parallel to the line joining the two neighbours.
  const t = sub(at(p.points, v + 1), at(p.points, v - 1));
  return len(t) > 0 ? unit(t) : chord;
}

/** Points along edge i from vertex i to vertex i+1, both included. */
export function edgePoints(p: Profile, i: number): P2[] {
  const A = at(p.points, i);
  const B = at(p.points, i + 1);
  const arc = arcOf(p, i);
  if (arc) {
    const k = Math.max(1, Math.ceil(Math.abs(arc.sweep) / STEP - 1e-9));
    const out: P2[] = [A];
    for (let j = 1; j < k; j++) {
      const t = arc.start + (arc.sweep * j) / k;
      out.push([arc.centre[0] + arc.radius * Math.cos(t), arc.centre[1] + arc.radius * Math.sin(t)]);
    }
    out.push(B);
    return out;
  }
  if (!isSmooth(p, i) && !isSmooth(p, i + 1)) return [A, B];
  const L = len(sub(B, A)) / 3;
  const P1 = add(A, mul(edgeTangent(p, i, false), L));
  const P2_ = sub(B, mul(edgeTangent(p, i, true), L));
  const out: P2[] = [A];
  flatten(A, P1, P2_, B, 0, out);
  out[out.length - 1] = B;
  return out;
}

/**
 * Append a cubic Bézier's points after `a`, halving it until each piece's control polygon turns by
 * at most one facet step. The control polygon bounds the curve's turning, so every facet turns no
 * more than a 128-gon's.
 */
function flatten(a: P2, b: P2, c: P2, d: P2, depth: number, out: P2[]): void {
  const turn = angleBetween(sub(b, a), sub(c, b)) + angleBetween(sub(c, b), sub(d, c));
  if (turn <= STEP || depth >= 12) {
    out.push(d);
    return;
  }
  const mid = (p: P2, q: P2): P2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const ab = mid(a, b);
  const bc = mid(b, c);
  const cd = mid(c, d);
  const abc = mid(ab, bc);
  const bcd = mid(bc, cd);
  const m = mid(abc, bcd);
  flatten(a, ab, abc, m, depth + 1, out);
  flatten(m, bcd, cd, d, depth + 1, out);
}

/** The whole closed outline as a polygon (no repeated closing point). */
export function outline(p: Profile): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n(p); i++) out.push(...edgePoints(p, i).slice(0, -1));
  return out;
}

/** Drop the optional lists when they hold only defaults, and keep them as long as the vertex list. */
function tidy(points: P2[], smooth: boolean[], bulge: number[]): Profile {
  const out: { points: P2[]; smooth?: boolean[]; bulge?: number[] } = { points };
  if (smooth.some(Boolean)) out.smooth = smooth;
  if (bulge.some((b) => b !== 0)) out.bulge = bulge;
  return out;
}
const lists = (p: Profile): { points: P2[]; smooth: boolean[]; bulge: number[] } => ({
  points: [...p.points],
  smooth: p.points.map((_, i) => isSmooth(p, i)),
  bulge: p.points.map((_, i) => bulgeOf(p, i)),
});

export function moveVertex(p: Profile, i: number, to: P2): Profile {
  const l = lists(p);
  l.points[i] = to;
  return tidy(l.points, l.smooth, l.bulge);
}

/**
 * Add a vertex on edge i near `near`. On an arc the new vertex lands on the arc and both halves
 * keep its circle; on a spline edge it is a spline vertex if either end is.
 */
export function insertVertex(p: Profile, i: number, near: P2): Profile {
  const l = lists(p);
  const arc = arcOf(p, i);
  let q = near;
  let b1 = 0;
  let b2 = 0;
  if (arc) {
    // Fraction of the sweep at the clicked angle, kept strictly inside the arc.
    let d = Math.atan2(near[1] - arc.centre[1], near[0] - arc.centre[0]) - arc.start;
    const s = Math.sign(arc.sweep);
    d = (((d * s) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const f = Math.min(0.95, Math.max(0.05, d / Math.abs(arc.sweep)));
    const t = arc.start + arc.sweep * f;
    q = [arc.centre[0] + arc.radius * Math.cos(t), arc.centre[1] + arc.radius * Math.sin(t)];
    b1 = Math.tan((-arc.sweep * f) / 4);
    b2 = Math.tan((-arc.sweep * (1 - f)) / 4);
  }
  l.points.splice(i + 1, 0, q);
  l.smooth.splice(i + 1, 0, !arc && (isSmooth(p, i) || isSmooth(p, i + 1)));
  l.bulge.splice(i, 1, b1, b2);
  return tidy(l.points, l.smooth, l.bulge);
}

/** Remove vertex i; its two edges merge into one straight or spline edge. Needs at least 4 vertices. */
export function deleteVertex(p: Profile, i: number): Profile {
  if (n(p) <= 3) return p;
  const l = lists(p);
  l.points.splice(i, 1);
  l.smooth.splice(i, 1);
  if (i === 0) {
    l.bulge.splice(0, 1);
    l.bulge[l.bulge.length - 1] = 0;
  } else {
    l.bulge.splice(i - 1, 2, 0);
  }
  return tidy(l.points, l.smooth, l.bulge);
}

/**
 * Round corner i with an arc of `radius` tangent to both its edges' chords, taking wood off inside
 * the corner. The radius shrinks if the edges are too short for it (each tangent point stays within
 * half its edge). Returns the profile unchanged at a straight-through vertex.
 */
export function filletVertex(p: Profile, i: number, radius: number): Profile {
  const A = at(p.points, i - 1);
  const V = at(p.points, i);
  const B = at(p.points, i + 1);
  const u1 = unit(sub(V, A));
  const u2 = unit(sub(B, V));
  const cross = u1[0] * u2[1] - u1[1] * u2[0];
  const turn = angleBetween(u1, u2);
  if (turn < 1e-6 || turn > Math.PI - 1e-6) return p;
  const d = Math.min(radius * Math.tan(turn / 2), len(sub(V, A)) / 2, len(sub(B, V)) / 2);
  const P = sub(V, mul(u1, d));
  const Q = add(V, mul(u2, d));
  const l = lists(p);
  // The arc bows away from the corner: right of P->Q on a left turn, left on a right turn.
  const b = -Math.sign(cross) * Math.tan(turn / 4);
  const k = ((i % n(p)) + n(p)) % n(p);
  l.points.splice(k, 1, P, Q);
  l.smooth.splice(k, 1, false, false);
  // Edge k-1 now ends at P; the new edge k (P to Q) is the arc; edge k+1 (Q onward) is the old edge k.
  l.bulge.splice(k, 0, b);
  return tidy(l.points, l.smooth, l.bulge);
}

export function toggleSmooth(p: Profile, i: number): Profile {
  const l = lists(p);
  l.smooth[i] = !l.smooth[i];
  return tidy(l.points, l.smooth, l.bulge);
}

/** Bend edge i into the arc through its two vertices and the point `through` projects to. */
export function bendEdge(p: Profile, i: number, through: P2): Profile {
  const A = at(p.points, i);
  const B = at(p.points, i + 1);
  const c = len(sub(B, A)) / 2;
  const l = lists(p);
  if (c === 0) return p;
  const s = (through[0] - (A[0] + B[0]) / 2) * left(unit(sub(B, A)))[0] + (through[1] - (A[1] + B[1]) / 2) * left(unit(sub(B, A)))[1];
  const b = Math.max(-MAX_BULGE, Math.min(MAX_BULGE, s / c));
  l.bulge[i] = Math.abs(b) < 1e-4 ? 0 : b;
  return tidy(l.points, l.smooth, l.bulge);
}

export function straightenEdge(p: Profile, i: number): Profile {
  const l = lists(p);
  l.bulge[i] = 0;
  return tidy(l.points, l.smooth, l.bulge);
}

/** Point at the middle of edge i, on the curve: the handle that bends it. */
export function edgeMidpoint(p: Profile, i: number): P2 {
  const A = at(p.points, i);
  const B = at(p.points, i + 1);
  const arc = arcOf(p, i);
  if (arc) {
    const t = arc.start + arc.sweep / 2;
    return [arc.centre[0] + arc.radius * Math.cos(t), arc.centre[1] + arc.radius * Math.sin(t)];
  }
  const pts = edgePoints(p, i);
  if (pts.length === 2) return mul(add(A, B), 0.5);
  // Bézier: evaluate at t = 1/2 from the tessellation's own control points.
  const L = len(sub(B, A)) / 3;
  const P1 = add(A, mul(edgeTangent(p, i, false), L));
  const P2_ = sub(B, mul(edgeTangent(p, i, true), L));
  return mul(add(add(A, B), mul(add(P1, P2_), 3)), 1 / 8);
}

/** Enclosed area of the tessellated outline (shoelace), m^2: a check value for tests and readouts. */
export function outlineArea(p: Profile): number {
  const q = outline(p);
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const u = q[i]!;
    const v = q[(i + 1) % q.length]!;
    a += u[0] * v[1] - v[0] * u[1];
  }
  return Math.abs(a) / 2;
}
