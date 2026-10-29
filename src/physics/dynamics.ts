// Instantaneous dynamics of the rigid car on the lane (PHY-009; derivation in docs/physics-model.md, 3).
//
// Unknowns: u = [a, N_r, N_f, T_r, T_f]
//   a    = d^2 s / dt^2 (rear-axle arc acceleration)
//   N_i  = normal contact force on axle i's wheels (both wheels together)
//   T_i  = tangential contact force on axle i's wheels, along the direction of travel
// Equations:
//   2 wheel-spin equations, 2 whole-car force equations, 1 whole-car moment equation about the CG.
// All are linear in u except the axle friction torque mu * rho * |R_i|, where R_i is the force the
// axle exerts on its wheels. R_i follows from the wheel pair's own Newton equation and is linear in
// u, so |R_i| = e_i . R_i with e_i its direction; e_i is found by Newton iteration. When friction
// depends on load (AxleModel.frictionExponent), the coefficient is updated from |R_i| in the same loop.
// Hub drag is a fixed torque and enters the wheel equations directly.
//
// External forces (from the lateral model: tread scrub, guide-rail friction) are given for the
// instant. A force on a wheel enters its spin equation and its bore load; a force on the body does
// not. Both enter the whole-car force and moment balance.

import { type Vec2, add, cross, dot, norm, scale, sub } from "../core/vec2.js";
import type { AxleModel, CarModel } from "./car.js";
import type { AxleState, Pose } from "./kinematics.js";
import type { PlanarForce } from "./lateral.js";

export interface LossSwitches {
  readonly axleFriction: boolean;
  readonly rollingResistance: boolean;
  readonly aero: boolean;
}

export const ALL_LOSSES: LossSwitches = { axleFriction: true, rollingResistance: true, aero: true };
export const NO_LOSSES: LossSwitches = { axleFriction: false, rollingResistance: false, aero: false };

export interface DynamicsEnv {
  readonly g: number;
  readonly rho: number;
  readonly losses: LossSwitches;
}

export interface Dynamics {
  readonly a: number;
  readonly Nr: number;
  readonly Nf: number;
  readonly Tr: number;
  readonly Tf: number;
  /** Magnitude of the axle-bore contact force on each axle's wheels, N. */
  readonly boreR: number;
  readonly boreF: number;
  /** Dissipated power by mechanism, W (ANA-001). pAxle includes hub drag. */
  readonly pAxle: number;
  /** Power of the external forces, W, by kind (negative when they take energy out). */
  readonly pTread: number;
  readonly pRail: number;
  readonly pRolling: number;
  readonly pAero: number;
  /** Wheel spin rates, rad/s, positive rolling forward. */
  readonly omegaR: number;
  readonly omegaF: number;
  /** CG velocity, m/s. */
  readonly vCg: Vec2;
  /**
   * False when sliding Coulomb friction has no consistent solution (Painleve-type: friction arm
   * mu r_axle / r near or above 1). At rest this means friction holds the car.
   */
  readonly converged: boolean;
}

/** Axle force on a wheel pair as an affine function of the unknowns: R = da a - n N - t T + r0. */
interface BoreForce {
  readonly da: Vec2;
  readonly n: Vec2;
  readonly t: Vec2;
  readonly r0: Vec2;
}

// Direction alone converges in a few steps. A load-dependent coefficient converges geometrically with
// ratio |1 - exponent|: 2/3 needs about 20 steps to reach 1e-10.
const MAX_BORE_ITERATIONS = 60;

export function dynamics(car: CarModel, pose: Pose, v: number, env: DynamicsEnv, ext: readonly PlanarForce[] = []): Dynamics {
  const { rear: R, front: F } = car;
  const L = env.losses;
  const v2 = v * v;
  const m = car.mass;
  const Ip = car.pitchInertia;

  // Spin rates and pitch rate (clockwise positive, same sense as forward wheel roll).
  const omegaR = (pose.rear.J * v) / R.r;
  const omegaF = (pose.front.J * v) / F.r;
  const pitchCw = -pose.dTheta * v;
  // Axle friction opposes wheel rotation relative to the body. At rest the car can only start forward.
  const sigma = (w: number): number => (w > 0 ? 1 : w < 0 ? -1 : 1);

  // Friction coefficient at bore load |R| (both wheels). Load is floored so mu stays finite as |R| -> 0.
  const mu = (ax: AxleModel, load: number): number => {
    if (!L.axleFriction) return 0;
    if (ax.frictionExponent === 1) return ax.mu;
    const perWheel = Math.max(load / 2, 1e-6 * ax.frictionReferenceLoad);
    return ax.mu * (perWheel / ax.frictionReferenceLoad) ** (ax.frictionExponent - 1);
  };
  const crr = (ax: AxleModel): number => (L.rollingResistance ? ax.crr : 0);
  const sR = sigma(omegaR - pitchCw);
  const sF = sigma(omegaF - pitchCw);
  const hubR = L.axleFriction ? R.hubDrag : 0;
  const hubF = L.axleFriction ? F.hubDrag : 0;

  const vCg = scale(pose.dCg, v);
  const speedCg = norm(vCg);
  const kAero = L.aero ? 0.5 * env.rho * car.dragArea : 0;
  const aero = scale(vCg, -kAero * speedCg);
  const grav = { x: 0, z: -env.g };

  const arm = (ax: AxleState): Vec2 => ({ x: ax.contact.x - pose.cg.x, z: ax.contact.z - pose.cg.z });
  const rhoR = arm(pose.rear);
  const rhoF = arm(pose.front);
  const nR = pose.rear.pt.n;
  const nF = pose.front.pt.n;
  const tR = pose.rear.pt.t;
  const tF = pose.front.pt.t;

  const spinR = R.spinInertia / R.r;
  const spinF = F.spinInertia / F.r;

  // Wheel pair i: m_w (C_i' a + C_i'' v^2) = m_w g + N n + T t + R, with C_i' = J t and
  // C_i'' = kappa J^2 n + K t for the axle centre on its path.
  const bore = (ax: AxleState, mw: number): BoreForce => {
    const { t, n, kappa } = ax.pt;
    const c2 = add(scale(n, kappa * ax.J * ax.J), scale(t, ax.K));
    return { da: scale(t, mw * ax.J), n, t, r0: sub(scale(c2, mw * v2), scale(grav, mw)) };
  };
  const boreAt = (bf: BoreForce, a: number, N: number, T: number): Vec2 =>
    add(add(scale(bf.da, a), bf.r0), add(scale(bf.n, -N), scale(bf.t, -T)));
  const bRbase = bore(pose.rear, R.wheelMass);
  const bFbase = bore(pose.front, F.wheelMass);

  // External forces: position and vector in the plane; on a wheel, its forward-roll torque about the
  // axle (z F_t - xi F_n) and its share of the wheel pair's Newton equation.
  const extRows = { spin: [0, 0], fx: 0, fz: 0, moment: 0, onWheel: [{ x: 0, z: 0 }, { x: 0, z: 0 }] };
  const extPts: { P: Vec2; F: Vec2; kind: PlanarForce["kind"]; axle: 0 | 1; onWheel: boolean; at: PlanarForce["at"] }[] = [];
  for (const f of ext) {
    const ax = f.axle === 0 ? pose.rear : pose.front;
    const { t, n } = ax.pt;
    const P = add(ax.pt.p, add(scale(t, f.at.t), scale(n, f.at.n)));
    const Fv = add(scale(t, f.f.t), scale(n, f.f.n));
    extRows.fx += Fv.x;
    extRows.fz += Fv.z;
    extRows.moment -= cross(sub(P, pose.cg), Fv);
    if (f.onWheel) {
      extRows.spin[f.axle] = extRows.spin[f.axle]! + f.at.n * f.f.t - f.at.t * f.f.n;
      extRows.onWheel[f.axle] = add(extRows.onWheel[f.axle]!, Fv);
    }
    extPts.push({ P, F: Fv, kind: f.kind, axle: f.axle, onWheel: f.onWheel, at: f.at });
  }
  const bR: BoreForce = { ...bRbase, r0: sub(bRbase.r0, extRows.onWheel[0]!) };
  const bF: BoreForce = { ...bFbase, r0: sub(bFbase.r0, extRows.onWheel[1]!) };

  // Rows: rear wheel, front wheel, force x, force z, moment (clockwise) about CG.
  const A: number[][] = [
    [spinR * pose.rear.J, crr(R) * R.r, 0, R.r, 0],
    [spinF * pose.front.J, 0, crr(F) * F.r, 0, F.r],
    [m * pose.dCg.x, -nR.x, -nF.x, -tR.x, -tF.x],
    [m * pose.dCg.z, -nR.z, -nF.z, -tR.z, -tF.z],
    [
      -Ip * pose.dTheta + spinR * pose.rear.J + spinF * pose.front.J,
      cross(rhoR, nR) + crr(R) * R.r,
      cross(rhoF, nF) + crr(F) * F.r,
      cross(rhoR, tR),
      cross(rhoF, tF),
    ],
  ];
  const b: number[] = [
    -spinR * pose.rear.K * v2 - sR * hubR + extRows.spin[0]!,
    -spinF * pose.front.K * v2 - sF * hubF + extRows.spin[1]!,
    m * grav.x + aero.x - m * pose.ddCg.x * v2 + extRows.fx,
    m * grav.z + aero.z - m * pose.ddCg.z * v2 + extRows.fz,
    Ip * pose.ddTheta * v2 - (spinR * pose.rear.K + spinF * pose.front.K) * v2 + extRows.moment,
  ];

  // Friction torque f |R| linearized as f (e . R(u)) in the wheel row; columns a, N_i, T_i. f is the
  // torque per newton of bore load, signed to oppose rotation relative to the body.
  const withFriction = (eR: Vec2, eF: Vec2, muR: number, muF: number): number[] => {
    const fricR = sR * muR * R.axleRadius;
    const fricF = sF * muF * F.axleRadius;
    const M = A.map((row) => [...row]);
    const rhs = [...b];
    const addRow = (row: number, f: number, e: Vec2, bf: BoreForce, colN: number, colT: number): void => {
      const r = M[row]!;
      r[0] = r[0]! + f * dot(e, bf.da);
      r[colN] = r[colN]! - f * dot(e, bf.n);
      r[colT] = r[colT]! - f * dot(e, bf.t);
      rhs[row] = rhs[row]! - f * dot(e, bf.r0);
    };
    addRow(0, fricR, eR, bR, 1, 3);
    addRow(1, fricF, eF, bF, 2, 4);
    return solveLinear(M, rhs);
  };

  // Start from the static direction (axle pushes its wheels down into the track) and the reference
  // coefficient.
  let eR = scale(nR, -1);
  let eF = scale(nF, -1);
  let muR = mu(R, 2 * R.frictionReferenceLoad);
  let muF = mu(F, 2 * F.frictionReferenceLoad);
  let u = withFriction(eR, eF, muR, muF);
  let converged = true;
  if (muR !== 0 || muF !== 0) {
    for (let it = 0; ; it++) {
      const boreVecR = boreAt(bR, u[0]!, u[1]!, u[3]!);
      const boreVecF = boreAt(bF, u[0]!, u[2]!, u[4]!);
      const nextR = unitOr(boreVecR, eR);
      const nextF = unitOr(boreVecF, eF);
      const nextMuR = mu(R, norm(boreVecR));
      const nextMuF = mu(F, norm(boreVecF));
      const change = Math.max(
        norm(sub(nextR, eR)),
        norm(sub(nextF, eF)),
        relChange(nextMuR, muR),
        relChange(nextMuF, muF),
      );
      eR = nextR;
      eF = nextF;
      muR = nextMuR;
      muF = nextMuF;
      // |R| - e.R is second order in the direction error, so 1e-10 leaves ~1e-20 relative error.
      if (change < 1e-10) break;
      if (it >= MAX_BORE_ITERATIONS || !u.every(Number.isFinite)) {
        converged = false;
        break;
      }
      u = withFriction(eR, eF, muR, muF);
    }
  }
  const [a, Nr, Nf, Tr, Tf] = u as [number, number, number, number, number];
  const boreR = norm(boreAt(bR, a, Nr, Tr));
  const boreF = norm(boreAt(bF, a, Nf, Tf));

  const slipR = Math.abs(omegaR - pitchCw);
  const slipF = Math.abs(omegaF - pitchCw);
  const pAxle =
    (mu(R, boreR) * R.axleRadius * boreR + hubR) * slipR + (mu(F, boreF) * F.axleRadius * boreF + hubF) * slipF;
  const pRolling = crr(R) * R.r * Nr * Math.abs(omegaR) + crr(F) * F.r * Nf * Math.abs(omegaF);
  const pAero = -dot(aero, vCg);

  // Power of each external force at its material point: a wheel point moves with the axle centre plus
  // the wheel's spin; a body point with the CG plus the pitch rotation.
  let pTread = 0;
  let pRail = 0;
  const pitchCcw = pose.dTheta * v;
  for (const e of extPts) {
    let vel: Vec2;
    if (e.onWheel) {
      const ax = e.axle === 0 ? pose.rear : pose.front;
      const w = e.axle === 0 ? omegaR : omegaF;
      vel = add(scale(ax.pt.t, ax.J * v), scale(add(scale(ax.pt.t, e.at.n), scale(ax.pt.n, -e.at.t)), w));
    } else {
      const rho = sub(e.P, pose.cg);
      vel = add(vCg, { x: -pitchCcw * rho.z, z: pitchCcw * rho.x });
    }
    const pw = dot(e.F, vel);
    if (e.kind === "tread") pTread += pw;
    else pRail += pw;
  }

  return { a, Nr, Nf, Tr, Tf, boreR, boreF, pAxle, pTread, pRail, pRolling, pAero, omegaR, omegaF, vCg, converged };
}

const relChange = (next: number, prev: number): number => (prev === 0 ? Math.abs(next) : Math.abs(next - prev) / prev);

function unitOr(x: Vec2, fallback: Vec2): Vec2 {
  const l = norm(x);
  return l > 0 ? scale(x, 1 / l) : fallback;
}

/** Gaussian elimination with partial pivoting. Small dense systems only. */
export function solveLinear(A: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (M[piv]![col] === 0) throw new Error("Singular dynamics system");
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const pr = M[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = M[r]!;
      const f = row[col]! / pr[col]!;
      for (let c = col; c <= n; c++) row[c] = row[c]! - f * pr[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = M[r]!;
    let acc = row[n]!;
    for (let c = r + 1; c < n; c++) acc -= row[c]! * x[c]!;
    x[r] = acc / row[r]!;
  }
  return x;
}
