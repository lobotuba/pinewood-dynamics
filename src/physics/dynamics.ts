// Instantaneous dynamics of the rigid car on the lane (PHY-009; derivation in docs/physics-model.md, 3).
//
// Unknowns: u = [a, N_r, N_f, T_r, T_f]
//   a    = d^2 s / dt^2 (rear-axle arc acceleration)
//   N_i  = normal contact force on axle i's wheels (both wheels together)
//   T_i  = tangential contact force on axle i's wheels, along the direction of travel
// Equations:
//   2 wheel-spin equations, 2 whole-car force equations, 1 whole-car moment equation about the CG.
// All are linear in u except the axle friction torques. Each wheel's axle force R_w follows from its
// own Newton equation and is linear in u: each wheel takes half its pair's load and inertia (roll is
// not modelled), less the external forces on that wheel, plus the sideways part the lateral model
// gives. The bore carries R_w's part across the axle, with friction mu * rho * |R_rad| = mu rho e . R_w,
// e its direction; a thrust face carries the part along it, A = R_w . axis, with friction
// mu_f r_f |A| = mu_f r_f sign(A) A, at the body face when the axle pushes the wheel outward and at
// the head when inward. Directions and signs are found by fixed-point iteration. When friction
// depends on load (AxleModel.frictionExponent), the bore coefficient is updated from |R_rad| in the
// same loop. Hub drag is a fixed torque and enters the wheel equations directly.
//
// With square axles and nothing sideways, each wheel's load is exactly half its pair's and the
// solution is the pair's, bit for bit.
//
// External forces (from the lateral model: tread scrub, guide-rail contact) are given for the
// instant. A force on a wheel enters its spin equation and its wheel's axle load; a force on the body
// does not. Both enter the whole-car force and moment balance.

import { type Vec2, add, cross, dot, norm, scale, sub } from "../core/vec2.js";
import type { AxleModel, CarModel } from "./car.js";
import type { AxleState, Pose } from "./kinematics.js";
import { type PlanarForce, SQUARE_AXLES, type WheelAxles } from "./lateral.js";

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
  /** Axle-bore contact force on each axle's wheels, the two wheels' magnitudes summed, N. */
  readonly boreR: number;
  readonly boreF: number;
  /** Dissipated power by mechanism, W (ANA-001). pAxle includes hub drag; pThrust is the thrust faces. */
  readonly pAxle: number;
  readonly pThrust: number;
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

/** A vector at one wheel: x and z in the track's vertical plane, y sideways (left). */
interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
const dot3 = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm3 = (a: V3): number => Math.hypot(a.x, a.y, a.z);

/** One wheel's axle force, R = da a - n N - t T + r0, and its outward axle direction. */
interface WheelForce {
  readonly da: V3;
  readonly n: V3;
  readonly t: V3;
  readonly r0: V3;
  readonly axis: V3;
}

// Direction alone converges in a few steps. A load-dependent coefficient converges geometrically with
// ratio |1 - exponent|: 2/3 needs about 20 steps to reach 1e-10.
const MAX_BORE_ITERATIONS = 60;

export function dynamics(
  car: CarModel,
  pose: Pose,
  v: number,
  env: DynamicsEnv,
  ext: readonly PlanarForce[] = [],
  wheels: WheelAxles = SQUARE_AXLES,
): Dynamics {
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

  // Bore friction coefficient at one wheel's bore load. Load is floored so mu stays finite as it -> 0.
  const mu = (ax: AxleModel, load: number): number => {
    if (!L.axleFriction) return 0;
    if (ax.frictionExponent === 1) return ax.mu;
    const perWheel = Math.max(load, 1e-6 * ax.frictionReferenceLoad);
    return ax.mu * (perWheel / ax.frictionReferenceLoad) ** (ax.frictionExponent - 1);
  };
  const thrustOf = (ax: AxleModel) => (L.axleFriction ? ax.thrust : null);
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
  const bR = bore(pose.rear, R.wheelMass);
  const bF = bore(pose.front, F.wheelMass);

  // External forces: position and vector in the plane; on a wheel, its forward-roll torque about the
  // axle (given, or z F_t - xi F_n in the plane) and its share of that wheel's Newton equation.
  const extRows = { spin: [0, 0], fx: 0, fz: 0, moment: 0 };
  const extPts: { P: Vec2; F: Vec2; y: number; f: PlanarForce }[] = [];
  for (const f of ext) {
    const ax = f.axle === 0 ? pose.rear : pose.front;
    const { t, n } = ax.pt;
    const P = add(ax.pt.p, add(scale(t, f.at.t), scale(n, f.at.n)));
    const Fv = add(scale(t, f.f.t), scale(n, f.f.n));
    extRows.fx += Fv.x;
    extRows.fz += Fv.z;
    extRows.moment -= cross(sub(P, pose.cg), Fv);
    if (f.onWheel) extRows.spin[f.axle] = extRows.spin[f.axle]! + (f.spin ?? f.at.n * f.f.t - f.at.t * f.f.n);
    extPts.push({ P, F: Fv, y: f.y ?? 0, f });
  }

  // Each wheel's axle force: half its pair's (both wheels share the axle's load and inertia; roll is
  // not modelled), less the external forces on that wheel, with the sideways load the lateral model
  // gives. Index k = 2 * axle + wheel, wheel 0 left, 1 right.
  const wheelForce = (i: 0 | 1, w: 0 | 1, bf: BoreForce): WheelForce => {
    const side = w === 0 ? 1 : -1;
    let ex = 0;
    let ey = 0;
    let ez = 0;
    for (const e of extPts) {
      if (!e.f.onWheel || e.f.axle !== i) continue;
      const on = e.f.side ?? 0;
      const share = on === 0 ? 0.5 : on === side ? 1 : 0;
      ex += share * e.F.x;
      ey += share * e.y;
      ez += share * e.F.z;
    }
    const { t, n } = (i === 0 ? pose.rear : pose.front).pt;
    const a = wheels[i][w].axis;
    return {
      da: { x: 0.5 * bf.da.x, y: 0, z: 0.5 * bf.da.z },
      n: { x: 0.5 * bf.n.x, y: 0, z: 0.5 * bf.n.z },
      t: { x: 0.5 * bf.t.x, y: 0, z: 0.5 * bf.t.z },
      r0: { x: 0.5 * bf.r0.x - ex, y: wheels[i][w].sideways - ey, z: 0.5 * bf.r0.z - ez },
      axis: { x: a.t * t.x + a.n * n.x, y: a.y, z: a.t * t.z + a.n * n.z },
    };
  };
  const WF = [wheelForce(0, 0, bR), wheelForce(0, 1, bR), wheelForce(1, 0, bF), wheelForce(1, 1, bF)];
  const axleOf = (k: number): AxleModel => (k < 2 ? R : F);
  const wheelAt = (k: number, u: readonly number[]): V3 => {
    const wf = WF[k]!;
    const N = k < 2 ? u[1]! : u[2]!;
    const T = k < 2 ? u[3]! : u[4]!;
    const a = u[0]!;
    return {
      x: wf.da.x * a + wf.r0.x + (wf.n.x * -N + wf.t.x * -T),
      y: wf.da.y * a + wf.r0.y + (wf.n.y * -N + wf.t.y * -T),
      z: wf.da.z * a + wf.r0.z + (wf.n.z * -N + wf.t.z * -T),
    };
  };
  const radial = (Rw: V3, ax: V3): V3 => {
    const k = dot3(Rw, ax);
    return { x: Rw.x - k * ax.x, y: Rw.y - k * ax.y, z: Rw.z - k * ax.z };
  };

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

  // Friction torques linearized in each wheel row: the bore's f (e . R_w(u)) and the thrust face's
  // f_th (sign . axis . R_w(u)), columns a, N_i, T_i. Each f is the torque per newton, signed to
  // oppose rotation relative to the body.
  const withFriction = (e: readonly V3[], mus: readonly number[], sig: readonly number[]): number[] => {
    const M = A.map((row) => [...row]);
    const rhs = [...b];
    for (const i of [0, 1] as const) {
      const ax = i === 0 ? R : F;
      const s = i === 0 ? sR : sF;
      const th = thrustOf(ax);
      let cA = 0;
      let cN = 0;
      let cT = 0;
      let c0 = 0;
      for (const w of [0, 1]) {
        const k = 2 * i + w;
        const wf = WF[k]!;
        const terms: [number, V3][] = [[s * mus[k]! * ax.axleRadius, e[k]!]];
        if (th && sig[k] !== 0) {
          const face = sig[k]! > 0 ? th.body : th.head;
          terms.push([s * face.mu * face.r * sig[k]!, wf.axis]);
        }
        for (const [f, c] of terms) {
          cA += f * dot3(c, wf.da);
          cN += f * dot3(c, wf.n);
          cT += f * dot3(c, wf.t);
          c0 += f * dot3(c, wf.r0);
        }
      }
      const r = M[i]!;
      r[0] = r[0]! + cA;
      r[1 + i] = r[1 + i]! - cN;
      r[3 + i] = r[3 + i]! - cT;
      rhs[i] = rhs[i]! - c0;
    }
    return solveLinear(M, rhs);
  };

  // Start from the static direction (axle pushes its wheels down into the track), the reference
  // coefficient, and no thrust.
  const down = (n: Vec2): V3 => ({ x: n.x * -1, y: 0, z: n.z * -1 });
  const e: V3[] = [down(nR), down(nR), down(nF), down(nF)];
  const mus = [0, 1, 2, 3].map((k) => mu(axleOf(k), axleOf(k).frictionReferenceLoad));
  const sig = [0, 0, 0, 0];
  const flips = [0, 0, 0, 0];
  const settled = [false, false, false, false];
  let u = withFriction(e, mus, sig);
  let converged = true;
  if (mus.some((x) => x !== 0) || thrustOf(R) || thrustOf(F)) {
    let lastChange = Infinity;
    for (let it = 0; ; it++) {
      let change = 0;
      for (let k = 0; k < 4; k++) {
        const Rw = wheelAt(k, u);
        const rad = radial(Rw, WF[k]!.axis);
        const nextE = unitOr3(rad, e[k]!);
        const nextMu = mu(axleOf(k), norm3(rad));
        change = Math.max(change, norm3({ x: nextE.x - e[k]!.x, y: nextE.y - e[k]!.y, z: nextE.z - e[k]!.z }), relChange(nextMu, mus[k]!));
        e[k] = nextE;
        mus[k] = nextMu;
        if (thrustOf(axleOf(k)) && !settled[k]) {
          const next = Math.sign(dot3(Rw, WF[k]!.axis));
          if (next !== sig[k]) {
            // An axial load that reverses with each iteration is zero at the solution: the wheel sits
            // between its faces (Coulomb's set-valued law), and neither face carries friction.
            if (sig[k] !== 0 && next === -sig[k]! && ++flips[k]! >= 2) {
              settled[k] = true;
              sig[k] = 0;
            } else sig[k] = next;
            change = Infinity;
          }
        }
      }
      // |R| - e.R is second order in the direction error, so 1e-10 leaves ~1e-20 relative error. Under
      // the impulsive loads of a rail strike, rounding in R can hold the change above that; once it
      // stops shrinking it is at rounding, and below 1e-7 the error left is under 1e-14.
      if (change < 1e-10 || (change < 1e-7 && change >= lastChange)) break;
      lastChange = change;
      if (it >= MAX_BORE_ITERATIONS || !u.every(Number.isFinite)) {
        converged = false;
        break;
      }
      u = withFriction(e, mus, sig);
    }
  }
  const [a, Nr, Nf, Tr, Tf] = u as [number, number, number, number, number];

  // Per-wheel loads at the solution: bore torque mu rho |R_rad|, thrust torque mu_f r_f |A|.
  const bores = [0, 0];
  const boreTorque = [0, 0];
  const thrustTorque = [0, 0];
  for (let k = 0; k < 4; k++) {
    const i = k < 2 ? 0 : 1;
    const ax = axleOf(k);
    const Rw = wheelAt(k, u);
    const load = norm3(radial(Rw, WF[k]!.axis));
    bores[i] = bores[i]! + load;
    boreTorque[i] = boreTorque[i]! + mu(ax, load) * ax.axleRadius * load;
    const th = thrustOf(ax);
    if (th && sig[k] !== 0) {
      const face = sig[k]! > 0 ? th.body : th.head;
      thrustTorque[i] = thrustTorque[i]! + face.mu * face.r * sig[k]! * dot3(Rw, WF[k]!.axis);
    }
  }
  const boreR = bores[0]!;
  const boreF = bores[1]!;

  const slipR = Math.abs(omegaR - pitchCw);
  const slipF = Math.abs(omegaF - pitchCw);
  const pAxle = (boreTorque[0]! + hubR) * slipR + (boreTorque[1]! + hubF) * slipF;
  const pThrust = thrustTorque[0]! * slipR + thrustTorque[1]! * slipF;
  const pRolling = crr(R) * R.r * Nr * Math.abs(omegaR) + crr(F) * F.r * Nf * Math.abs(omegaF);
  const pAero = -dot(aero, vCg);

  // Power of each external force at its material point: a wheel point moves with the axle centre plus
  // the wheel's rotation; a body point with the CG plus the pitch rotation. A wheel's rotation is its
  // spin relative to the body, about the axle, plus the body's pitch: so a given axle torque works at
  // the relative spin, and the force's in-plane moment about the axle centre at the pitch rate.
  let pTread = 0;
  let pRail = 0;
  const pitchCcw = pose.dTheta * v;
  for (const x of extPts) {
    let pw: number;
    if (x.f.onWheel) {
      const ax = x.f.axle === 0 ? pose.rear : pose.front;
      const w = x.f.axle === 0 ? omegaR : omegaF;
      if (x.f.spin !== undefined) {
        const inPlane = x.f.at.n * x.f.f.t - x.f.at.t * x.f.f.n;
        pw = dot(x.F, scale(ax.pt.t, ax.J * v)) + (w - pitchCw) * x.f.spin + pitchCw * inPlane;
      } else {
        const at = x.f.at;
        pw = dot(x.F, add(scale(ax.pt.t, ax.J * v), scale(add(scale(ax.pt.t, at.n), scale(ax.pt.n, -at.t)), w)));
      }
    } else {
      const rho = sub(x.P, pose.cg);
      pw = dot(x.F, add(vCg, { x: -pitchCcw * rho.z, z: pitchCcw * rho.x }));
    }
    if (x.f.kind === "tread") pTread += pw;
    else pRail += pw;
  }

  return { a, Nr, Nf, Tr, Tf, boreR, boreF, pAxle, pThrust, pTread, pRail, pRolling, pAero, omegaR, omegaF, vCg, converged };
}

const relChange = (next: number, prev: number): number => (prev === 0 ? Math.abs(next) : Math.abs(next - prev) / prev);

function unitOr3(x: V3, fallback: V3): V3 {
  const l = norm3(x);
  if (!(l > 0)) return fallback;
  const k = 1 / l;
  return { x: x.x * k, y: x.y * k, z: x.z * k };
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
