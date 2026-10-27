// Rigid-car kinematics on the lane profile (PHY-009). The single generalized coordinate is s,
// the rear axle centre's arc length along its wheel-centre path. The front axle centre lies on
// its own path at chord distance WB. Pitch follows from the two axle positions.
//
// All first and second derivatives with respect to s are analytic (docs/physics-model.md, 2).

import { type Vec2, add, cross, dot, rotate, scale, sub, v2 } from "../core/vec2.js";
import type { Path, PathPoint } from "../track/path.js";
import type { CarModel } from "./car.js";

export interface AxleState {
  /** Arc length of this axle centre on its own path. */
  readonly s: number;
  readonly pt: PathPoint;
  /** d(s_axle)/ds and its second derivative. */
  readonly J: number;
  readonly K: number;
  /** Wheel-track contact point. */
  readonly contact: Vec2;
}

export interface Pose {
  readonly rear: AxleState;
  readonly front: AxleState;
  /** Pitch: angle of body +X from horizontal, counterclockwise positive. */
  readonly theta: number;
  readonly dTheta: number;
  readonly ddTheta: number;
  readonly cg: Vec2;
  readonly dCg: Vec2;
  readonly ddCg: Vec2;
  readonly nose: Vec2;
}

export class CarKinematics {
  constructor(
    private readonly car: CarModel,
    private readonly rearPath: Path,
    private readonly frontPath: Path,
  ) {}

  /** Front-axle arc length for a given rear-axle arc length; `guess` speeds up the solve. */
  frontS(s: number, guess?: number): number {
    const pr = this.rearPath.at(s).p;
    const wb = this.car.wheelbase;
    const f = (sf: number): [number, number] => {
      const q = this.frontPath.at(sf);
      const d = sub(q.p, pr);
      return [dot(d, d) - wb * wb, 2 * dot(d, q.t)];
    };
    // Newton from the guess; on a smooth lane the chord-length function is monotone near the root.
    let sf = guess ?? s + wb;
    for (let i = 0; i < 50; i++) {
      const [g, dg] = f(sf);
      const step = g / dg;
      sf -= step;
      if (Math.abs(step) < 1e-14) return sf;
    }
    // Fallback: bisection on a bracket ahead of the rear axle.
    let lo = s;
    let hi = s + 2 * wb;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid)[0] < 0) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  pose(s: number, frontGuess?: number): Pose {
    const car = this.car;
    const wb2 = car.wheelbase * car.wheelbase;
    const pr = this.rearPath.at(s);
    const sf = this.frontS(s, frontGuess);
    const pf = this.frontPath.at(sf);

    // Chord d from rear to front axle centre; |d| = WB is held fixed.
    const d = sub(pf.p, pr.p);
    const theta = Math.atan2(d.z, d.x);
    const dtf = dot(d, pf.t);
    const Jf = dot(d, pr.t) / dtf;
    const dd = sub(scale(pf.t, Jf), pr.t);
    const dTheta = cross(d, dd) / wb2;
    // Differentiating d.d' = 0 gives the front axle's second derivative.
    const curvTerms = sub(scale(pf.n, pf.kappa * Jf * Jf), scale(pr.n, pr.kappa));
    const Kf = -(dot(dd, dd) + dot(d, curvTerms)) / dtf;
    const ddd = add(curvTerms, scale(pf.t, Kf));
    const ddTheta = cross(d, ddd) / wb2;

    // CG = rear axle centre + body offset rotated by pitch.
    const q = rotate(car.cg, theta);
    const qPerp = v2(-q.z, q.x);
    const cg = add(pr.p, q);
    const dCg = add(pr.t, scale(qPerp, dTheta));
    const ddCg = add(add(scale(pr.n, pr.kappa), scale(qPerp, ddTheta)), scale(q, -dTheta * dTheta));

    return {
      rear: { s, pt: pr, J: 1, K: 0, contact: sub(pr.p, scale(pr.n, car.rear.r)) },
      front: { s: sf, pt: pf, J: Jf, K: Kf, contact: sub(pf.p, scale(pf.n, car.front.r)) },
      theta,
      dTheta,
      ddTheta,
      cg,
      dCg,
      ddCg,
      nose: add(pr.p, rotate(car.nose, theta)),
    };
  }
}
