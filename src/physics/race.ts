// Authoritative race simulation (controlling spec 11; PHY-005, PHY-009, ANA-001, TIM-001, MODE-004).

import { type Provenance, weakest } from "../core/provenance.js";
import { type Vec2, dot, norm, sub } from "../core/vec2.js";
import { type Track, finishS, type ProfileStatus } from "../track/track.js";
import { type CarSpec, type Environment, carModel, inputProvenance } from "./car.js";
import { ALL_LOSSES, type LossSwitches, dynamics } from "./dynamics.js";
import { CarKinematics, type Pose } from "./kinematics.js";
import {
  type LateralModel,
  type LateralState,
  type LateralStep,
  type PlanarForce,
  type RailContact,
  SQUARE_AXLES,
  type WheelAxles,
  cgFromRear,
  lateralKinetic,
  lateralStep,
  railGap,
  rearOffset,
  restingAxles,
} from "./lateral.js";

export const SOLVER_VERSION = "phy-009/0.5.0";

export interface RaceOptions {
  /** Fixed RK4 step, s. Convergence is demonstrated by step halving (PHY-005). */
  readonly dt?: number;
  readonly maxTime?: number;
  /** Keep every n-th step in the trace. */
  readonly traceEvery?: number;
  readonly losses?: LossSwitches;
}

export type RaceStatus = "FINISHED" | "STALLED" | "OUTSIDE_MODEL_VALIDITY";

export interface TraceSample {
  readonly t: number;
  readonly s: number;
  readonly v: number;
  readonly speedCg: number;
  readonly theta: number;
  readonly cg: Vec2;
  readonly nose: Vec2;
  /** Rear-axle arc acceleration, m/s^2. */
  readonly a: number;
  readonly Nr: number;
  readonly Nf: number;
  readonly Tr: number;
  readonly Tf: number;
  /** Axle-bore contact force magnitudes, N. */
  readonly boreR: number;
  readonly boreF: number;
  /** False if the friction model had no consistent solution at this instant. */
  readonly frictionConsistent: boolean;
  /** Energy-ledger residual at this instant, J (ANA-001). */
  readonly residual: number;
  /** Lateral model only: rear-axle offset from the lane centre (m), yaw (rad), rail contacts, tread states. */
  readonly lateral?: { readonly offset: number; readonly yaw: number; readonly contacts: readonly RailContact[]; readonly slip: readonly [number, number] };
}

export interface EnergyLedger {
  /** Potential energy released since the start, J. */
  readonly released: number;
  /** Translational plus pitch kinetic energy of the car, J. */
  readonly kineticBody: number;
  /** Spin kinetic energy of the wheels, J. */
  readonly kineticWheels: number;
  readonly axleLoss: number;
  /** Wheels' hubs rubbing the axle heads or the body under axial load (zero without the lateral model). */
  readonly thrustLoss: number;
  readonly rollingLoss: number;
  readonly aeroLoss: number;
  /** Lateral model (P6, P7); all zero when it is not running. Sideways and yaw kinetic energy. */
  readonly kineticLateral: number;
  /** Treads sliding sideways. */
  readonly treadLoss: number;
  /** Wheel faces sliding on the guide rail. */
  readonly railFrictionLoss: number;
  /** Wheel faces striking the guide rail (restitution below 1). */
  readonly railImpactLoss: number;
  /** released - (kinetic + losses): numerical error, J (should be ~0). */
  readonly residual: number;
}

export interface RaceResult {
  readonly status: RaceStatus;
  readonly message: string;
  /** Elapsed time from gate release to the nose crossing the finish plane, s. */
  readonly elapsedTime: number | null;
  readonly finishSpeed: number | null;
  readonly maxSpeed: number;
  readonly ledger: EnergyLedger;
  /**
   * Wheel hops at guide-rail impacts (P7). Friction where a wheel face strikes the rail's top edge
   * can momentarily exceed that axle's load. The planar model keeps the wheel on the track through
   * the impact step; the hop it would make is estimated and reported here, never hidden.
   */
  readonly hops: { readonly count: number; readonly maxHeight: number; readonly maxAirtime: number };
  readonly trace: readonly TraceSample[];
  readonly record: {
    readonly solverVersion: string;
    readonly dt: number;
    readonly losses: LossSwitches;
    /** True when lateral dynamics and guide-rail contact were simulated (P6, P7). */
    readonly lateral: boolean;
    readonly car: string;
    readonly track: string;
    readonly trackProfile: ProfileStatus;
    readonly inputProvenance: Record<string, Provenance>;
    /** Least certain input behind this result. */
    readonly weakestInput: Provenance;
  };
}

/**
 * y = [s, v, E_axle, E_rolling, E_aero, W_tread, W_rail, E_thrust]: W = work of the lateral model's
 * forces on the planar motion.
 */
type State = readonly [number, number, number, number, number, number, number, number];

export function simulateRace(spec: CarSpec, track: Track, env: Environment, opts: RaceOptions = {}): RaceResult {
  const dt = opts.dt ?? 1e-4;
  const maxTime = opts.maxTime ?? 20;
  const traceEvery = opts.traceEvery ?? 50;
  const losses = opts.losses ?? ALL_LOSSES;
  const car = carModel(spec);
  const denv = { g: env.gravity.value, rho: env.airDensity.value, losses };

  const rearPath = track.surface.offset(car.rear.r);
  const frontPath = car.front.r === car.rear.r ? rearPath : track.surface.offset(car.front.r);
  const kin = new CarKinematics(car, rearPath, frontPath);

  // Lateral model (P6, P7): runs when the car describes its lateral properties and the lane its rail.
  const L: LateralModel | null =
    spec.lateral && track.lateral
      ? {
          m: car.mass,
          Iz: spec.lateral.yawInertia.value,
          xc: car.cg.x,
          yc: spec.lateral.cgOffset.value,
          wheelbase: car.wheelbase,
          spacing: spec.lateral.insideWheelSpacing.value,
          railWidth: track.lateral.guideRail.width.value,
          railHeight: track.lateral.guideRail.height.value,
          toe: [spec.lateral.toe.rear.value, spec.lateral.toe.front.value],
          camber: [spec.lateral.camber?.rear.value ?? 0, spec.lateral.camber?.front.value ?? 0],
          treadWidth: spec.lateral.camber?.treadWidth.value ?? 0,
          radius: [car.rear.r, car.front.r],
          wheelMass: [car.rear.wheelMass, car.front.wheelMass],
          muT: spec.lateral.treadFriction.value,
          muC: spec.lateral.railFriction.value,
          e: spec.lateral.railRestitution.value,
          gLat: denv.g * Math.sin(track.lateral.crossSlope.value),
        }
      : null;
  // Forces from the lateral model on the planar motion, and the wheels' axles, held over the current step.
  let ext: readonly PlanarForce[] = [];
  let axles: WheelAxles = SQUARE_AXLES;

  let frontGuess: number | undefined;
  const poseAt = (s: number): Pose => {
    const p = kin.pose(s, frontGuess);
    frontGuess = p.front.s;
    return p;
  };

  // Gate: nose on the pin plane (through the pin's surface point, normal to the lane).
  const pin = track.surface.at(track.pinS);
  const pinGap = (s: number): number => dot(sub(kin.pose(s).nose, pin.p), pin.t);
  const sPinCentre = rearPath.fromSurface(track.pinS);
  const s0 = bisect(pinGap, sPinCentre - car.wheelbase - norm(car.nose) - 1, sPinCentre + 1);

  // Finish: nose crosses the sensor plane (TIM-001).
  const fin = track.surface.at(finishS(track));
  const finishGap = (pose: Pose): number => dot(sub(pose.nose, fin.p), fin.t);

  const deriv = (y: State): State => {
    const pose = poseAt(y[0]);
    const d = dynamics(car, pose, y[1], denv, ext, axles);
    return [y[1], d.a, d.pAxle, d.pRolling, d.pAero, d.pTread, d.pRail, d.pThrust];
  };
  const rk4 = (y: State, h: number): State => {
    const k1 = deriv(y);
    const k2 = deriv(axpy(y, k1, h / 2));
    const k3 = deriv(axpy(y, k2, h / 2));
    const k4 = deriv(axpy(y, k3, h));
    return y.map((yi, i) => yi + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)) as unknown as State;
  };

  const pose0 = poseAt(s0);
  const pe0 = car.mass * denv.g * pose0.cg.z;

  // Lateral state, and the work the lateral forces have done on the lateral motion, J.
  const start = spec.lateral?.start;
  const psi0 = start?.heading.value ?? 0;
  let lat: LateralState = { Y: L ? cgFromRear(L, start?.offset.value ?? 0, psi0) : 0, psi: psi0, dY: 0, dPsi: 0 };
  const Y0 = lat.Y;
  if (L) axles = restingAxles(L, lat);
  const latWork = { gravity: 0, tread: 0, railNormal: 0, railFriction: 0 };
  let latInfo: { contacts: readonly RailContact[]; slip: readonly [number, number] } = { contacts: [], slip: [0, 0] };
  /** True while the forces in `ext` come from a step that carried a rail impact. */
  let impactStep = false;
  let lastH = dt;
  const hops = { count: 0, maxHeight: 0, maxAirtime: 0 };

  const ledgerAt = (y: State): EnergyLedger => {
    const pose = poseAt(y[0]);
    const d = dynamics(car, pose, y[1], denv, ext, axles);
    const releasedLat = L ? -car.mass * L.gLat * (lat.Y - Y0) : 0;
    const released = pe0 - car.mass * denv.g * pose.cg.z + releasedLat;
    const pitchRate = pose.dTheta * y[1];
    const kineticBody = 0.5 * car.mass * dot(d.vCg, d.vCg) + 0.5 * car.pitchInertia * pitchRate * pitchRate;
    const kineticWheels =
      0.5 * car.rear.spinInertia * d.omegaR * d.omegaR + 0.5 * car.front.spinInertia * d.omegaF * d.omegaF;
    const kineticLateral = L ? lateralKinetic(L, lat) : 0;
    // Each lateral mechanism's loss is minus the work its forces did on both motions.
    const treadLoss = -(latWork.tread + y[5]);
    const railFrictionLoss = -(latWork.railFriction + y[6]);
    const railImpactLoss = -latWork.railNormal;
    const residual =
      released -
      (kineticBody + kineticWheels + kineticLateral + y[2] + y[7] + y[3] + y[4] + treadLoss + railFrictionLoss + railImpactLoss);
    return {
      released,
      kineticBody,
      kineticWheels,
      axleLoss: y[2],
      thrustLoss: y[7],
      rollingLoss: y[3],
      aeroLoss: y[4],
      kineticLateral,
      treadLoss,
      railFrictionLoss,
      railImpactLoss,
      residual,
    };
  };

  const trace: TraceSample[] = [];
  const sample = (t: number, y: State): TraceSample => {
    const pose = poseAt(y[0]);
    const d = dynamics(car, pose, y[1], denv, ext, axles);
    return {
      t,
      s: y[0],
      v: y[1],
      speedCg: norm(d.vCg),
      theta: pose.theta,
      cg: pose.cg,
      nose: pose.nose,
      a: d.a,
      Nr: d.Nr,
      Nf: d.Nf,
      Tr: d.Tr,
      Tf: d.Tf,
      boreR: d.boreR,
      boreF: d.boreF,
      frictionConsistent: d.converged,
      residual: ledgerAt(y).residual,
      ...(L ? { lateral: { offset: rearOffset(L, lat), yaw: lat.psi, contacts: latInfo.contacts, slip: latInfo.slip } } : {}),
    };
  };

  const provenance = inputProvenance(spec, env);
  const record = {
    solverVersion: SOLVER_VERSION,
    dt,
    losses,
    lateral: L !== null,
    car: spec.name,
    track: track.name,
    trackProfile: track.profileStatus,
    inputProvenance: provenance,
    weakestInput: weakest(Object.values(provenance)),
  };
  const finish = (
    status: RaceStatus,
    message: string,
    y: State,
    elapsed: number | null,
    maxSpeed: number,
  ): RaceResult => ({
    status,
    message,
    elapsedTime: elapsed,
    finishSpeed: status === "FINISHED" ? norm(dynamics(car, poseAt(y[0]), y[1], denv, ext, axles).vCg) : null,
    maxSpeed,
    ledger: ledgerAt(y),
    hops,
    trace,
    record,
  });

  // Rear-axle positions at which either axle reaches a join in its path. Curvature jumps there, so
  // a step is cut to end about JOIN_GAP short of each join: every RK4 stage of that step sees the
  // old piece. A micro-step to JOIN_GAP past the join then carries the car across, confining the
  // error from mixing pieces to a nanometre-scale step; normal steps resume on the new piece.
  const JOIN_GAP = 1e-9;
  let crossTarget: number | null = null;
  const breaks = [
    ...rearPath.joins(),
    ...frontPath.joins().map((b) => bisect((s) => kin.frontS(s) - b, b - 3 * car.wheelbase, b)),
  ]
    .filter((b) => b > s0)
    .sort((p, q) => p - q);
  let nextBreak = 0;

  let y: State = [s0, 0, 0, 0, 0, 0, 0, 0];
  let t = 0;
  let maxSpeed = 0;
  /**
   * One step of length h from y: the lateral model on this instant's loads, then RK4 for the planar
   * motion with the lateral forces held over the step. The lateral step is solved twice: first on
   * an Euler estimate of the end speed, then on the speed RK4 actually reaches, so a sticking tread
   * ends each step exactly on its rolling constraint. commitLateral() accepts the step.
   */
  let pendingLat: LateralStep | null = null;
  const advance = (y: State, h: number): State => {
    if (!L) return rk4(y, h);
    const pose = poseAt(y[0]);
    const d0 = dynamics(car, pose, y[1], denv, ext, axles);
    const held = ext;
    const heldAxles = axles;
    const v0: [number, number] = [pose.rear.J * y[1], pose.front.J * y[1]];
    let v1: [number, number] = [pose.rear.J * (y[1] + h * d0.a), pose.front.J * (y[1] + h * d0.a)];
    let out: State = y;
    for (let pass = 0; pass < 2; pass++) {
      pendingLat = lateralStep(L, lat, { h, v0, v1, N: [d0.Nr, d0.Nf], closed: latInfo.contacts });
      ext = pendingLat.forces;
      axles = pendingLat.wheels;
      out = rk4(y, h);
      const end = poseAt(out[0]);
      v1 = [end.rear.J * out[1], end.front.J * out[1]];
    }
    ext = held;
    axles = heldAxles;
    return out;
  };
  const commitLateral = (): boolean => {
    if (!L || !pendingLat) return true;
    const st: LateralStep = pendingLat;
    lat = st.next;
    ext = st.forces;
    axles = st.wheels;
    latWork.gravity += st.work.gravity;
    latWork.tread += st.work.tread;
    latWork.railNormal += st.work.railNormal;
    latWork.railFriction += st.work.railFriction;
    latInfo = { contacts: st.contacts, slip: st.slip };
    impactStep = st.work.railNormal < 0;
    pendingLat = null;
    return st.consistent;
  };

  // Rail arrival within the next h, from the lateral state's own velocity: the earliest time an open
  // wheel-face gap closes, or null. A gap already within a millionth of a step of closing is left to
  // the step itself.
  const IMPACT_STEP = 1e-3;
  let impactNext = false;
  const railArrival = (h: number): number | null => {
    if (!L) return null;
    let best: number | null = null;
    for (const axle of [0, 1] as const)
      for (const side of [1, -1] as const) {
        const g0 = railGap(L, lat.Y, lat.psi, axle, side);
        if (g0 <= 0) continue;
        const g1 = railGap(L, lat.Y + h * lat.dY, lat.psi + h * lat.dPsi, axle, side);
        if (g1 >= 0) continue;
        const tau = (h * g0) / (g0 - g1);
        if (tau > 1e-6 * h && (best === null || tau < best)) best = tau;
      }
    return best;
  };

  const first = dynamics(car, pose0, 0, denv, [], axles);
  if (!first.converged || !(first.a > 0)) {
    return finish("STALLED", "Car does not start: friction holds it at the gate.", y, null, 0);
  }

  for (let step = 0; t < maxTime; step++) {
    const s = sample(t, y);
    if (step % traceEvery === 0) trace.push(s);
    maxSpeed = Math.max(maxSpeed, s.speedCg);
    if (!s.frictionConsistent) {
      trace.push(s);
      return finish(
        "OUTSIDE_MODEL_VALIDITY",
        `Axle friction has no consistent sliding solution at t=${t.toFixed(4)} s (friction arm too large).`,
        y,
        null,
        maxSpeed,
      );
    }
    if ((s.Nr <= 0 || s.Nf <= 0) && impactStep) {
      // Impulsive lift at a rail impact: the negative load over the step is an upward impulse J at
      // that axle. With the other axle on the track the car pivots about it, so the wheel leaves at
      // J / m_eff, m_eff = I_pivot / WB^2, and gravity's moment about the pivot brings it back.
      const pose = poseAt(y[0]);
      for (const [N, pivot, other] of [
        [s.Nr, pose.front, pose.rear],
        [s.Nf, pose.rear, pose.front],
      ] as const) {
        if (N > 0) continue;
        const lever = sub(other.contact, pivot.contact);
        const arm = sub(pose.cg, pivot.contact);
        const Ipivot = car.pitchInertia + car.mass * dot(arm, arm);
        const J = -N * lastH;
        const vHop = (J * dot(lever, lever)) / Ipivot;
        const gravMoment = car.mass * denv.g * Math.abs(arm.x);
        const aBack = (gravMoment * norm(lever)) / Ipivot;
        hops.count++;
        hops.maxHeight = Math.max(hops.maxHeight, (vHop * vHop) / (2 * aBack));
        hops.maxAirtime = Math.max(hops.maxAirtime, (2 * vHop) / aBack);
      }
    } else if (s.Nr <= 0 || s.Nf <= 0) {
      trace.push(s);
      const which = s.Nf <= 0 ? "front" : "rear";
      return finish(
        "OUTSIDE_MODEL_VALIDITY",
        `${which} wheels lift off the track at t=${t.toFixed(4)} s (model assumes all wheels in contact).`,
        y,
        null,
        maxSpeed,
      );
    }

    const ordinary = crossTarget === null && !impactNext;
    let h = crossTarget !== null ? (crossTarget - y[0]) / y[1] : impactNext ? IMPACT_STEP * dt : dt;
    impactNext = false;
    let yNext = advance(y, h);
    if (crossTarget !== null) {
      crossTarget = null;
    } else {
      while (nextBreak < breaks.length && breaks[nextBreak]! - JOIN_GAP <= y[0]) nextBreak++;
      const brk = breaks[nextBreak];
      if (brk !== undefined && yNext[0] > brk - JOIN_GAP) {
        const yFull = yNext;
        const target = brk - JOIN_GAP;
        h = bisect((x) => hermite(y[0], y[1], yFull[0], yFull[1], dt, x) - target, 0, dt);
        // The interpolant can miss by nanometres at large dt; Newton-correct on the actual RK4 landing.
        for (let i = 0; i < 8; i++) {
          yNext = advance(y, h);
          const miss = yNext[0] - target;
          if (Math.abs(miss) < 1e-13) break;
          h -= miss / yNext[1];
        }
        nextBreak++;
        crossTarget = brk + JOIN_GAP;
      }
    }
    // A wheel face reaching the rail inside an ordinary step: end the step where it arrives, so the
    // impact is resolved at its own time, in a short step of its own.
    if (L && ordinary && crossTarget === null) {
      const tau = railArrival(h);
      if (tau !== null) {
        h = tau;
        yNext = advance(y, h);
        impactNext = true;
      }
    }
    if (finishGap(poseAt(yNext[0])) >= 0) {
      // Locate the crossing inside the step with cubic Hermite s(t), then take an exact RK4 sub-step.
      const yEnd = yNext;
      const tau = bisect((x) => finishGap(poseAt(hermite(y[0], y[1], yEnd[0], yEnd[1], h, x))), 0, h);
      const yFin = advance(y, tau);
      commitLateral();
      trace.push(sample(t + tau, yFin));
      return finish("FINISHED", "Finished.", yFin, t + tau, Math.max(maxSpeed, trace[trace.length - 1]!.speedCg));
    }
    if (!commitLateral()) {
      trace.push(sample(t + h, yNext));
      return finish(
        "OUTSIDE_MODEL_VALIDITY",
        `Tread and guide-rail contact had no consistent solution at t=${(t + h).toFixed(4)} s.`,
        yNext,
        null,
        maxSpeed,
      );
    }
    if (!(yNext[1] > 0)) {
      trace.push(sample(t + h, yNext));
      return finish("STALLED", `Car stopped at s=${yNext[0].toFixed(3)} m before the finish.`, yNext, null, maxSpeed);
    }
    y = yNext;
    t += h;
    lastH = h;
  }
  return finish("STALLED", `No finish within ${maxTime} s.`, y, null, maxSpeed);
}

function axpy(y: State, k: readonly number[], h: number): State {
  return y.map((yi, i) => yi + h * k[i]!) as unknown as State;
}

/** Cubic Hermite position at time h in [0, dt] from end positions and speeds. */
function hermite(s0: number, v0: number, s1: number, v1: number, dt: number, h: number): number {
  const u = h / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * s0 + (u3 - 2 * u2 + u) * dt * v0 + (-2 * u3 + 3 * u2) * s1 + (u3 - u2) * dt * v1;
}

/** Root of an increasing function on [lo, hi]. */
function bisect(f: (x: number) => number, lo: number, hi: number): number {
  if (f(lo) > 0 || f(hi) < 0) throw new Error("Root not bracketed");
  for (let i = 0; i < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo)); i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
