// Instantaneous dynamics of the rigid car on the lane (PHY-009; derivation in docs/physics-model.md, 3).
//
// Unknowns: u = [a, N_r, N_f, T_r, T_f]
//   a    = d^2 s / dt^2 (rear-axle arc acceleration)
//   N_i  = normal contact force on axle i's wheels (both wheels together)
//   T_i  = tangential contact force on axle i's wheels, along the direction of travel
// Equations (all linear in u for a given state):
//   2 wheel-spin equations, 2 whole-car force equations, 1 whole-car moment equation about the CG.

import { type Vec2, cross, dot, norm, scale } from "../core/vec2.js";
import type { AxleModel, CarModel } from "./car.js";
import type { AxleState, Pose } from "./kinematics.js";

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
  /** Dissipated power by mechanism, W (ANA-001). */
  readonly pAxle: number;
  readonly pRolling: number;
  readonly pAero: number;
  /** Wheel spin rates, rad/s, positive rolling forward. */
  readonly omegaR: number;
  readonly omegaF: number;
  /** CG velocity, m/s. */
  readonly vCg: Vec2;
}

export function dynamics(car: CarModel, pose: Pose, v: number, env: DynamicsEnv): Dynamics {
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
  const sR = sigma(omegaR - pitchCw);
  const sF = sigma(omegaF - pitchCw);

  const mu = (ax: AxleModel): number => (L.axleFriction ? ax.mu : 0);
  const crr = (ax: AxleModel): number => (L.rollingResistance ? ax.crr : 0);
  // Resisting torque on a wheel per newton of normal load.
  const lossArmR = sR * mu(R) * R.axleRadius + crr(R) * R.r;
  const lossArmF = sF * mu(F) * F.axleRadius + crr(F) * F.r;

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

  // Rows: rear wheel, front wheel, force x, force z, moment (clockwise) about CG.
  const A: number[][] = [
    [spinR * pose.rear.J, lossArmR, 0, R.r, 0],
    [spinF * pose.front.J, 0, lossArmF, 0, F.r],
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
    -spinR * pose.rear.K * v2,
    -spinF * pose.front.K * v2,
    m * grav.x + aero.x - m * pose.ddCg.x * v2,
    m * grav.z + aero.z - m * pose.ddCg.z * v2,
    Ip * pose.ddTheta * v2 - (spinR * pose.rear.K + spinF * pose.front.K) * v2,
  ];
  const [a, Nr, Nf, Tr, Tf] = solveLinear(A, b) as [number, number, number, number, number];

  const pAxle =
    mu(R) * R.axleRadius * Nr * Math.abs(omegaR - pitchCw) + mu(F) * F.axleRadius * Nf * Math.abs(omegaF - pitchCw);
  const pRolling = crr(R) * R.r * Nr * Math.abs(omegaR) + crr(F) * F.r * Nf * Math.abs(omegaF);
  const pAero = -dot(aero, vCg);

  return { a, Nr, Nf, Tr, Tf, pAxle, pRolling, pAero, omegaR, omegaF, vCg };
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
