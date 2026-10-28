// Lane surfaces fitted to survey points (TRK-003, CHAR-005).
//
// The surface height z(x) is a natural cubic smoothing spline through the surveyed stations. The
// amount of smoothing is not a free choice. With the measurement uncertainty known, it minimizes the
// unbiased estimate of the fit's own error against the true lane (UBRE, Wahba 1990, section 4.7):
// chi^2 + 2 tr(H) - n, where H maps measured to fitted heights. A cubic spline has continuous slope
// and curvature, so the car's equations of motion stay continuous along the lane.
//
// Arc length is integrated with 8-point Gauss-Legendre quadrature on each spline interval, and the
// wheel-centre path uses the exact offset relation sigma(u) = u - r (theta(u) - theta(0)).

import { add, leftNormal, scale, v2 } from "../core/vec2.js";
import type { CentrePath, PathPoint, Surface } from "./curve.js";

/** z(x) on [x_i, x_i+1]: a + b t + c t^2 + d t^3, t = x - x_i. */
export interface CubicSpline {
  readonly x: readonly number[];
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly c: readonly number[];
  readonly d: readonly number[];
}

export interface SmoothingFit {
  readonly spline: CubicSpline;
  /** Smoothing weight on the integral of z''^2, m. */
  readonly alpha: number;
  /** Sum of squared residuals over effective variances. Near n - edf for a correct uncertainty. */
  readonly chi2: number;
  /** Effective degrees of freedom of the fit, tr(H). */
  readonly edf: number;
  /** True if the points are consistent with a straight line at their uncertainty. */
  readonly straight: boolean;
  /** Measured minus fitted height at each station, m. */
  readonly residuals: readonly number[];
  /** Effective one-sigma height uncertainty at each station, m (height and slope times horizontal). */
  readonly sigma: readonly number[];
  /**
   * Leave-one-out residual over its expected spread: r_i / (sigma_i sqrt(1 - H_ii)). H_ii is how much
   * station i pulls the fit toward itself. Large values flag stations the rest of the survey disagrees with.
   */
  readonly standardized: readonly number[];
}

/**
 * Fit z(x) to stations with height uncertainty sigmaZ and horizontal uncertainty sigmaX (one sigma, m).
 * Horizontal error acts as height error times the local slope, so the effective variance
 * sigmaZ^2 + (z' sigmaX)^2 is refined from a first fit's slopes.
 */
export function fitSurveySpline(
  x: readonly number[],
  z: readonly number[],
  sigmaZ: number,
  sigmaX = 0,
): SmoothingFit {
  const n = x.length;
  if (n < 4 || z.length !== n) throw new Error("A survey needs at least 4 stations with one height each");
  for (let i = 1; i < n; i++) {
    if (!(x[i]! > x[i - 1]!)) throw new Error(`Survey stations must increase strictly in x (station ${i})`);
  }
  if (!(sigmaZ > 0)) throw new Error("Survey height uncertainty must be positive");
  let sigma = new Array<number>(n).fill(sigmaZ);
  let fit = fitWithSigma(x, z, sigma);
  for (let pass = 0; pass < 3 && sigmaX > 0; pass++) {
    const spline = fit.spline;
    sigma = x.map((_, i) => Math.hypot(sigmaZ, slopeAtKnot(spline, i) * sigmaX));
    fit = fitWithSigma(x, z, sigma);
  }
  return fit;
}

const LOG10_ALPHA_MIN = -30;
const LOG10_ALPHA_MAX = 30;

function fitWithSigma(x: readonly number[], z: readonly number[], sigma: readonly number[]): SmoothingFit {
  const n = x.length;
  const ubre = (log10Alpha: number): number => {
    const s = smooth(x, z, sigma, 10 ** log10Alpha);
    return s.chi2 + 2 * s.edf - n;
  };
  // Coarse scan, then golden-section refinement around the best grid point.
  const step = 0.5;
  let bestK = 0;
  let bestU = Infinity;
  const grid = Math.round((LOG10_ALPHA_MAX - LOG10_ALPHA_MIN) / step);
  for (let k = 0; k <= grid; k++) {
    const u = ubre(LOG10_ALPHA_MIN + k * step);
    if (u < bestU) {
      bestU = u;
      bestK = k;
    }
  }
  let lo = LOG10_ALPHA_MIN + Math.max(0, bestK - 1) * step;
  let hi = LOG10_ALPHA_MIN + Math.min(grid, bestK + 1) * step;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let uc = ubre(c);
  let ud = ubre(d);
  while (hi - lo > 1e-6) {
    if (uc < ud) {
      hi = d;
      d = c;
      ud = uc;
      c = hi - phi * (hi - lo);
      uc = ubre(c);
    } else {
      lo = c;
      c = d;
      uc = ud;
      d = lo + phi * (hi - lo);
      ud = ubre(d);
    }
  }
  const alpha = 10 ** (0.5 * (lo + hi));
  const best = smooth(x, z, sigma, alpha, true);
  const residuals = z.map((zi, i) => zi - best.g[i]!);
  return {
    spline: splineFrom(x, best.g, best.gamma),
    alpha,
    chi2: best.chi2,
    edf: best.edf,
    straight: best.edf < 2 + 1e-3,
    residuals,
    sigma,
    standardized: residuals.map((r, i) => r / (sigma[i]! * Math.sqrt(Math.max(1 - best.leverage![i]!, 1e-300)))),
  };
}

export interface Smoothed {
  /** Fitted heights and second derivatives at the knots (gamma zero at both ends). */
  readonly g: number[];
  readonly gamma: number[];
  readonly chi2: number;
  readonly edf: number;
  /** H_ii, when requested. */
  readonly leverage?: number[];
}

/**
 * Natural cubic smoothing spline (Green and Silverman 1994, sections 2.3 and 3.2; Reinsch algorithm):
 * minimizes sum((z_i - g_i)/sigma_i)^2 + alpha * integral(g''^2). With M = R + alpha Q^T S Q and
 * S = diag(sigma^2): M gamma = Q^T z, g = z - alpha S Q gamma, and I - H = alpha S Q M^-1 Q^T.
 * Only the central band of M^-1 is needed for tr(H) and H_ii (Hutchinson and de Hoog 1985).
 */
export function smooth(
  x: readonly number[],
  z: readonly number[],
  sigma: readonly number[],
  alpha: number,
  wantLeverage = false,
): Smoothed {
  const n = x.length;
  const m = n - 2;
  const h = (i: number): number => x[i + 1]! - x[i]!;
  // Column k of Q (interior knot k+1) has entries at rows k, k+1, k+2.
  const q = (k: number): [number, number, number] => [1 / h(k), -1 / h(k) - 1 / h(k + 1), 1 / h(k + 1)];
  // Pentadiagonal bands, entry [k][j] = matrix(k, k + j): B = Q^T S Q and M = R + alpha B.
  const B = Array.from({ length: m }, () => [0, 0, 0]);
  const M = Array.from({ length: m }, () => [0, 0, 0]);
  for (let k = 0; k < m; k++) {
    const qk = q(k);
    for (let j = 0; j <= 2 && k + j < m; j++) {
      const ql = q(k + j);
      let sum = 0;
      // Rows shared by columns k and k+j: row k+r of column k is row (k+r)-(k+j) of column k+j.
      for (let r = j; r <= 2; r++) sum += qk[r]! * sigma[k + r]! ** 2 * ql[r - j]!;
      B[k]![j] = sum;
    }
    const R1 = k + 1 < m ? h(k + 1) / 6 : 0;
    M[k]![0] = (h(k) + h(k + 1)) / 3 + alpha * B[k]![0]!;
    M[k]![1] = R1 + alpha * B[k]![1]!;
    M[k]![2] = alpha * B[k]![2]!;
  }
  const { L, D } = ldlBand2(M);
  const rhs = Array.from({ length: m }, (_, k) => {
    const qk = q(k);
    return qk[0] * z[k]! + qk[1] * z[k + 1]! + qk[2] * z[k + 2]!;
  });
  const inner = solveLdl(L, D, rhs);
  const g = z.map((zi, i) => {
    let qg = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(m - 1, i); k++) qg += q(k)[i - k]! * inner[k]!;
    return zi - alpha * sigma[i]! ** 2 * qg;
  });
  let chi2 = 0;
  for (let i = 0; i < n; i++) chi2 += ((z[i]! - g[i]!) / sigma[i]!) ** 2;

  const S = inverseBand2(L, D);
  const Sat = (k: number, l: number): number => {
    const a = Math.min(k, l);
    const b = Math.max(k, l);
    return b - a <= 2 ? S[a]![b - a]! : 0;
  };
  // tr(I - H) = alpha tr(M^-1 B)
  let trIH = 0;
  for (let k = 0; k < m; k++) {
    trIH += S[k]![0]! * B[k]![0]!;
    if (k + 1 < m) trIH += 2 * S[k]![1]! * B[k]![1]!;
    if (k + 2 < m) trIH += 2 * S[k]![2]! * B[k]![2]!;
  }
  const edf = n - alpha * trIH;

  let leverage: number[] | undefined;
  if (wantLeverage) {
    leverage = z.map((_, i) => {
      let acc = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(m - 1, i); k++) {
        for (let l = Math.max(0, i - 2); l <= Math.min(m - 1, i); l++) acc += q(k)[i - k]! * Sat(k, l) * q(l)[i - l]!;
      }
      return 1 - alpha * sigma[i]! ** 2 * acc;
    });
  }
  return { g, gamma: [0, ...inner, 0], chi2, edf, ...(leverage ? { leverage } : {}) };
}

/** LDL^T of a symmetric positive-definite pentadiagonal matrix; L[k][d] = L(k, k - d), d = 1, 2. */
function ldlBand2(M: readonly (readonly number[])[]): { L: number[][]; D: number[] } {
  const m = M.length;
  const L = Array.from({ length: m }, () => [1, 0, 0]);
  const D = new Array<number>(m).fill(0);
  const Lat = (i: number, j: number): number => (i === j ? 1 : i - j >= 1 && i - j <= 2 ? L[i]![i - j]! : 0);
  for (let k = 0; k < m; k++) {
    for (let j = Math.max(0, k - 2); j < k; j++) {
      let s = M[j]![k - j]!;
      for (let i = Math.max(0, k - 2); i < j; i++) s -= Lat(k, i) * Lat(j, i) * D[i]!;
      L[k]![k - j] = s / D[j]!;
    }
    let dk = M[k]![0]!;
    for (let j = Math.max(0, k - 2); j < k; j++) dk -= Lat(k, j) ** 2 * D[j]!;
    if (!(dk > 0)) throw new Error("Smoothing system is not positive definite");
    D[k] = dk;
  }
  return { L, D };
}

function solveLdl(L: readonly (readonly number[])[], D: readonly number[], b: readonly number[]): number[] {
  const m = b.length;
  const y = [...b];
  for (let k = 0; k < m; k++) {
    for (let d = 1; d <= 2 && k - d >= 0; d++) y[k] = y[k]! - L[k]![d]! * y[k - d]!;
  }
  for (let k = 0; k < m; k++) y[k] = y[k]! / D[k]!;
  for (let k = m - 1; k >= 0; k--) {
    for (let d = 1; d <= 2 && k + d < m; d++) y[k] = y[k]! - L[k + d]![d]! * y[k + d]!;
  }
  return y;
}

/** Central band of M^-1 from M = L D L^T: S[k][j] = (M^-1)(k, k + j), j = 0..2. */
function inverseBand2(L: readonly (readonly number[])[], D: readonly number[]): number[][] {
  const m = D.length;
  const S = Array.from({ length: m }, () => [0, 0, 0]);
  // (M^-1)(k, j) = delta_kj / D_k - sum_{i > k} L(i, k) (M^-1)(i, j), for j >= k.
  const l = (i: number, k: number): number => (i < m ? L[i]![i - k]! : 0);
  const s = (a: number, b: number): number => (b < m ? S[a]![b - a]! : 0);
  for (let k = m - 1; k >= 0; k--) {
    const l1 = l(k + 1, k);
    const l2 = l(k + 2, k);
    const s2 = k + 2 < m ? -(l1 * s(k + 1, k + 2) + l2 * s(k + 2, k + 2)) : 0;
    const s1 = k + 1 < m ? -(l1 * s(k + 1, k + 1) + (k + 2 < m ? l2 * s(k + 1, k + 2) : 0)) : 0;
    S[k]![2] = s2;
    S[k]![1] = s1;
    S[k]![0] = 1 / D[k]! - l1 * s1 - l2 * s2;
  }
  return S;
}

function splineFrom(x: readonly number[], g: readonly number[], gamma: readonly number[]): CubicSpline {
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < x.length - 1; i++) {
    const h = x[i + 1]! - x[i]!;
    a.push(g[i]!);
    b.push((g[i + 1]! - g[i]!) / h - (h * (2 * gamma[i]! + gamma[i + 1]!)) / 6);
    c.push(gamma[i]! / 2);
    d.push((gamma[i + 1]! - gamma[i]!) / (6 * h));
  }
  return { x, a, b, c, d };
}

function slopeAtKnot(sp: CubicSpline, i: number): number {
  const last = sp.a.length - 1;
  if (i <= last) return sp.b[i]!;
  const h = sp.x[last + 1]! - sp.x[last]!;
  return sp.b[last]! + 2 * sp.c[last]! * h + 3 * sp.d[last]! * h * h;
}

// 8-point Gauss-Legendre nodes and weights on [-1, 1].
const GL_X = [
  -0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498,
  0.5255324099163290, 0.7966664774136267, 0.9602898564975363,
];
const GL_W = [
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620,
  0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
];

/** A lane surface z(x) given by a cubic spline, parameterized by arc length. */
export class SplineSurface implements Surface {
  readonly length: number;
  /** Arc length at each knot. */
  private readonly u0: number[];
  private readonly startPoint: PathPoint;
  private readonly endPoint: PathPoint;

  constructor(readonly spline: CubicSpline) {
    const sp = spline;
    this.u0 = [0];
    for (let i = 0; i < sp.a.length; i++) this.u0.push(this.u0[i]! + this.arc(i, this.h(i)));
    this.length = this.u0[this.u0.length - 1]!;
    this.startPoint = this.pointIn(0, 0);
    const last = sp.a.length - 1;
    this.endPoint = this.pointIn(last, this.h(last));
  }

  private h(i: number): number {
    return this.spline.x[i + 1]! - this.spline.x[i]!;
  }

  private slope(i: number, t: number): number {
    const sp = this.spline;
    return sp.b[i]! + t * (2 * sp.c[i]! + 3 * sp.d[i]! * t);
  }

  /** Arc length from the start of interval i to t along it. */
  private arc(i: number, t: number): number {
    let s = 0;
    for (let k = 0; k < 8; k++) {
      const m = this.slope(i, 0.5 * t * (1 + GL_X[k]!));
      s += GL_W[k]! * Math.sqrt(1 + m * m);
    }
    return 0.5 * t * s;
  }

  private pointIn(i: number, t: number): PathPoint {
    const sp = this.spline;
    const z = sp.a[i]! + t * (sp.b[i]! + t * (sp.c[i]! + sp.d[i]! * t));
    const m = this.slope(i, t);
    const zz = 2 * sp.c[i]! + 6 * sp.d[i]! * t;
    const q = Math.sqrt(1 + m * m);
    const tan = v2(1 / q, m / q);
    return { p: v2(sp.x[i]! + t, z), t: tan, n: leftNormal(tan), kappa: zz / (q * q * q) };
  }

  private interval(u: number): number {
    let lo = 0;
    let hi = this.u0.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.u0[mid]! <= u) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  at(u: number): PathPoint {
    if (u <= 0) return straightFrom(this.startPoint, u);
    if (u >= this.length) return straightFrom(this.endPoint, u - this.length);
    const i = this.interval(u);
    const target = u - this.u0[i]!;
    const h = this.h(i);
    // Newton on arc(i, t) = target; arc' = sqrt(1 + z'^2) >= 1, so this converges from a linear guess.
    let t = (target / (this.u0[i + 1]! - this.u0[i]!)) * h;
    for (let k = 0; k < 30; k++) {
      const m = this.slope(i, t);
      const step = (this.arc(i, t) - target) / Math.sqrt(1 + m * m);
      t = Math.min(h, Math.max(0, t - step));
      if (Math.abs(step) < 1e-15 * (1 + h)) break;
    }
    return this.pointIn(i, t);
  }

  /** Surface arc length at horizontal position x (straight extensions beyond the ends). */
  uAtX(x: number): number {
    const sp = this.spline;
    const n = sp.x.length;
    if (x <= sp.x[0]!) return (x - sp.x[0]!) / this.startPoint.t.x;
    if (x >= sp.x[n - 1]!) return this.length + (x - sp.x[n - 1]!) / this.endPoint.t.x;
    let i = 0;
    while (i < n - 2 && sp.x[i + 1]! <= x) i++;
    return this.u0[i]! + this.arc(i, x - sp.x[i]!);
  }

  /** Lane heading, rad, at surface arc length u. */
  heading(u: number): number {
    const t = this.at(u).t;
    return Math.atan2(t.z, t.x);
  }

  joins(): number[] {
    return this.u0.slice(1);
  }

  /** Largest and smallest curvature, sampled densely on every interval, 1/m. */
  curvatureRange(): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < this.spline.a.length; i++) {
      // kappa is z''/(1+z'^2)^1.5 with z'' linear in t: sample finely enough to catch the extremes.
      for (let k = 0; k <= 16; k++) {
        const kap = this.pointIn(i, (k / 16) * this.h(i)).kappa;
        min = Math.min(min, kap);
        max = Math.max(max, kap);
      }
    }
    return { min, max };
  }

  offset(r: number): CentrePath {
    return new SplineCentrePath(this, r);
  }
}

function straightFrom(pt: PathPoint, ds: number): PathPoint {
  return { p: add(pt.p, scale(pt.t, ds)), t: pt.t, n: pt.n, kappa: 0 };
}

/**
 * Centre path of a wheel of radius r on a spline surface. A point at surface arc length u maps to
 * centre-path arc length sigma(u) = u - r (theta(u) - theta(0)), since d(sigma)/du = 1 - kappa r.
 */
class SplineCentrePath implements CentrePath {
  readonly length: number;
  private readonly theta0: number;

  constructor(
    private readonly surface: SplineSurface,
    private readonly r: number,
  ) {
    const { max } = surface.curvatureRange();
    if (!(1 - max * r > 0)) {
      throw new Error(
        `Wheel radius ${r} m exceeds the tightest concave radius of the surveyed lane (${(1 / max).toFixed(4)} m); ` +
          "wheel cannot follow it",
      );
    }
    this.theta0 = surface.heading(0);
    this.length = this.fromSurface(surface.length);
  }

  fromSurface(u: number): number {
    if (u <= 0) return u;
    if (u >= this.surface.length) return this.sigma(this.surface.length) + (u - this.surface.length);
    return this.sigma(u);
  }

  private sigma(u: number): number {
    return u - this.r * (this.surface.heading(u) - this.theta0);
  }

  at(s: number): PathPoint {
    let u: number;
    if (s <= 0) u = s;
    else if (s >= this.length) u = this.surface.length + (s - this.length);
    else {
      // Newton on sigma(u) = s with sigma' = 1 - kappa r > 0.
      u = s;
      for (let k = 0; k < 30; k++) {
        const pt = this.surface.at(u);
        const step = (this.sigma(u) - s) / (1 - pt.kappa * this.r);
        u -= step;
        if (Math.abs(step) < 1e-15 * (1 + Math.abs(u))) break;
      }
    }
    const pt = this.surface.at(u);
    return {
      p: add(pt.p, scale(pt.n, this.r)),
      t: pt.t,
      n: pt.n,
      kappa: pt.kappa / (1 - pt.kappa * this.r),
    };
  }

  joins(): number[] {
    return this.surface.joins().map((u) => this.fromSurface(u));
  }
}
