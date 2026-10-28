// Official-kit component library (KIT-001, CHAR-001..003). Named generically (BRD-007).
//
// EVENT_KIT_K1 holds what is actually known about the event's kit: almost nothing yet.
// TYPICAL_KIT_ESTIMATE lets the solver run before measurements exist. Every value in it is
// ESTIMATED from general derby-kit knowledge, not measured on the event kit, and must not be
// shown as a kit fact (LOC-AX-004).

import { type Sourced, type Unknown, sourced, unknown } from "../core/provenance.js";
import { STANDARD_GRAVITY, grams, inches, ounces } from "../core/units.js";
import { v2 } from "../core/vec2.js";
import type { AxleSpec, CarSpec, Environment } from "../physics/car.js";

export interface KitDefinition {
  readonly id: string;
  readonly name: string;
  readonly blockLength: Sourced<number> | Unknown;
  readonly blockWidth: Sourced<number> | Unknown;
  readonly blockHeight: Sourced<number> | Unknown;
  readonly blockMass: Sourced<number> | Unknown;
  /** Axle datums along the block from its rear face, m (CHAR-002). */
  readonly rearAxleFromRear: Sourced<number> | Unknown;
  readonly frontAxleFromRear: Sourced<number> | Unknown;
  readonly wheelRadius: Sourced<number> | Unknown;
  readonly wheelWidth: Sourced<number> | Unknown;
  readonly wheelMass: Sourced<number> | Unknown;
  readonly wheelSpinInertia: Sourced<number> | Unknown;
  readonly axleRadius: Sourced<number> | Unknown;
  readonly axleMass: Sourced<number> | Unknown;
}

const todo = (what: string): Unknown => unknown(`${what}: not yet measured (controlling spec section 19)`);

export const EVENT_KIT_K1: KitDefinition = {
  id: "event-kit-k1",
  name: "Event kit K1: block, wheels, axles",
  blockLength: todo("CHAR-001 block length"),
  blockWidth: todo("CHAR-001 block width"),
  blockHeight: todo("CHAR-001 block height"),
  blockMass: todo("CHAR-001 block mass"),
  rearAxleFromRear: todo("CHAR-002 rear axle datum"),
  frontAxleFromRear: todo("CHAR-002 front axle datum"),
  wheelRadius: todo("CHAR-003 wheel radius"),
  wheelWidth: todo("CHAR-003 wheel width"),
  wheelMass: todo("CHAR-003 wheel mass"),
  wheelSpinInertia: todo("CHAR-003 wheel spin inertia"),
  axleRadius: todo("CHAR-003 axle radius"),
  axleMass: todo("CHAR-003 axle mass"),
};

const EST = "Typical derby-kit value from general knowledge; not measured on the event kit.";
const est = <T = number>(x: T, note = EST): Sourced<T> => sourced(x, "ESTIMATED", note);

export const TYPICAL_KIT_ESTIMATE = {
  blockLength: est(inches(7)),
  blockWidth: est(inches(1.75)),
  blockHeight: est(inches(1.25)),
  rearAxleFromRear: est(inches(0.875)),
  frontAxleFromRear: est(inches(5.25)),
  wheelRadius: est(inches(1.18) / 2),
  wheelMass: est(grams(2.6)),
  // 0.6 m r^2: most of a derby wheel's mass is in the tread ring.
  wheelSpinInertia: est(0.6 * grams(2.6) * (inches(1.18) / 2) ** 2, `${EST} Taken as 0.6 m r^2.`),
  axleRadius: est(inches(0.087) / 2),
  // Solid-model geometry (GEO-009). Same status: typical values, not measured on the event kit.
  wheelWidth: est(inches(0.38)),
  /** Gap between the body side and the wheel hub, per side. */
  wheelBodyGap: est(inches(0.03)),
  /** Axle axis above the block's bottom face (sets the slot depth and the underside clearance). */
  axleAboveBlockBottom: est(inches(3 / 16)),
  axleShaftLength: est(inches(1.2)),
  axleHeadDiameter: est(inches(0.2)),
  axleHeadThickness: est(inches(0.04)),
  steelDensity: sourced(7850, "DEFAULT", "Carbon steel, handbook value"),
  /** Pine; real kit blocks vary by roughly +-15 %. Weigh the block to replace this (MAT-001). */
  woodDensity: est(420, `${EST} Pine, 0.42 g/cm^3.`),
  woodDensityRelativeUncertainty: est(0.15, `${EST} Spread of pine densities.`),
} as const;

export const DEFAULT_ENVIRONMENT: Environment = {
  gravity: sourced(STANDARD_GRAVITY, "DEFAULT", "Standard gravity"),
  airDensity: sourced(1.204, "DEFAULT", "Dry air, 20 C, sea level"),
};

export interface DemoCarOptions {
  readonly name?: string;
  /** Total mass, kg. */
  readonly mass?: number;
  /** CG ahead of the rear axle, m. */
  readonly cgX?: number;
  /** CG above the axle line, m. */
  readonly cgZ?: number;
  readonly axleFriction?: number;
  readonly rollingResistance?: number;
  readonly dragArea?: number;
}

/**
 * A car on the typical kit with ESTIMATED physical properties, for exercising the solver.
 * Defaults: 4.9 oz, CG 1 in ahead of the rear axle and 0.3 in above the axle line.
 */
export function demoCar(o: DemoCarOptions = {}): CarSpec {
  const k = TYPICAL_KIT_ESTIMATE;
  const wb = k.frontAxleFromRear.value - k.rearAxleFromRear.value;
  const axle = (): AxleSpec => ({
    wheelRadius: k.wheelRadius,
    wheelMass: est(2 * k.wheelMass.value, `${EST} Two wheels.`),
    spinInertia: est(2 * k.wheelSpinInertia.value, `${EST} Two wheels.`),
    axleRadius: k.axleRadius,
    axleFriction: est(o.axleFriction ?? 0.15, "Polished axle with graphite: guess pending CHAR-006."),
    rollingResistance: est(o.rollingResistance ?? 0.003, "Plastic wheel on aluminium: guess pending CHAR-006."),
  });
  const mass = o.mass ?? ounces(4.9); // margin below the 5.000 oz limit (MAT-006)
  return {
    name: o.name ?? "Demo car (typical kit, estimated)",
    mass: est(mass, "Demo value"),
    cg: est(v2(o.cgX ?? inches(1), o.cgZ ?? inches(0.3)), "Demo value"),
    // Uniform-rod approximation over the block length.
    pitchInertia: est((mass * k.blockLength.value ** 2) / 12, "Uniform-rod approximation"),
    wheelbase: est(wb),
    nose: est(v2(k.blockLength.value - k.rearAxleFromRear.value, inches(0.3))),
    dragArea: est(o.dragArea ?? 6e-4, "Cd about 0.45 on about 1.35e-3 m^2 frontal area (AERO-001: estimate)."),
    rear: axle(),
    front: axle(),
  };
}
