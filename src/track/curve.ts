// What the solver needs from a lane profile, independent of how it was built (TRK-003, PHY-009):
// exact lines and arcs (path.ts) or a curve fitted to survey points (spline.ts).

import type { Vec2 } from "../core/vec2.js";

export interface PathPoint {
  readonly p: Vec2;
  /** Unit tangent in the direction of increasing arc length. */
  readonly t: Vec2;
  /** Unit normal, tangent rotated +90 deg: points up off the surface for travel in +x. */
  readonly n: Vec2;
  readonly kappa: number;
}

/** A plane curve parameterized by arc length. Beyond either end it continues straight. */
export interface Curve {
  readonly length: number;
  at(s: number): PathPoint;
  /**
   * Arc lengths where curvature, or its derivative, is not smooth, ending with the curve length.
   * The integrator lands its steps on these.
   */
  joins(): number[];
}

/** A wheel-centre path: the lane surface offset by the wheel radius along its normal. */
export interface CentrePath extends Curve {
  /** Arc length on this path of the point above surface arc length u (same normal line). */
  fromSurface(u: number): number;
}

/** A lane surface. */
export interface Surface extends Curve {
  /** The path of the centre of a wheel of radius r rolling on this surface. */
  offset(r: number): CentrePath;
}
