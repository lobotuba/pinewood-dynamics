// Track model (controlling spec section 10; TRK-001..004, GATE-004, TIM-001).

import { type Sourced, sourced } from "../core/provenance.js";
import { degrees, inches } from "../core/units.js";
import { v2 } from "../core/vec2.js";
import { Path, type SegmentSpec } from "./path.js";

/** TRK-004: how much of the lane profile is known. */
export type ProfileStatus = "IDEALIZED" | "ESTIMATED" | "MEASURED";

export interface Track {
  readonly name: string;
  /** Lane surface in the vertical plane, arc length from the top of the lane. */
  readonly surface: Path;
  readonly profileStatus: ProfileStatus;
  readonly profileSource: string;
  /** Surface arc length of the start-pin contact plane (plane through the surface point, normal to the lane). */
  readonly pinS: number;
  /** Timed distance from the start pin to the finish sensor, measured along the lane surface. */
  readonly timedDistance: Sourced<number>;
}

/** Surface arc length of the finish sensor plane (TIM-001). */
export const finishS = (track: Track): number => track.pinS + track.timedDistance.value;

export interface RampParams {
  /** Slope angle below horizontal, rad. */
  readonly slope: number;
  /** Lane length along the slope from its top to the start of the transition, m. */
  readonly slopeLength: number;
  /** Transition arc radius, m. */
  readonly transitionRadius: number;
  /** Flat run after the transition, m. */
  readonly flatLength: number;
  /** Surface arc length of the start pin from the top of the slope, m. */
  readonly pinS: number;
  readonly timedDistance: Sourced<number>;
  /** Height of the slope top above the flat run's surface; only shifts potential energy. */
  readonly topHeight?: number;
}

function rampSegments(p: RampParams): SegmentSpec[] {
  return [
    { kind: "line", length: p.slopeLength },
    { kind: "arc", radius: p.transitionRadius, turn: p.slope },
    { kind: "line", length: p.flatLength },
  ];
}

function rampTopHeight(p: RampParams): number {
  return p.slopeLength * Math.sin(p.slope) + p.transitionRadius * (1 - Math.cos(p.slope));
}

/** Idealized test ramp: exact by definition, used for verification (controlling spec 10.3). */
export function idealRamp(p: RampParams, name = "Idealized test ramp"): Track {
  const surface = Path.build(v2(0, p.topHeight ?? rampTopHeight(p)), -p.slope, rampSegments(p));
  return {
    name,
    surface,
    profileStatus: "IDEALIZED",
    profileSource: "Exact analytic profile defined for verification; not a real track.",
    pinS: p.pinS,
    timedDistance: p.timedDistance,
  };
}

/**
 * BestTrack 35-ft configuration with an ESTIMATED lane profile.
 *
 * MANUFACTURER: timed distance 358 in from start-gate pin to middle timing hole, and three
 * 7-ft straights plus a stop section after the curve (External_Knowns_BestTrack).
 * ESTIMATED: everything else below. Slope angle, slope length, transition radius and pin
 * position were chosen to be plausible (about 1 m total drop, post-curve flat close to the
 * published 21 ft of straights) and are placeholders until the CHAR-005 track survey.
 * The along-surface interpretation of the timed distance is also an assumption.
 */
export function bestTrack35Estimated(): Track {
  const params: RampParams = {
    slope: degrees(25),
    slopeLength: 2.2,
    transitionRadius: 2.0,
    flatLength: 7.5,
    pinS: 0.3,
    timedDistance: sourced(inches(358), "MANUFACTURER", "https://www.besttrack.com/track_specs.html"),
  };
  return {
    ...idealRamp(params, "BestTrack 35 ft (estimated profile)"),
    profileStatus: "ESTIMATED",
    profileSource:
      "Placeholder geometry: 25 deg slope, 2.0 m transition radius, pin 0.3 m below slope top. " +
      "Replace with CHAR-005 survey before comparing with real races.",
  };
}
