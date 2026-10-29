// Lane profiles from a track survey (CHAR-005, TRK-003, TRK-004). See docs/track-survey.md.

import { type Provenance, type Sourced, sourced } from "../core/provenance.js";
import { M_PER_IN } from "../core/units.js";
import type { Curve } from "./curve.js";
import { type SmoothingFit, SplineSurface, fitSurveySpline } from "./spline.js";
import { TYPICAL_LANE_LATERAL, type Track } from "./track.js";

export interface SurveyStation {
  /** Horizontal distance from the survey datum, m. */
  readonly x: number;
  /** Height of the lane surface above a level reference, m. */
  readonly z: number;
}

export interface TrackSurvey {
  readonly name: string;
  /** Who measured, how, and when. */
  readonly source: string;
  /** False for synthetic surveys generated from a known profile. */
  readonly measured: boolean;
  readonly stations: readonly SurveyStation[];
  /** One-sigma uncertainty of each height and each horizontal position, m. */
  readonly sigmaZ: number;
  readonly sigmaX: number;
  /** Horizontal position of the start-pin contact plane, m. */
  readonly pinX: number;
  /** Finish sensor: either measured horizontal position, or timed distance along the lane from the pin. */
  readonly finish: { readonly x: number } | { readonly timedDistance: Sourced<number> };
}

export interface SurveyFitReport {
  readonly stations: number;
  readonly chi2PerStation: number;
  readonly straight: boolean;
  readonly rmsResidual: number;
  /** Largest standardized residual (SmoothingFit.standardized) and the station it occurs at. */
  readonly worstSigma: number;
  readonly worstX: number;
  /**
   * Threshold an error-free survey of this many stations exceeds somewhere only 5% of the time
   * (Bonferroni on Gaussian errors), and the stations above it: blunders, joint steps, or an
   * understated uncertainty.
   */
  readonly outlierThreshold: number;
  readonly outliers: readonly number[];
  /** Tightest concave and convex radii of the fitted lane, m. */
  readonly minConcaveRadius: number;
  readonly minConvexRadius: number;
  readonly dropPinToFinish: number;
}

export interface SurveyedTrack {
  readonly track: Track;
  readonly fit: SmoothingFit;
  readonly report: SurveyFitReport;
}

/** Car body length behind the pin and sensor margin the survey must cover, horizontal m. */
const COVER_BEHIND_PIN = 0.15;
const COVER_PAST_FINISH = 0.05;

export function surveyedTrack(s: TrackSurvey): SurveyedTrack {
  const xs = s.stations.map((p) => p.x);
  const zs = s.stations.map((p) => p.z);
  const fit = fitSurveySpline(xs, zs, s.sigmaZ, s.sigmaX);
  const surface = new SplineSurface(fit.spline);
  const pinS = surface.uAtX(s.pinX);

  let timedDistance: Sourced<number>;
  let finishX: number;
  if ("x" in s.finish) {
    finishX = s.finish.x;
    timedDistance = sourced(surface.uAtX(finishX) - pinS, "DERIVED", "Along the fitted lane from pin to measured finish");
  } else {
    timedDistance = s.finish.timedDistance;
    finishX = surface.at(pinS + timedDistance.value).p.x;
  }
  if (xs[0]! > s.pinX - COVER_BEHIND_PIN) {
    throw new Error(`Survey must start at least ${COVER_BEHIND_PIN} m behind the pin so the whole car sits on it`);
  }
  if (xs[xs.length - 1]! < finishX + COVER_PAST_FINISH) {
    throw new Error(`Survey must extend at least ${COVER_PAST_FINISH} m past the finish sensor`);
  }

  const z = fit.standardized;
  let worst = 0;
  z.forEach((v, i) => {
    if (Math.abs(v) > Math.abs(z[worst]!)) worst = i;
  });
  const threshold = normalQuantileUpper(0.025 / xs.length);
  const { min, max } = surface.curvatureRange();
  const fitSummary =
    `${xs.length} stations, sigma ${(s.sigmaZ * 1000).toFixed(2)} mm height / ${(s.sigmaX * 1000).toFixed(2)} mm ` +
    `horizontal, smoothing spline (UBRE), chi^2/n = ${(fit.chi2 / xs.length).toFixed(3)}, edf ${fit.edf.toFixed(1)}`;
  const report: SurveyFitReport = {
    stations: xs.length,
    chi2PerStation: fit.chi2 / xs.length,
    straight: fit.straight,
    rmsResidual: Math.sqrt(fit.residuals.reduce((a, r) => a + r * r, 0) / xs.length),
    worstSigma: Math.abs(z[worst]!),
    worstX: xs[worst]!,
    outlierThreshold: threshold,
    outliers: xs.filter((_, i) => Math.abs(z[i]!) > threshold),
    minConcaveRadius: max > 0 ? 1 / max : Infinity,
    minConvexRadius: min < 0 ? -1 / min : Infinity,
    dropPinToFinish: surface.at(pinS).p.z - surface.at(pinS + timedDistance.value).p.z,
  };
  return {
    track: {
      name: s.name,
      surface,
      profileStatus: s.measured ? "MEASURED" : "ESTIMATED",
      profileSource: `${s.source}; ${fitSummary}`,
      pinS,
      timedDistance,
      // The survey gives the lane's profile, not its rail: the common rulebook rail (ESTIMATED), as for BestTrack.
      lateral: TYPICAL_LANE_LATERAL,
    },
    fit,
    report,
  };
}

/**
 * Read a survey CSV. Metadata lines are "# key: value"; then a header "x,z"; then one station per
 * line, in the units given by "# units: in" or "mm" or "m". Keys: name, source, measured (true or
 * false), units, sigma_z, sigma_x, pin_x, and either finish_x or timed_distance (along the lane)
 * with timed_distance_provenance (default MANUFACTURER) and timed_distance_source.
 */
export function parseSurveyCsv(text: string): TrackSurvey {
  const meta = new Map<string, string>();
  const stations: SurveyStation[] = [];
  let header = false;
  let scale = 0;
  const unitScale = (u: string): number => {
    const k = { in: M_PER_IN, mm: 0.001, m: 1 }[u.trim()];
    if (k === undefined) throw new Error(`Unknown survey units "${u}" (use in, mm or m)`);
    return k;
  };
  text.split(/\r?\n/).forEach((raw, lineNo) => {
    const line = raw.trim();
    if (line === "") return;
    if (line.startsWith("#")) {
      const m = /^#\s*([a-z_]+)\s*:\s*(.*)$/.exec(line);
      if (m) meta.set(m[1]!, m[2]!.trim());
      return;
    }
    if (!header) {
      if (!/^x\s*,\s*z$/i.test(line)) throw new Error(`Line ${lineNo + 1}: expected header "x,z"`);
      header = true;
      scale = unitScale(meta.get("units") ?? "");
      return;
    }
    const parts = line.split(",").map((v) => Number(v.trim()));
    if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error(`Line ${lineNo + 1}: expected "x,z"`);
    stations.push({ x: parts[0]! * scale, z: parts[1]! * scale });
  });
  if (!header) throw new Error('Survey has no "x,z" header');
  const num = (key: string): number => {
    const v = meta.get(key);
    if (v === undefined || !Number.isFinite(Number(v))) throw new Error(`Survey needs "# ${key}: <number>"`);
    return Number(v) * scale;
  };
  let finish: TrackSurvey["finish"];
  if (meta.has("finish_x")) finish = { x: num("finish_x") };
  else {
    const prov = (meta.get("timed_distance_provenance") ?? "MANUFACTURER") as Provenance;
    finish = {
      timedDistance: sourced(num("timed_distance"), prov, meta.get("timed_distance_source") ?? "survey file"),
    };
  }
  return {
    name: meta.get("name") ?? "Surveyed track",
    source: meta.get("source") ?? "unspecified",
    measured: (meta.get("measured") ?? "true").toLowerCase() === "true",
    stations,
    sigmaZ: num("sigma_z"),
    sigmaX: meta.has("sigma_x") ? num("sigma_x") : 0,
    pinX: num("pin_x"),
    finish,
  };
}

/** z with P(Z > z) = p for a standard normal Z, by bisection on erfc. */
function normalQuantileUpper(p: number): number {
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (0.5 * erfc(mid / Math.SQRT2) > p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Complementary error function, relative error below 1.2e-7 (Numerical Recipes, 2nd ed., 6.2). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Exact heights of a known lane at horizontal positions xs: for synthetic surveys and tests. */
export function sampleLane(lane: Curve, xs: readonly number[]): SurveyStation[] {
  return xs.map((x) => {
    // x(u) increases along a lane that never turns past vertical, so bisect on it.
    let lo = -10;
    let hi = lane.length + 10;
    for (let i = 0; i < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(hi)); i++) {
      const mid = 0.5 * (lo + hi);
      if (lane.at(mid).p.x < x) lo = mid;
      else hi = mid;
    }
    return { x, z: lane.at(0.5 * (lo + hi)).p.z };
  });
}
