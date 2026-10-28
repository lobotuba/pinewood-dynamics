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

export type BestTrackLength = 35 | 42 | 49;

const BESTTRACK_SPECS = "https://www.besttrack.com/track_specs.html";
const BESTTRACK_DRAWING = "https://www.besttrack.com/tracklayoutsketch2.pdf";
/** Start pin to the middle timer hole, in (MANUFACTURER, BESTTRACK_SPECS). */
const BESTTRACK_TIMED_IN: Record<BestTrackLength, number> = { 35: 358, 42: 442, 49: 526 };
/** 7-ft straight lane sections after the curved lane (MANUFACTURER). */
const BESTTRACK_STRAIGHTS: Record<BestTrackLength, number> = { 35: 3, 42: 4, 49: 5 };

/**
 * BestTrack aluminium track built from the manufacturer's layout drawing and specification page.
 *
 * MANUFACTURER: a 7 ft start lane at 26 deg; a curved lane 41 in long; 7 ft straight lanes plus a
 * 40 in stop section; the start pin 8 in down the start lane from its top end; the timed distance
 * from the pin to the middle timer hole (358, 442 or 526 in).
 *
 * ESTIMATED: the curved lane has uniform curvature, turning 26 deg over 41 in (radius 90.35 in).
 * The drawing labels it "4 ft radius", but a 41 in arc of 48 in radius would turn 49 deg, not 26.
 * Uniform curvature fits the drawing's other numbers: the curve top at 11-3/8 in, the track top
 * at about 48 in and the pin at about 45 in above the floor, and the 33 ft 11 in footprint of the
 * 35 ft track. It also gives a 1.17 m drop from the start lane top, matching the 26 deg aluminium
 * track in Mann, Gibbs and Sah (2012). The real curve shape needs the CHAR-005 survey. The drawing
 * does not say whether the 8 in is to the pin's centre or its face; the lane is taken as one smooth
 * surface with no joint steps.
 */
export function bestTrack(length: BestTrackLength = 35): Track {
  const slope = degrees(26);
  const startLane = inches(84);
  const curve = inches(41);
  const radius = curve / slope;
  const flat = BESTTRACK_STRAIGHTS[length] * inches(84) + inches(40);
  const top = startLane * Math.sin(slope) + radius * (1 - Math.cos(slope));
  const surface = Path.build(v2(0, top), -slope, [
    { kind: "line", length: startLane },
    { kind: "arc", radius, turn: slope },
    { kind: "line", length: flat },
  ]);
  return {
    name: `BestTrack ${length} ft (manufacturer drawing, estimated curve shape)`,
    surface,
    profileStatus: "ESTIMATED",
    profileSource:
      `Lengths, 26 deg slope and pin position from the manufacturer drawing (${BESTTRACK_DRAWING}); ` +
      "curved lane assumed uniform (41 in turning 26 deg, radius 90.35 in) pending the CHAR-005 survey.",
    pinS: inches(8),
    timedDistance: sourced(inches(BESTTRACK_TIMED_IN[length]), "MANUFACTURER", BESTTRACK_SPECS),
  };
}
