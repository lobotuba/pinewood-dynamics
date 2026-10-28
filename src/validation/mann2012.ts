// Published comparison data (VAL-001): Mann, Gibbs and Sah, "Dynamics of a gravity car race with
// application to the Pinewood Derby", Mechanical Sciences 3, 73-84 (2012), doi:10.5194/ms-3-73-2012,
// CC-BY 3.0. Duke University; a 26 deg aluminium track with an infrared finish timer, and one
// instrumented car whose parameters were identified in separate bench tests (their section 4.3).
//
// This is someone else's experiment, so every value is labelled by where it comes from:
//   PUBLISHED  - stated in the paper (their Table 2), recorded here as MEASURED
//   ASSUMED    - not in the paper; our reading or a typical-kit value (ESTIMATED)
// Race times are read by eye from their Fig. 12, so they carry a reading uncertainty on top of the
// published error bars.

import { type Sourced, sourced } from "../core/provenance.js";
import { degrees, inches } from "../core/units.js";
import { v2 } from "../core/vec2.js";
import type { AxleSpec, CarSpec, Environment } from "../physics/car.js";
import { Path } from "../track/path.js";
import type { Track } from "../track/track.js";

export const MANN_2012_CITATION =
  "Mann, Gibbs and Sah, Mech. Sci. 3, 73-84 (2012), doi:10.5194/ms-3-73-2012";

const pub = <T = number>(x: T, what: string): Sourced<T> => sourced(x, "MEASURED", `${MANN_2012_CITATION}, ${what}`);
const assumed = <T = number>(x: T, why: string): Sourced<T> => sourced(x, "ESTIMATED", `Assumed: ${why}`);

/** Their Table 2, SI units. */
export const MANN_2012_TABLE2 = {
  slope: degrees(26),
  /** Vertical distance to the starting position, m. */
  d: 1.17,
  /** Distance from the front of the car to its CG, m. */
  xBar: 0.098,
  /** Vertical distance from the track to the CG, m. */
  yBar: 0.013,
  g: 9.81,
  mass: 0.191,
  wheelMass: 2.65e-3,
  wheelRadius: 0.0151,
  /** Axle radius at the bore ("inner radius"), m. Large for a nail axle; used as published. */
  axleRadius: 2.54e-3,
  wheelGyration: 0.0107,
  /** Flat length to the finish and inclined length to the start, m. */
  flatToFinish: 4.21,
  inclineToStart: 2.16,
  muK: 0.167,
  cd: 1.1,
  area: 0.00146,
  airDensity: 1.2041,
  wheelInertia: 3.06e-7,
  pitchInertia: 2.5205e-4,
} as const;

/** Out-of-the-box normalisation constants from their Figs. 2, 5, 7 and 12. */
export const MANN_2012_NORMALISATION = { mass: 0.1091, xBar: 0.09 } as const;

/**
 * Their track, rebuilt. PUBLISHED: 26 deg incline, start 2.16 m up the incline from the curve, finish
 * 4.21 m along the flat after it. ASSUMED: the curve is a BestTrack curved lane (41 in turning 26 deg,
 * uniform curvature; their photo shows a BestTrack-style aluminium track and their slope matches),
 * and the 2.16 m is measured from the start-pin plane. Check: this gives a start height of 1.179 m
 * against their published d = 1.17 m.
 */
export function mann2012Track(): Track {
  const T = MANN_2012_TABLE2;
  const curve = inches(41);
  const radius = curve / T.slope;
  const above = 0.3; // lane above the pin so the car can sit behind it
  const incline = above + T.inclineToStart;
  const top = incline * Math.sin(T.slope) + radius * (1 - Math.cos(T.slope));
  const surface = Path.build(v2(0, top), -T.slope, [
    { kind: "line", length: incline },
    { kind: "arc", radius, turn: T.slope },
    { kind: "line", length: T.flatToFinish + 1.5 },
  ]);
  return {
    name: "Mann et al. 2012 test track (rebuilt)",
    surface,
    profileStatus: "ESTIMATED",
    profileSource: `${MANN_2012_CITATION}: incline, start and finish distances published; curve assumed BestTrack-like.`,
    pinS: above,
    timedDistance: assumed(T.inclineToStart + curve + T.flatToFinish, "start-to-finish along the lane from Table 2 plus a 41 in curve"),
  };
}

export interface Mann2012CarOptions {
  /** Total mass, kg (default Table 2). */
  readonly mass?: number;
  /** Front of car to CG, m (default Table 2). */
  readonly xBar?: number;
  readonly muK?: number;
}

/**
 * Their car: a standard kit base, hollowed and fitted with weights and shells. PUBLISHED: mass, CG,
 * wheel and axle properties, friction, drag, pitch inertia. ASSUMED: a 7 in body with the axles at
 * typical kit positions (0.875 in and 5.25 in from the rear), which the paper does not give; pitch
 * inertia unchanged as weights are added near the CG; no rolling resistance (they modelled none and
 * identified none).
 */
export function mann2012Car(o: Mann2012CarOptions = {}): CarSpec {
  const T = MANN_2012_TABLE2;
  const bodyLength = inches(7);
  const rearAxleFromRear = inches(0.875);
  const wheelbase = inches(5.25) - rearAxleFromRear;
  const xBar = o.xBar ?? T.xBar;
  const axle = (): AxleSpec => ({
    wheelRadius: pub(T.wheelRadius, "Table 2 r_o"),
    wheelMass: pub(2 * T.wheelMass, "Table 2 m_o, two wheels"),
    spinInertia: pub(2 * T.wheelInertia, "Table 2 I_w, two wheels"),
    axleRadius: pub(T.axleRadius, "Table 2 r_i"),
    axleFriction: o.muK === undefined ? pub(T.muK, "Table 2 mu_k (spin-down test, no graphite)") : assumed(o.muK, "varied"),
    rollingResistance: assumed(0, "not modelled or identified in the paper"),
  });
  return {
    name: `Mann et al. 2012 car, ${(o.mass ?? T.mass).toFixed(3)} kg, xBar ${(xBar * 1000).toFixed(1)} mm`,
    mass: o.mass === undefined ? pub(T.mass, "Table 2 m") : assumed(o.mass, "experiment mass read from Fig. 12a"),
    // Body frame: origin on the rear axle; CG height above the axle line = yBar - wheel radius.
    cg: assumed(v2(bodyLength - xBar - rearAxleFromRear, T.yBar - T.wheelRadius), "axle positions of a typical kit"),
    pitchInertia: pub(T.pitchInertia, "Table 2 I_G"),
    wheelbase: assumed(wheelbase, "typical kit axle slots, not given in the paper"),
    nose: assumed(v2(bodyLength - rearAxleFromRear, 0), "7 in body, typical kit axle slots"),
    dragArea: pub(T.cd * T.area, "Table 2 C_D times A"),
    rear: axle(),
    front: axle(),
  };
}

export const mann2012Environment = (): Environment => ({
  gravity: pub(MANN_2012_TABLE2.g, "Table 2 g"),
  airDensity: pub(MANN_2012_TABLE2.airDensity, "Table 2 rho_a"),
});

export interface MeasuredPoint {
  /** Mass, kg, or CG distance from the car's front, m. */
  readonly x: number;
  /** Mean race time, s, and half-height of the published error bar, s. */
  readonly time: number;
  readonly errorBar: number;
}

/**
 * Fig. 12, read by eye at about +-0.005 s and +-0.005 kg / +-0.02 xBar/p.
 * (a) Varying mass at constant CG. The axis is labelled m/u, but values of 0.16-0.29 times 0.1091 kg
 *     would be 17-32 g, lighter than the bare base; we read the axis as mass in kg, which brackets
 *     their 0.191 kg car.
 * (b) Varying xBar (normalised by 0.09 m) at, we assume, the Table 2 mass.
 */
export const MANN_2012_FIG12 = {
  mass: [
    { x: 0.167, time: 2.308, errorBar: 0.013 },
    { x: 0.185, time: 2.272, errorBar: 0.008 },
    { x: 0.225, time: 2.236, errorBar: 0.007 },
    { x: 0.26, time: 2.214, errorBar: 0.008 },
    { x: 0.29, time: 2.216, errorBar: 0.009 },
  ],
  xBar: [
    { x: 0.72 * MANN_2012_NORMALISATION.xBar, time: 2.338, errorBar: 0.004 },
    { x: 0.87 * MANN_2012_NORMALISATION.xBar, time: 2.275, errorBar: 0.009 },
    { x: 1.04 * MANN_2012_NORMALISATION.xBar, time: 2.258, errorBar: 0.004 },
    { x: 1.27 * MANN_2012_NORMALISATION.xBar, time: 2.21, errorBar: 0.003 },
    { x: 1.48 * MANN_2012_NORMALISATION.xBar, time: 2.198, errorBar: 0.002 },
  ],
} as const satisfies Record<string, readonly MeasuredPoint[]>;
