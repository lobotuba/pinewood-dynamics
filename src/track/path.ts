// Plane curves built from constant-curvature pieces (straight lines and circular arcs).
// Used for the lane surface and for the wheel-centre paths offset from it (TRK-003, PHY-009).
// Every quantity is analytic, so position, tangent and curvature are exact everywhere.

import { type Vec2, add, leftNormal, scale, v2 } from "../core/vec2.js";
import type { CentrePath, PathPoint, Surface } from "./curve.js";

export type { PathPoint } from "./curve.js";

/** Input description: a straight line, or an arc turning by `turn` radians (counterclockwise positive). */
export type SegmentSpec =
  | { readonly kind: "line"; readonly length: number }
  | { readonly kind: "arc"; readonly radius: number; readonly turn: number };

interface Piece {
  readonly s0: number; // arc length at piece start
  readonly length: number;
  readonly p0: Vec2;
  readonly heading0: number; // tangent angle from +x, counterclockwise positive
  readonly kappa: number; // signed curvature, counterclockwise positive
}

export class Path implements Surface, CentrePath {
  readonly length: number;
  private readonly pieces: readonly Piece[];
  /** The surface this path was offset from, if any. */
  private readonly base: Path | null;

  private constructor(pieces: readonly Piece[], base: Path | null = null) {
    this.pieces = pieces;
    this.base = base;
    const last = pieces[pieces.length - 1]!;
    this.length = last.s0 + last.length;
  }

  static build(start: Vec2, heading: number, specs: readonly SegmentSpec[]): Path {
    if (specs.length === 0) throw new Error("Path needs at least one segment");
    const pieces: Piece[] = [];
    let s0 = 0;
    let p0 = start;
    let h0 = heading;
    for (const spec of specs) {
      const piece =
        spec.kind === "line"
          ? { s0, length: spec.length, p0, heading0: h0, kappa: 0 }
          : { s0, length: spec.radius * Math.abs(spec.turn), p0, heading0: h0, kappa: Math.sign(spec.turn) / spec.radius };
      if (!(piece.length > 0)) throw new Error("Path segments must have positive length");
      pieces.push(piece);
      const end = evalPiece(piece, piece.length);
      s0 += piece.length;
      p0 = end.p;
      h0 = piece.heading0 + piece.kappa * piece.length;
    }
    return new Path(pieces);
  }

  /**
   * The curve traced by a wheel centre of radius r rolling on this path: offset r along the normal.
   * An arc of curvature k offsets to curvature k/(1 - k r) and length L(1 - k r).
   */
  offset(r: number): Path {
    let s0 = 0;
    const out: Piece[] = [];
    for (const pc of this.pieces) {
      const shrink = 1 - pc.kappa * r;
      if (!(shrink > 0)) {
        throw new Error(`Wheel radius ${r} m exceeds the radius of a concave track arc; wheel cannot follow it`);
      }
      const n0 = leftNormal(v2(Math.cos(pc.heading0), Math.sin(pc.heading0)));
      const length = pc.length * shrink;
      out.push({ s0, length, p0: add(pc.p0, scale(n0, r)), heading0: pc.heading0, kappa: pc.kappa / shrink });
      s0 += length;
    }
    return new Path(out, this);
  }

  fromSurface(u: number): number {
    if (this.base === null) throw new Error("fromSurface needs a path built by offset()");
    return this.base.mapToOffset(u, this);
  }

  /** Arc lengths of the joins between pieces, where curvature may jump. */
  joins(): number[] {
    return this.pieces.slice(1).map((pc) => pc.s0).concat(this.length);
  }

  /** Point at arc length s. Beyond either end the path continues straight along the end tangent. */
  at(s: number): PathPoint {
    const pc = this.pieceAt(s);
    return evalPiece(pc, s - pc.s0);
  }

  /**
   * Map arc length on this path to arc length on a path built by `offset` from it, piece by piece.
   * Exact because an offset arc is parameterized proportionally to the original.
   */
  mapToOffset(s: number, offsetPath: Path): number {
    if (s < 0) return s; // straight extensions map one to one
    if (s > this.length) return offsetPath.length + (s - this.length);
    const i = this.pieceIndex(s);
    const a = this.pieces[i]!;
    const b = offsetPath.pieces[i]!;
    return b.s0 + ((s - a.s0) / a.length) * b.length;
  }

  private pieceIndex(s: number): number {
    const ps = this.pieces;
    if (s <= ps[0]!.s0) return 0;
    let lo = 0;
    let hi = ps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ps[mid]!.s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private pieceAt(s: number): Piece {
    const i = this.pieceIndex(s);
    const pc = this.pieces[i]!;
    const beforeStart = i === 0 && s < 0;
    const pastEnd = i === this.pieces.length - 1 && s > pc.s0 + pc.length;
    if (!beforeStart && !pastEnd) return pc;
    // Straight extension along the end tangent.
    if (beforeStart) return { ...pc, kappa: 0 };
    const end = evalPiece(pc, pc.length);
    return { s0: pc.s0 + pc.length, length: Infinity, p0: end.p, heading0: pc.heading0 + pc.kappa * pc.length, kappa: 0 };
  }
}

function evalPiece(pc: Piece, u: number): PathPoint {
  const h = pc.heading0 + pc.kappa * u;
  const t = v2(Math.cos(h), Math.sin(h));
  let p: Vec2;
  if (pc.kappa === 0) {
    p = add(pc.p0, v2(Math.cos(pc.heading0) * u, Math.sin(pc.heading0) * u));
  } else {
    const r = 1 / pc.kappa;
    p = add(pc.p0, v2(r * (Math.sin(h) - Math.sin(pc.heading0)), -r * (Math.cos(h) - Math.cos(pc.heading0))));
  }
  return { p, t, n: leftNormal(t), kappa: pc.kappa };
}
