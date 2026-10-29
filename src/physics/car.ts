// Solver-facing description of a car (PHY-009). Geometry and mass properties will later be
// derived from the master car model (controlling spec section 6); for now they are given directly.
//
// Body frame (GEO-010): origin on the rear axle axis, +X forward along the line through both
// axle axes, +Z up. Axle slots are at the same body height, so that line is the body X axis.

import type { Provenance, Sourced } from "../core/provenance.js";
import type { Vec2 } from "../core/vec2.js";
import type { LateralCarSpec } from "./lateral.js";

/** A face that holds a wheel along its axle: Coulomb friction at an effective radius. */
export interface ThrustFace {
  /**
   * Effective friction radius, m: for a uniformly loaded annulus from ri to ro,
   * 2/3 (ro^3 - ri^3) / (ro^2 - ri^2).
   */
  readonly radius: Sourced<number>;
  readonly friction: Sourced<number>;
}

/** A low point of the body or of a weight hung under it, body frame, m: the lowest in its cell of the plan view. */
export interface UnderbodyPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AxleSpec {
  /** Wheel outer radius, m. */
  readonly wheelRadius: Sourced<number>;
  /** Mass of both wheels on this axle, kg. Already included in the car's total mass. */
  readonly wheelMass: Sourced<number>;
  /** Spin inertia of both wheels on this axle about the axle, kg m^2 (WHL-008). */
  readonly spinInertia: Sourced<number>;
  /** Radius of the axle at the bore contact, m. */
  readonly axleRadius: Sourced<number>;
  /** Coulomb friction coefficient at the axle-bore contact (FRI-001). */
  readonly axleFriction: Sourced<number>;
  /** Rolling-resistance coefficient: resisting couple = Crr * N * wheelRadius. */
  readonly rollingResistance: Sourced<number>;
  /**
   * How axle friction depends on bore load (FRI-001). Omitted: Coulomb, axleFriction at every load.
   * Given: axleFriction is the coefficient at referenceLoad per wheel, and the friction force goes as
   * load^exponent. Exponent 1 is Coulomb; 2/3 is elastic (Hertz) contact with constant interfacial
   * shear strength (Bowden and Tabor). Needed to carry a spin-down coefficient, measured under one
   * wheel's weight, to race loads about twenty times larger.
   */
  readonly frictionLaw?: { readonly exponent: Sourced<number>; readonly referenceLoad: Sourced<number> };
  /**
   * Load-independent drag torque on both wheels of this axle, N m, opposing their rotation relative
   * to the body: hub-face rubbing with a fixed preload, a seal, a viscous film. Omitted: zero.
   */
  readonly hubDrag?: Sourced<number>;
  /**
   * The faces that take a wheel's axial load (FRI): the axle head outboard, the body (or a washer)
   * inboard. A wheel pushed outward bears on the head, one pushed inward on the body; the face's
   * friction opposes the wheel's spin relative to the body. Axial loads come from the lateral model
   * (tread and rail forces, camber); without it there are none. Omitted: frictionless faces.
   */
  readonly thrustFaces?: { readonly head: ThrustFace; readonly body: ThrustFace };
}

export interface CarSpec {
  readonly name: string;
  /** Total mass including wheels and axles, kg. */
  readonly mass: Sourced<number>;
  /** Centre of gravity in the body frame, m. */
  readonly cg: Sourced<Vec2>;
  /**
   * Pitch moment of inertia of the whole car about its CG, kg m^2, counting the wheels as point
   * masses at their axles. Wheel spin inertia is separate (AxleSpec.spinInertia).
   */
  readonly pitchInertia: Sourced<number>;
  /** Distance between axle axes, m (LOC-WB-001). */
  readonly wheelbase: Sourced<number>;
  /** Foremost point of the car in the body frame: touches the start pin and trips the finish sensor. */
  readonly nose: Sourced<Vec2>;
  /** Drag area Cd*A, m^2 (AERO-001: always an estimate unless measured). */
  readonly dragArea: Sourced<number>;
  readonly rear: AxleSpec;
  readonly front: AxleSpec;
  /**
   * Lateral properties for P6/P7 (lateral dynamics, guide-rail contact). Omitted: the car is raced in
   * the vertical plane only, as before.
   */
  readonly lateral?: LateralCarSpec;
  /**
   * The underside, for the clearance monitor (src/physics/clearance.ts): the lowest point in each cell
   * of a grid over the plan view, wheels and axles excluded. Omitted: clearance is not checked.
   */
  readonly underbody?: Sourced<readonly UnderbodyPoint[]>;
}

export interface Environment {
  readonly gravity: Sourced<number>;
  readonly airDensity: Sourced<number>;
}

/** Plain numbers extracted from a spec, in SI units. */
export interface AxleModel {
  readonly r: number;
  readonly wheelMass: number;
  readonly spinInertia: number;
  readonly axleRadius: number;
  readonly mu: number;
  readonly crr: number;
  /** Friction force goes as bore load^frictionExponent; mu applies at frictionReferenceLoad per wheel, N. */
  readonly frictionExponent: number;
  readonly frictionReferenceLoad: number;
  readonly hubDrag: number;
  readonly thrust: { readonly head: { readonly r: number; readonly mu: number }; readonly body: { readonly r: number; readonly mu: number } } | null;
}

export interface CarModel {
  readonly mass: number;
  readonly cg: Vec2;
  readonly pitchInertia: number;
  readonly wheelbase: number;
  readonly nose: Vec2;
  readonly dragArea: number;
  readonly rear: AxleModel;
  readonly front: AxleModel;
}

const axleModel = (a: AxleSpec): AxleModel => ({
  r: a.wheelRadius.value,
  wheelMass: a.wheelMass.value,
  spinInertia: a.spinInertia.value,
  axleRadius: a.axleRadius.value,
  mu: a.axleFriction.value,
  crr: a.rollingResistance.value,
  frictionExponent: a.frictionLaw?.exponent.value ?? 1,
  frictionReferenceLoad: a.frictionLaw?.referenceLoad.value ?? 1,
  hubDrag: a.hubDrag?.value ?? 0,
  thrust: a.thrustFaces
    ? {
        head: { r: a.thrustFaces.head.radius.value, mu: a.thrustFaces.head.friction.value },
        body: { r: a.thrustFaces.body.radius.value, mu: a.thrustFaces.body.friction.value },
      }
    : null,
});

export function carModel(spec: CarSpec): CarModel {
  return {
    mass: spec.mass.value,
    cg: spec.cg.value,
    pitchInertia: spec.pitchInertia.value,
    wheelbase: spec.wheelbase.value,
    nose: spec.nose.value,
    dragArea: spec.dragArea.value,
    rear: axleModel(spec.rear),
    front: axleModel(spec.front),
  };
}

/** Provenance of every input, keyed by a readable path, for the result record (MODE-004). */
export function inputProvenance(spec: CarSpec, env: Environment): Record<string, Provenance> {
  const out: Record<string, Provenance> = {
    "car.mass": spec.mass.provenance,
    "car.cg": spec.cg.provenance,
    "car.pitchInertia": spec.pitchInertia.provenance,
    "car.wheelbase": spec.wheelbase.provenance,
    "car.nose": spec.nose.provenance,
    "car.dragArea": spec.dragArea.provenance,
    ...(spec.underbody ? { "car.underbody": spec.underbody.provenance } : {}),
    "env.gravity": env.gravity.provenance,
    "env.airDensity": env.airDensity.provenance,
  };
  for (const [axle, a] of [["rear", spec.rear], ["front", spec.front]] as const) {
    out[`${axle}.wheelRadius`] = a.wheelRadius.provenance;
    out[`${axle}.wheelMass`] = a.wheelMass.provenance;
    out[`${axle}.spinInertia`] = a.spinInertia.provenance;
    out[`${axle}.axleRadius`] = a.axleRadius.provenance;
    out[`${axle}.axleFriction`] = a.axleFriction.provenance;
    out[`${axle}.rollingResistance`] = a.rollingResistance.provenance;
    if (a.frictionLaw) {
      out[`${axle}.frictionLaw.exponent`] = a.frictionLaw.exponent.provenance;
      out[`${axle}.frictionLaw.referenceLoad`] = a.frictionLaw.referenceLoad.provenance;
    }
    if (a.hubDrag) out[`${axle}.hubDrag`] = a.hubDrag.provenance;
    if (a.thrustFaces)
      for (const face of ["head", "body"] as const) {
        out[`${axle}.thrustFaces.${face}.radius`] = a.thrustFaces[face].radius.provenance;
        out[`${axle}.thrustFaces.${face}.friction`] = a.thrustFaces[face].friction.provenance;
      }
  }
  const l = spec.lateral;
  if (l) {
    out["lateral.yawInertia"] = l.yawInertia.provenance;
    out["lateral.cgOffset"] = l.cgOffset.provenance;
    out["lateral.insideWheelSpacing"] = l.insideWheelSpacing.provenance;
    out["lateral.toe.rear"] = l.toe.rear.provenance;
    out["lateral.toe.front"] = l.toe.front.provenance;
    out["lateral.treadFriction"] = l.treadFriction.provenance;
    if (l.treadCreep) out["lateral.treadCreep"] = l.treadCreep.provenance;
    out["lateral.railFriction"] = l.railFriction.provenance;
    out["lateral.railRestitution"] = l.railRestitution.provenance;
    if (l.camber) {
      out["lateral.camber.rear"] = l.camber.rear.provenance;
      out["lateral.camber.front"] = l.camber.front.provenance;
      out["lateral.camber.treadWidth"] = l.camber.treadWidth.provenance;
    }
    if (l.play) {
      out["lateral.play.rear"] = l.play.rear.provenance;
      out["lateral.play.front"] = l.play.front.provenance;
      out["lateral.play.restitution"] = l.play.restitution.provenance;
      if (l.play.start) out["lateral.play.start"] = l.play.start.provenance;
    }
    if (l.start) {
      out["lateral.start.offset"] = l.start.offset.provenance;
      out["lateral.start.heading"] = l.start.heading.provenance;
    }
  }
  return out;
}
