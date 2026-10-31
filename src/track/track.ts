// Track model (controlling spec section 10; TRK-001..004, GATE-004, TIM-001).

import { type Sourced, sourced } from "../core/provenance.js";
import { degrees, inches } from "../core/units.js";
import { v2 } from "../core/vec2.js";
import type { Surface } from "./curve.js";
import type { LaneLateral } from "../physics/lateral.js";
import { Path, type SegmentSpec } from "./path.js";

/** TRK-004: how much of the lane profile is known. */
export type ProfileStatus = "IDEALIZED" | "ESTIMATED" | "MEASURED";

export interface Track {
  readonly name: string;
  /** Lane surface in the vertical plane, arc length from the top of the lane. */
  readonly surface: Surface;
  readonly profileStatus: ProfileStatus;
  readonly profileSource: string;
  /** Surface arc length of the start-pin contact plane (plane through the surface point, normal to the lane). */
  readonly pinS: number;
  /** Timed distance from the start pin to the finish sensor, measured along the lane surface. */
  readonly timedDistance: Sourced<number>;
  /** Guide rail and cross slope, for the lateral model (P6, P7). Omitted: planar racing only. */
  readonly lateral?: LaneLateral;
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
 * The idealized test ramp that ships for verification (10.3): an exact profile, not a real track.
 * Its dimensions are defaults chosen for the purpose.
 */
export const TEST_RAMP: RampParams = {
  slope: degrees(26),
  slopeLength: 2,
  transitionRadius: 2,
  flatLength: 6,
  pinS: 0.3,
  timedDistance: sourced(7, "DEFAULT", "Idealized verification ramp"),
};

export type BestTrackLength = 35 | 42 | 49;

const BESTTRACK_SPECS = "https://www.besttrack.com/track_specs.html";
const BESTTRACK_FAQ = "https://www.besttrack.com/faq.htm";
const BESTTRACK_DRAWING = "https://www.besttrack.com/tracklayoutsketch2.pdf";
/** Start pin to the middle timer hole, in (MANUFACTURER, BESTTRACK_SPECS). */
const BESTTRACK_TIMED_IN: Record<BestTrackLength, number> = { 35: 358, 42: 442, 49: 526 };
/** 7-ft straight lane sections after the curved lane (MANUFACTURER). */
const BESTTRACK_STRAIGHTS: Record<BestTrackLength, number> = { 35: 3, 42: 4, 49: 5 };

/**
 * Centre guide rail, 1 5/8 in wide and 1/4 in tall: the figure local rulebooks give for a standard
 * track. Not from BestTrack's own documents, which leave rail and lane dimensions open, so ESTIMATED
 * until the owner's track is measured (CHAR-005). The lane is taken as level across (DEFAULT).
 */
export const TYPICAL_LANE_LATERAL: LaneLateral = {
  guideRail: {
    width: sourced(inches(1.625), "ESTIMATED", "Common rulebook statement of a standard centre rail; not BestTrack-specific"),
    height: sourced(inches(0.25), "ESTIMATED", "Common rulebook statement of a standard centre rail; not BestTrack-specific"),
  },
  crossSlope: sourced(0, "DEFAULT", "Level across until surveyed"),
};

/**
 * BestTrack's lane, from the manufacturer's FAQ: 3.50 in lanes at 3.50 in centre to centre, a centre
 * wheel guide 1/4 in tall by 1-5/8 in wide, and a 1 in flat between the guide's two raised edges,
 * cleared so a weight hung under a car cannot drag. The lane is taken as level across (DEFAULT).
 */
export const BESTTRACK_LANE_LATERAL: LaneLateral = {
  guideRail: {
    width: sourced(inches(1.625), "MANUFACTURER", `${BESTTRACK_FAQ}: centre wheel guide 1/4 in tall by 1-5/8 in wide`),
    height: sourced(inches(0.25), "MANUFACTURER", `${BESTTRACK_FAQ}: centre wheel guide 1/4 in tall by 1-5/8 in wide`),
    clearMiddle: sourced(inches(1), "MANUFACTURER", `${BESTTRACK_FAQ}: flat centre area between the rail guides 1 in wide`),
  },
  lanePitch: sourced(inches(3.5), "MANUFACTURER", `${BESTTRACK_FAQ}: lane width 3.50 in, as is lane centre to lane centre`),
  crossSlope: sourced(0, "DEFAULT", "Level across until surveyed"),
};

/**
 * BestTrack's start pin (manufacturer drawing): vinyl-covered stainless steel, non-magnetic, standing
 * about 2 in above the lane. Its diameter and the shape of its face are not published, so the
 * starting-gate face rule stays unevaluated (RUL-007, CHAR-004).
 */
export const BESTTRACK_START_PIN = {
  height: sourced(inches(2), "MANUFACTURER", "Drawing: start pin extends about 2 in above the track surface"),
  material: "vinyl-covered stainless steel, non-magnetic",
} as const;

/**
 * BestTrack aluminium track built from the manufacturer's layout drawing and specification page.
 *
 * MANUFACTURER: a 7 ft start lane at 26 deg; a curved lane 41 in long; 7 ft straight lanes plus a
 * 40 in stop section; the start pin 8 in down the start lane from its top end; the timed distance
 * from the pin to the middle timer hole (358, 442 or 526 in).
 *
 * MANUFACTURER (FAQ): the lane, its spacing and the guide rail (BESTTRACK_LANE_LATERAL), and the start pin.

ESTIMATED: the curved lane has uniform curvature, turning 26 deg over 41 in (radius 90.35 in).
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
    lateral: BESTTRACK_LANE_LATERAL,
  };
}
