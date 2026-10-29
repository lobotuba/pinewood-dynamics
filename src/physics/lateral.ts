// Lateral dynamics and guide-rail contact (spec 11.5 gates P6, P7; derivation in
// docs/physics-model.md, section 11).
//
// The lane is a cylinder: its profile in the vertical plane swept straight across. Laid flat, the
// lane is a plane strip with arc length u along it and y across it, y = 0 on the lane centreline
// and the guide rail occupying |y| <= w/2. The car's lateral motion is two degrees of freedom in that
// plane: Y, the CG's lateral position, and psi, the yaw of body +X from the lane direction (positive
// toward +y, the car's left). Mass matrix diag(m, I_z) is constant, so the discrete energy balance
// below is exact.
//
// Forces:
//   tread  Coulomb friction at each axle's tread contacts, perpendicular to the wheel plane
//          (heading psi + toe delta_i). Stick means rolling without sideways slip. With creep, a
//          rolling tread below the limit creeps sideways at a velocity proportional to its force
//          (Kalker's linear creep): F = -mu_t N u / (nu_s v), reaching the limit at creepage nu_s.
//          In the step that is a compliance nu_s v / (mu_t N h) on the sticking tread's row.
//   rail   a wheel's inner face meets the rail: normal impulse with Newton restitution e, and
//          Coulomb friction mu_c opposing the face's slide over it. Square wheels touch the rail's
//          top edge at height h, where the face moves at v sqrt(2h/r); friction there brakes the
//          wheel's spin and, being off the CG's line, yaws the car toward that side. Camber tilts the
//          face: tops out brings its lowest rim onto the rail's side face, close to the line the wheel
//          rolls about, where it slides slowly; tops in keeps the contact on the top edge.
//   gravity across the lane when it has a cross slope.
//
// Each wheel's axial load (tread and rail forces, and with camber its share of the axle load) is
// carried by a thrust face, the axle head or the body; dynamics.ts adds that friction to the spin.
// With axial play the wheels slide along their axles between those faces; play.ts steps that model.
//
// Roll is not a degree of freedom: the car stays on its four wheels, and the lane loads balance the
// roll moment of the side loads (rollLoads below). A wheel whose load that leaves negative has lifted.
//
// Time stepping is Moreau's (velocity-level impulses, positions by the midpoint of the start and
// end velocities). Each step enumerates the stick/slip state of both treads and the open/closed
// state of the rail contacts near closing, and takes the first consistent combination: Coulomb's
// law and the impact law hold exactly, with no regularisation.
//
// The longitudinal motion stays with the planar solver. The lateral model treats every body point
// as moving along the lane at its axle's path speed, so the yaw-induced along-lane velocity
// (x psi psi') is left out of the planar kinetic energy; with psi bounded by the rail gap over the
// wheelbase (about 0.04 rad) that is a relative error below 1e-3 in the lateral kinematics.

import type { Sourced } from "../core/provenance.js";

/** The lane's guide rail and cross slope (TRK geometry; dimensions are not yet sourced for BestTrack). */
export interface LaneLateral {
  readonly guideRail: { readonly width: Sourced<number>; readonly height: Sourced<number> };
  /** Lane tilt across, rad: positive raises the +y (left) side, so gravity pulls toward -y. */
  readonly crossSlope: Sourced<number>;
}

/** What the lateral model needs of the car beyond the planar description. */
export interface LateralCarSpec {
  /** Yaw moment of inertia about the CG, about the lane normal, kg m^2 (wheels as point masses). */
  readonly yawInertia: Sourced<number>;
  /** CG offset toward the car's left from the centreline, m. */
  readonly cgOffset: Sourced<number>;
  /** Distance between the inner faces of a left and right wheel, as installed, m. */
  readonly insideWheelSpacing: Sourced<number>;
  /** Axle yaw relative to square, rad: positive turns that axle's wheels to point left (WHL-002). */
  readonly toe: { readonly rear: Sourced<number>; readonly front: Sourced<number> };
  /** Coulomb coefficient of the treads on the lane, sideways. */
  readonly treadFriction: Sourced<number>;
  /**
   * Creepage at which a rolling tread's sideways creep force reaches the Coulomb limit (Kalker's
   * linear theory, saturating): below it the force is mu_t N (creepage / this), above it the tread
   * slides. Omitted: rigid Coulomb treads, which stick with no creep at all.
   */
  readonly treadCreep?: Sourced<number>;
  /** Coulomb coefficient of a wheel face on the guide rail. */
  readonly railFriction: Sourced<number>;
  /** Newton restitution of a wheel face striking the rail. */
  readonly railRestitution: Sourced<number>;
  /** Rear-axle lateral offset from the lane centre and heading at the gate. Omitted: centred, straight. */
  readonly start?: { readonly offset: Sourced<number>; readonly heading: Sourced<number> };
  /**
   * Wheel camber, rad, the two wheels of an axle mirrored: positive tilts their tops outward (WHL-009).
   * A cambered wheel rests on one edge of its tread, so the tread width sets its height. Omitted: square.
   */
  readonly camber?: { readonly rear: Sourced<number>; readonly front: Sourced<number>; readonly treadWidth: Sourced<number> };
  /**
   * Axial play: how far each wheel can slide along its axle between the body and the axle head, m,
   * per axle. insideWheelSpacing is then measured with the wheels pushed in against the body.
   * restitution is the wheel's hub striking a face; start is where the wheels sit at the gate, as a
   * fraction of the play outward from the body (omitted: 1/2). Omitted: the wheels are held fixed.
   */
  readonly play?: {
    readonly rear: Sourced<number>;
    readonly front: Sourced<number>;
    readonly restitution: Sourced<number>;
    readonly start?: Sourced<number>;
  };
}

export interface LateralModel {
  readonly m: number;
  readonly Iz: number;
  /** CG in body coordinates: x ahead of the rear axle, y to the left. */
  readonly xc: number;
  readonly yc: number;
  readonly wheelbase: number;
  readonly spacing: number;
  readonly railWidth: number;
  readonly railHeight: number;
  readonly toe: readonly [number, number];
  /** Camber per axle, rad, positive tops out, and the tread width, m. */
  readonly camber: readonly [number, number];
  readonly treadWidth: number;
  readonly radius: readonly [number, number];
  /** Both wheels of each axle, kg (already in m). */
  readonly wheelMass: readonly [number, number];
  readonly muT: number;
  /** Saturation creepage of the treads; omitted for rigid Coulomb treads. */
  readonly creep?: number;
  readonly muC: number;
  readonly e: number;
  /** g sin(cross slope), m/s^2. */
  readonly gLat: number;
  /** Axial play per axle, m, the hub's restitution on a face, and the start as a fraction of the play. Omitted: none. */
  readonly play?: { readonly travel: readonly [number, number]; readonly e: number; readonly start: number };
  /** CG height above the lane, m, for the roll moment. Omitted: no load transfer between the sides. */
  readonly cgHeight?: number;
}

export interface LateralState {
  readonly Y: number;
  readonly psi: number;
  readonly dY: number;
  readonly dPsi: number;
  /**
   * Axial play only: each wheel's slide outward from the body along its axle, m, and its rate, m/s.
   * Index 2 * axle + (0 left, 1 right).
   */
  readonly xi?: readonly number[];
  readonly dXi?: readonly number[];
}

/** One wheel's bore at the start of a step (dynamics.ts), for axial play; index 2 * axle + (0 left, 1 right). */
export interface WheelLoad {
  /** Coulomb friction force available at the bore, mu |R_radial|, N. */
  readonly friction: number;
  /** Slip speed of the bore from the wheel's spin relative to the body, |omega - pitch rate| r_axle, m/s. */
  readonly slip: number;
  /** Axle force on the wheel along the lane normal, N (negative: the axle presses the wheel down). */
  readonly normal: number;
}

export interface LateralInput {
  readonly h: number;
  /** Axle path speeds along the lane, rear and front, at the start and (predicted) end of the step. */
  readonly v0: readonly [number, number];
  readonly v1: readonly [number, number];
  /** Axle normal loads, N. */
  readonly N: readonly [number, number];
  /**
   * Rail contacts that carried force in the previous step. They are in sustained contact, not
   * striking, so restitution does not apply to them: a wheel riding the rail stays on it.
   */
  readonly closed?: readonly Pick<RailContact, "axle" | "side">[];
  /** Axial play only: each wheel's bore, and the previous step's contact and friction states. */
  readonly loads?: readonly WheelLoad[];
  readonly prev?: Readonly<Record<string, number>>;
  /** Each wheel's lane-load shift from roll at the start of the step, N (WheelAxle.roll). Axial play only. */
  readonly roll?: readonly number[];
}

/** A force for the planar solver, constant over the step, in the axle path's (tangent, normal) frame. */
export interface PlanarForce {
  readonly kind: "tread" | "rail";
  readonly axle: 0 | 1;
  /** True: acts on the wheels (enters their spin and axle loads). False: acts on the body. */
  readonly onWheel: boolean;
  /** The wheel that takes it: +1 left, -1 right. Omitted or 0: the axle's two wheels equally. */
  readonly side?: 1 | -1 | 0;
  /** Offset of the point of application from the axle centre: along t, along n, m. */
  readonly at: { readonly t: number; readonly n: number };
  /** Force components along t and n, N. */
  readonly f: { readonly t: number; readonly n: number };
  /** Sideways component, N: it loads the wheel's axle but is outside the planar equations. */
  readonly y?: number;
  /**
   * Torque about the wheel's axle, forward-roll sense, N m. Omitted: the in-plane moment of f about
   * the axle centre, which is exact for a square wheel and a force in the plane.
   */
  readonly spin?: number;
}

/** One wheel's axle, for the bore and thrust-face loads (dynamics.ts). */
export interface WheelAxle {
  /** Outward unit vector along the axle in the lane frame at that axle: along t, sideways (left), along n. */
  readonly axis: { readonly t: number; readonly y: number; readonly n: number };
  /** Sideways force the axle gives the wheel besides the external forces on it, N: m_w (a_y + g sin(cross slope)). */
  readonly sideways: number;
  /**
   * Axial play only: the face load, N, positive on the body face, negative on the head, zero while
   * the wheel is between them; and the share of the bore's Coulomb limit that opposes the spin, the
   * rest opposing the slide along the axle. Omitted: the face load follows from the wheel's motion
   * with the car, and the spin takes all of it.
   */
  readonly thrust?: number;
  readonly boreSpin?: number;
  /** Lane load this wheel carries beyond half its axle's, N, from the roll moment. Omitted: none. */
  readonly roll?: number;
}

/** Per axle (rear, front), its left and right wheels. */
export type WheelAxles = readonly [readonly [WheelAxle, WheelAxle], readonly [WheelAxle, WheelAxle]];

/** Square, unloaded sideways: the planar model's own axles. */
export const SQUARE_AXLES: WheelAxles = [
  [{ axis: { t: 0, y: 1, n: 0 }, sideways: 0 }, { axis: { t: 0, y: -1, n: 0 }, sideways: 0 }],
  [{ axis: { t: 0, y: 1, n: 0 }, sideways: 0 }, { axis: { t: 0, y: -1, n: 0 }, sideways: 0 }],
];

export interface RailContact {
  readonly axle: 0 | 1;
  /** +1: a left wheel against the rail's left face; -1: a right wheel against its right face. */
  readonly side: 1 | -1;
  /** Mean normal force over the step, N. */
  readonly force: number;
}

/** A wheel's hub on one of the faces that end its axial travel (axial play only). */
export interface StopContact {
  /** 2 * axle + (0 left, 1 right). */
  readonly wheel: number;
  readonly face: "body" | "head";
  /** Mean force over the step, N. */
  readonly force: number;
}

export interface LateralStep {
  readonly next: LateralState;
  readonly forces: readonly PlanarForce[];
  readonly contacts: readonly RailContact[];
  /** Hubs on their faces (axial play only; otherwise empty). */
  readonly stops: readonly StopContact[];
  /**
   * Work done on the lateral motion over the step, J, by mechanism. stops, boreSlide and heave are
   * axial play's: hubs striking their faces, bore friction against the slide, and the axle load on a
   * cambered axle, whose slope lifts the body as the wheel slides down it.
   */
  readonly work: {
    readonly gravity: number;
    readonly tread: number;
    readonly railNormal: number;
    readonly railFriction: number;
    readonly stops: number;
    readonly boreSlide: number;
    readonly heave: number;
  };
  /** Axial play only: the contact and friction states, to start the next step's search from. */
  readonly modes?: Readonly<Record<string, number>>;
  /** True when a contact closed in this step with an impulse: a strike, not sustained contact. */
  readonly impact: boolean;
  /** Each wheel's axle direction and sideways load over the step. */
  readonly wheels: WheelAxles;
  /** Tread state per axle: 0 stick, +1 or -1 sliding in that direction. */
  readonly slip: readonly [number, number];
  /** False when no stick/slip/contact combination satisfied every law (reported, not hidden). */
  readonly consistent: boolean;
  /** Deepest rail penetration at the step's midpoint, m (Moreau stepping allows O(h v) overlap). */
  readonly penetration: number;
}

export type V2 = [number, number];
const dot2 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]!;

export const lateralKinetic = (L: LateralModel, s: LateralState): number => 0.5 * L.m * s.dY * s.dY + 0.5 * L.Iz * s.dPsi * s.dPsi;

/** Lateral offset of a body point (bx ahead of the rear axle, by to the left) and its d/dpsi. */
export function bodyPoint(L: LateralModel, Y: number, psi: number, bx: number, by: number): { y: number; dyDpsi: number } {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return { y: Y + (bx - L.xc) * s + (by - L.yc) * c, dyDpsi: (bx - L.xc) * c - (by - L.yc) * s };
}

/** Rear-axle lateral offset at a given CG position and heading. */
export const rearOffset = (L: LateralModel, s: Pick<LateralState, "Y" | "psi">): number => bodyPoint(L, s.Y, s.psi, 0, 0).y;

/** CG lateral position for a rear-axle offset and heading. */
export const cgFromRear = (L: LateralModel, offset: number, psi: number): number => offset + L.xc * Math.sin(psi) + L.yc * Math.cos(psi);

export interface Candidate {
  readonly axle: 0 | 1;
  readonly side: 1 | -1;
  /** 2 * axle + (0 left, 1 right). */
  readonly wheel: number;
  /** Distance to the rail along the contact normal, m (negative when overlapping). */
  readonly gap: number;
  /** Gap rate per generalized velocity (Y', psi'). */
  readonly G: V2;
  /** Generalized impulse per unit normal impulse: the normal's, plus rail friction's sideways push and yaw. */
  readonly W: V2;
  /** The rail's force on the wheel per unit normal force, in the axle path's frame, with its axle torque. */
  readonly force: { readonly t: number; readonly n: number; readonly y: number; readonly spin: number };
  /** Contact point from the planar axle centre: along t, along n. */
  readonly at: { readonly t: number; readonly n: number };
  /** Lateral position of the contact on the lane, m. */
  readonly y: number;
  /** Axial play: gap rate per unit slide rate of this wheel, and the generalized impulse on its slide per unit normal impulse. */
  readonly Gxi: number;
  readonly Wxi: number;
}

const NO_SLIDE: readonly number[] = [0, 0, 0, 0];

/** Height above the lane of an axle's wheel centres and of their inner faces' centres, m. */
export function wheelHeights(L: LateralModel, axle: 0 | 1): { centre: number; face: number } {
  const r = L.radius[axle];
  const sg = Math.sin(L.camber[axle]);
  // The lower tread edge rests on the lane: the outer edge when the tops lean out, the inner when in.
  const centre = r * Math.cos(L.camber[axle]) + 0.5 * L.treadWidth * Math.abs(sg);
  return { centre, face: centre + 0.5 * L.treadWidth * sg };
}

const dot3 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * The four places a wheel face can meet the rail. A face is the disc inside its tread's inner rim,
 * radius r, in the wheel plane: forward e1 along the heading a = psi + toe, up e2 tilted by camber.
 * Across the lane, side * y is linear over the disc, p xi + q zeta in disc coordinates, so its least
 * value over the part of the disc below the rail's top is either the rim point the gradient points
 * away from (the rim on the rail's side face) or an end of the chord at the rail's height (the rim on
 * the rail's top edge).
 */
export function candidates(L: LateralModel, Y: number, psi: number, slide: readonly number[] = NO_SLIDE): Candidate[] {
  const out: Candidate[] = [];
  for (const axle of [0, 1] as const) {
    const r = L.radius[axle];
    const d = L.toe[axle];
    const cg = Math.cos(L.camber[axle]);
    const sg = Math.sin(L.camber[axle]);
    const zFace = wheelHeights(L, axle).face;
    // In-plane height of the rail's top edge above the face centre.
    const zetaH = (L.railHeight - zFace) / cg;
    const ca = Math.cos(psi + d);
    const sa = Math.sin(psi + d);
    for (const side of [1, -1] as const) {
      const wheel = 2 * axle + (side === 1 ? 0 : 1);
      if (zetaH <= -r) {
        // The rail is lower than the face's lowest rim: it cannot reach this face.
        out.push({ axle, side, wheel, gap: Infinity, G: [0, 0], W: [0, 0], force: { t: 0, n: 0, y: 0, spin: 0 }, at: { t: 0, n: 0 }, y: 0, Gxi: 0, Wxi: 0 });
        continue;
      }
      // Lane-frame (u, y, z) directions of this wheel: e1 forward, e2 up its plane, ax out along its axle.
      const e1 = [ca, sa, 0];
      const e2 = [-side * sg * sa, side * sg * ca, cg];
      const ax = [-side * cg * sa, side * cg * ca, -sg];
      const p = side * sa;
      const q = sg * ca;
      const k = Math.hypot(p, q);
      let xi: number;
      let zeta: number;
      let n: number[];
      if (k > 0 && (-r * q) / k <= zetaH) {
        // Rim on the rail's side face.
        xi = (-r * p) / k;
        zeta = (-r * q) / k;
        n = [0, side, 0];
      } else if (p !== 0) {
        // Rim on the rail's top edge, at the chord end nearer the rail. The normal is common to the
        // rim and the edge: perpendicular to the rim's tangent there and to the lane direction.
        const ell = Math.sqrt(Math.max(0, r * r - zetaH * zetaH));
        xi = -ell * Math.sign(p);
        zeta = zetaH;
        const tY = -zeta * sa + xi * side * sg * ca;
        const raw = [0, xi * cg, -tY];
        const o = Math.sign(side * raw[1]!) / Math.hypot(raw[1]!, raw[2]!);
        n = [0, raw[1]! * o, raw[2]! * o];
      } else {
        // Face parallel to the edge: they meet along the chord at the rail's height; take its middle.
        // The normal is the face's own.
        xi = 0;
        zeta = Math.min(zetaH, r);
        n = ax;
      }
      // Body-frame position of the contact: the face centre on the toed axle, then across the disc. A
      // wheel slid out along its axle moves across the lane, its height held by the lane.
      const half = L.spacing / 2 + slide[wheel]! * cg;
      const bx = L.wheelbase * axle - side * half * Math.sin(d) + xi * Math.cos(d) - zeta * side * sg * Math.sin(d);
      const by = side * half * Math.cos(d) + xi * Math.sin(d) + zeta * side * sg * Math.cos(d);
      const pt = bodyPoint(L, Y, psi, bx, by);
      const ny = n[1]!;
      const gap = (side * pt.y - L.railWidth / 2) * side * ny;
      const G: V2 = [ny, ny * pt.dyDpsi];
      // The wheel rolls about the line through its tread contact along the axle; the face point moves
      // omega ((zeta + r) e1 - xi e2) about it. Friction opposes the part along the contact.
      const vs = [0, 1, 2].map((j) => (zeta + r) * e1[j]! - xi * e2[j]!);
      const vn = dot3(vs, n);
      const vt = vs.map((x, j) => x - vn * n[j]!);
      const speed = Math.hypot(vt[0]!, vt[1]!, vt[2]!);
      const F = n.map((x, j) => x - (speed > 0 ? (L.muC * vt[j]!) / speed : 0));
      // Torque about the axle: F . (j x rho), with j x rho = zeta e1 - xi e2 for the face point rho.
      const spin = dot3(F, [0, 1, 2].map((j) => zeta * e1[j]! - xi * e2[j]!));
      // The contact from the planar axle centre, which the planar model puts at height r.
      const atT = xi * e1[0]! + zeta * e2[0]! - 0.5 * L.treadWidth * ax[0]!;
      const atN = zFace + zeta * cg - r;
      // Sideways force at the contact, and the along-lane force's yaw about the CG: M = -(y_P - Y) F_u.
      const W: V2 = [F[1]!, F[1]! * pt.dyDpsi - (pt.y - Y) * F[0]!];
      // The slide moves the face along (-sin a, cos a) side cos(gamma) across the lane.
      const Gxi = side * cg * ca * ny;
      const Wxi = side * cg * (ca * F[1]! - sa * F[0]!);
      out.push({ axle, side, wheel, gap, G, W, force: { t: F[0]!, n: F[2]!, y: F[1]!, spin }, at: { t: atT, n: atN }, y: pt.y, Gxi, Wxi });
    }
  }
  return out;
}

/** A force on the car for the roll moment: lane position and height of its point, sideways and normal parts, N. */
export interface RollForce {
  readonly y: number;
  readonly z: number;
  readonly Fy: number;
  readonly Fz: number;
}

/**
 * The lane load each left wheel carries beyond half its axle's, N; each right wheel carries the
 * negative. The lane loads balance, about the ground line under the car's centreline, the moment of
 * the rail forces, the CG's offset under its supported weight, and the CG's sideways acceleration and
 * the cross slope at its height:
 *
 *   sum y_k N_k = -sum (y F_z - z F_y) + y_c (sum N + sum F_z) - z_c m (a_y + g_lat).
 *
 * Four wheels on a rigid body carry that moment in a statically indeterminate way. Equal compliance
 * at the four contacts gives every wheel the same shift, M / (4 b), b the half-track. Without a CG
 * height (cgHeight omitted) there is no transfer.
 */
export function rollLoads(L: LateralModel, Y: number, aY: number, N: readonly [number, number], forces: readonly RollForce[]): number {
  if (L.cgHeight === undefined) return 0;
  const b = L.spacing / 2 + L.treadWidth / 2;
  const centre = Y - L.yc;
  let M = L.yc * (N[0] + N[1]) - L.cgHeight * L.m * (aY + L.gLat);
  for (const f of forces) M += L.yc * f.Fz - ((f.y - centre) * f.Fz - f.z * f.Fy);
  return M / (4 * b);
}

/** Each wheel's outward axle direction at heading psi, and its sideways load for velocity change dV over h. */
export function axles(L: LateralModel, Y: number, psi: number, dV: V2, h: number, roll = 0): WheelAxles {
  const per = (axle: 0 | 1): readonly [WheelAxle, WheelAxle] => {
    const d = L.toe[axle];
    const cg = Math.cos(L.camber[axle]);
    const sg = Math.sin(L.camber[axle]);
    const ca = Math.cos(psi + d);
    const sa = Math.sin(psi + d);
    const wheel = (side: 1 | -1): WheelAxle => {
      // The wheel centre: half the face spacing out along the toed axle, plus half the tread.
      const reach = L.spacing / 2 + 0.5 * L.treadWidth * cg;
      const pt = bodyPoint(L, Y, psi, L.wheelbase * axle - side * reach * Math.sin(d), side * reach * Math.cos(d));
      const ay = h > 0 ? (dV[0] + pt.dyDpsi * dV[1]) / h : 0;
      return { axis: { t: -side * cg * sa, y: side * cg * ca, n: -sg }, sideways: (L.wheelMass[axle] / 2) * (ay + L.gLat), ...(roll === 0 ? {} : { roll: side * roll }) };
    };
    return [wheel(1), wheel(-1)];
  };
  return [per(0), per(1)];
}

/** The wheels' axles with no sideways acceleration, for the instant before the first lateral step. */
export const restingAxles = (L: LateralModel, s: Pick<LateralState, "Y" | "psi">): WheelAxles => axles(L, s.Y, s.psi, [0, 0], 0);

/** Gap between a wheel face and the rail, m (negative when overlapping): axle 0 rear / 1 front, side +1 left / -1 right. */
export function railGap(L: LateralModel, Y: number, psi: number, axle: 0 | 1, side: 1 | -1, slide: readonly number[] = NO_SLIDE): number {
  return candidates(L, Y, psi, slide).find((c) => c.axle === axle && c.side === side)!.gap;
}

export function lateralStep(L: LateralModel, s: LateralState, inp: LateralInput): LateralStep {
  const h = inp.h;
  const Minv: V2 = [1 / L.m, 1 / L.Iz];
  const Vm: V2 = [s.dY, s.dPsi];
  const Fs: V2 = [-L.m * L.gLat, 0];
  const Vfree: V2 = [Vm[0] + h * Fs[0] * Minv[0], Vm[1] + h * Fs[1] * Minv[1]];

  // Geometry at the step's midpoint, predicted from the starting velocity (Moreau's theta = 1/2).
  const Ym = s.Y + 0.5 * h * Vm[0];
  const pm = s.psi + 0.5 * h * Vm[1];
  const tread = ([0, 1] as const).map((i) => {
    const a = pm + L.toe[i];
    const pt = bodyPoint(L, Ym, pm, L.wheelbase * i, 0);
    const c = Math.cos(a);
    const limit = L.muT * Math.max(inp.N[i], 0) * h;
    // Creep: slip per unit impulse below the limit, and the slip at which the tread slides.
    const sat = L.creep ? L.creep * Math.abs(inp.v1[i]!) : 0;
    return { sin: Math.sin(a), W: [c, c * pt.dyDpsi] as V2, limit, compliance: sat > 0 && limit > 0 ? sat / limit : 0, sat };
  });
  const all = candidates(L, Ym, pm);
  const near = all.filter((c) => c.gap <= 0);
  const eOf = (c: Candidate): number => (inp.closed?.some((k) => k.axle === c.axle && k.side === c.side) ? 0 : L.e);
  const penetration = Math.max(0, ...near.map((c) => -c.gap));

  // Unknown impulses: tread i (bounded by limit), rail j >= 0. Try every combination.
  const subsets: Candidate[][] = [[]];
  for (const c of near) for (const sset of [...subsets]) subsets.push([...sset, c]);
  const modes: [number, number][] = [];
  for (const a of [0, 1, -1]) for (const b of [0, 1, -1]) modes.push([a, b]);

  const tol = 1e-12;
  let best: { score: number; lam: [number, number]; P: number[]; set: Candidate[]; V: V2; slip: [number, number] } | null = null;
  search: for (const set of subsets)
    for (const mode of modes) {
      // A sliding tread with no friction limit is the same as sticking with zero force; skip duplicates.
      if (mode.some((m, i) => m !== 0 && tread[i]!.limit === 0)) continue;
      // Fixed impulses: sliding treads at their limit, opposing the slip.
      const lamFixed: [number, number] = [0, 0];
      mode.forEach((m, i) => {
        if (m !== 0) lamFixed[i] = -m * tread[i]!.limit;
      });
      let Vb: V2 = [...Vfree];
      for (const i of [0, 1]) Vb = [Vb[0] + Minv[0] * tread[i]!.W[0] * lamFixed[i]!, Vb[1] + Minv[1] * tread[i]!.W[1] * lamFixed[i]!];
      // Unknown columns: sticking treads, then closed rail contacts.
      const cols: V2[] = [];
      const rows: { a: V2; rhs: number; diag?: number }[] = [];
      mode.forEach((m, i) => {
        // An unloaded tread carries no friction: it is free, not stuck.
        if (m !== 0 || tread[i]!.limit === 0) return;
        cols.push(tread[i]!.W);
        // u+ = -v1 sin + W.V+ = 0, or with creep, -compliance times the tread's impulse.
        rows.push({ a: tread[i]!.W, rhs: inp.v1[i]! * tread[i]!.sin, diag: tread[i]!.compliance });
      });
      for (const c of set) {
        cols.push(c.W);
        rows.push({ a: c.G, rhs: -eOf(c) * dot2(c.G, Vm) });
      }
      const n = cols.length;
      let x: number[] = [];
      if (n > 0) {
        // rows . (Vb + Minv * sum cols x) = rhs
        const A = rows.map((r, j) => cols.map((col, q) => r.a[0] * Minv[0] * col[0] + r.a[1] * Minv[1] * col[1] + (q === j && r.diag ? r.diag : 0)));
        const b = rows.map((r) => r.rhs - dot2(r.a, Vb));
        const sol = solveSmall(A, b);
        if (!sol) continue;
        x = sol;
      }
      const V: V2 = [...Vb];
      cols.forEach((col, k) => {
        V[0] += Minv[0] * col[0] * x[k]!;
        V[1] += Minv[1] * col[1] * x[k]!;
      });
      // Check every law; score is the worst violation, 0 when consistent.
      let score = 0;
      const lam: [number, number] = [...lamFixed];
      let k = 0;
      mode.forEach((m, i) => {
        const u = -inp.v1[i]! * tread[i]!.sin + dot2(tread[i]!.W, V);
        const lim = tread[i]!.limit;
        const scale = tol * (1 + Math.abs(inp.v1[i]!));
        if (m === 0 && lim === 0) return;
        if (m === 0) {
          lam[i] = x[k++]!;
          score = Math.max(score, Math.abs(lam[i]) - lim - tol * (1 + lim));
        } else score = Math.max(score, -m * u - scale + tread[i]!.sat);
      });
      const P = set.map(() => x[k++]!);
      P.forEach((p) => {
        score = Math.max(score, -p - tol);
      });
      for (const c of near)
        if (!set.includes(c)) score = Math.max(score, -(dot2(c.G, V) + eOf(c) * dot2(c.G, Vm)) - tol * (1 + Math.abs(dot2(c.G, Vm))));
      if (!best || score < best.score) best = { score, lam, P, set, V, slip: [mode[0], mode[1]] };
      if (score <= 0) break search;
    }
  const sol = best!;
  const V = sol.V;
  const Vmid: V2 = [(Vm[0] + V[0]) / 2, (Vm[1] + V[1]) / 2];
  const next: LateralState = { Y: s.Y + h * Vmid[0], psi: s.psi + h * Vmid[1], dY: V[0], dPsi: V[1] };

  const forces: PlanarForce[] = [];
  let wTread = 0;
  ([0, 1] as const).forEach((i) => {
    const lam = sol.lam[i];
    if (lam === 0) return;
    wTread += lam * dot2(tread[i]!.W, Vmid);
    // The tread force, on both wheels at their tread contacts. It acts on the line each wheel rolls
    // about, so it exerts no torque on the spin; it loads the axles, mostly along them.
    forces.push({
      kind: "tread",
      axle: i,
      onWheel: true,
      side: 0,
      at: { t: 0, n: -L.radius[i] },
      f: { t: (-lam * tread[i]!.sin) / h, n: 0 },
      y: (lam * tread[i]!.W[0]) / h,
      spin: 0,
    });
  });
  let wNormal = 0;
  let wFric = 0;
  const contacts: RailContact[] = [];
  sol.set.forEach((c, j) => {
    const p = sol.P[j]!;
    if (p === 0) return;
    wNormal += p * dot2(c.G, Vmid);
    wFric += p * ((c.W[0] - c.G[0]) * Vmid[0] + (c.W[1] - c.G[1]) * Vmid[1]);
    const F = p / h;
    contacts.push({ axle: c.axle, side: c.side, force: F });
    const f = c.force;
    forces.push({ kind: "rail", axle: c.axle, onWheel: true, side: c.side, at: c.at, f: { t: f.t * F, n: f.n * F }, y: f.y * F, spin: f.spin * F });
  });
  const impact = sol.set.some((c, j) => sol.P[j]! > 0 && !inp.closed?.some((k) => k.axle === c.axle && k.side === c.side));
  const rails: RollForce[] = sol.set.map((c, j) => {
    const F = sol.P[j]! / h;
    return { y: c.y, z: L.radius[c.axle] + c.at.n, Fy: c.force.y * F, Fz: c.force.n * F };
  });
  const roll = rollLoads(L, Ym, (V[0] - Vm[0]) / h, inp.N, rails);
  return {
    next,
    forces,
    contacts,
    stops: [],
    work: { gravity: h * dot2(Fs, Vmid), tread: wTread, railNormal: wNormal, railFriction: wFric, stops: 0, boreSlide: 0, heave: 0 },
    wheels: axles(L, Ym, pm, [V[0] - Vm[0], V[1] - Vm[1]], h, roll),
    slip: sol.slip,
    consistent: sol.score <= 0,
    penetration,
    impact,
  };
}

/** Gaussian elimination for the small (at most 6) contact systems; null if singular. */
export function solveSmall(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-300) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let acc = M[r]![n]!;
    for (let c = r + 1; c < n; c++) acc -= M[r]![c]! * x[c]!;
    x[r] = acc / M[r]![r]!;
  }
  return x;
}
