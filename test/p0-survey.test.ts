// TRK-003 / CHAR-005: lane profiles fitted to survey points.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import { gaussian } from "../src/core/random.js";
import { inches } from "../src/core/units.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { NO_LOSSES } from "../src/physics/dynamics.js";
import { simulateRace } from "../src/physics/race.js";
import { SplineSurface, fitSurveySpline, smooth } from "../src/track/spline.js";
import { type TrackSurvey, parseSurveyCsv, sampleLane, surveyedTrack } from "../src/track/survey.js";
import { bestTrack, finishS } from "../src/track/track.js";
import { G, testCar, testEnv } from "./helpers.js";

const range = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-12; x += step) out.push(x);
  return out;
};

/** A survey of BestTrack 35 ft at the given spacing, with optional Gaussian height noise. */
function bestTrackSurvey(spacing: number, noise = 0, seed = 1): TrackSurvey {
  const exact = bestTrack(35);
  const end = exact.surface.at(exact.surface.length).p.x;
  const rnd = gaussian(seed);
  const stations = sampleLane(exact.surface, range(0, end, spacing)).map((p) => ({ x: p.x, z: p.z + noise * rnd() }));
  return {
    name: "synthetic BestTrack survey",
    source: "test",
    measured: false,
    stations,
    sigmaZ: noise > 0 ? noise : 1e-6,
    sigmaX: 0,
    pinX: exact.surface.at(exact.pinS).p.x,
    finish: { timedDistance: exact.timedDistance },
  };
}

describe("survey spline surface", () => {
  it("reproduces a straight incline exactly, so P1 still holds (t = sqrt(2D / g sin a))", () => {
    const alpha = Math.PI / 9;
    const stations = range(0, 4, 0.1).map((x) => ({ x, z: 3 - Math.tan(alpha) * x }));
    const { track, fit } = surveyedTrack({
      name: "surveyed straight incline",
      source: "test",
      measured: false,
      stations,
      sigmaZ: 0.0005,
      sigmaX: 0.001,
      pinX: 0.5,
      finish: { timedDistance: sourced(3, "DEFAULT") },
    });
    expect(fit.straight).toBe(true);
    expect(track.surface.length).toBeCloseTo(4 / Math.cos(alpha), 12);
    const r = simulateRace(testCar(), track, testEnv(), { losses: NO_LOSSES });
    expect(r.elapsedTime!).toBeCloseTo(Math.sqrt((2 * 3) / (G * Math.sin(alpha))), 10);
  });

  it("integrates arc length to 1e-13 m (8-point Gauss-Legendre against a 64-panel reference)", () => {
    const xs = range(0, 1, 0.05);
    const zs = xs.map((x) => 0.3 * Math.sin(3 * x) - 0.5 * x);
    const s = new SplineSurface(fitSurveySpline(xs, zs, 1e-9).spline);
    const sp = s.spline;
    let ref = 0;
    for (let i = 0; i < sp.a.length; i++) {
      const h = sp.x[i + 1]! - sp.x[i]!;
      const panels = 64;
      for (let k = 0; k < panels; k++) {
        // Simpson on each panel; the integrand is smooth, so 64 panels is far beyond 1e-13.
        const f = (t: number) => Math.sqrt(1 + (sp.b[i]! + 2 * sp.c[i]! * t + 3 * sp.d[i]! * t * t) ** 2);
        const t0 = (k * h) / panels;
        const t1 = ((k + 1) * h) / panels;
        ref += ((t1 - t0) / 6) * (f(t0) + 4 * f(0.5 * (t0 + t1)) + f(t1));
      }
    }
    expect(Math.abs(s.length - ref)).toBeLessThan(1e-13);
  });

  it("returns points whose arc length round-trips through uAtX", () => {
    const { track } = surveyedTrack(bestTrackSurvey(0.05));
    const surf = track.surface as SplineSurface;
    for (const u of [0.1, 1.7, 2.3, 2.9, 5]) expect(surf.uAtX(surf.at(u).p.x)).toBeCloseTo(u, 12);
  });

  it("matches the exact BestTrack profile's race time from a noise-free survey at 20 cm or finer", () => {
    // Measured: 3.3e-7 s at 20 cm, about 1e-8 s at 10, 5 and 2.5 cm (docs/track-survey.md).
    const exact = simulateRace(demoCar(), bestTrack(35), DEFAULT_ENVIRONMENT).elapsedTime!;
    for (const [h, tol] of [[0.2, 1e-6], [0.1, 1e-7], [0.05, 1e-7]] as const) {
      const t = simulateRace(demoCar(), surveyedTrack(bestTrackSurvey(h)).track, DEFAULT_ENVIRONMENT).elapsedTime!;
      expect(Math.abs(t - exact)).toBeLessThan(tol);
    }
  });

  it("closes the energy ledger on a surveyed lane (ANA-001)", () => {
    const r = simulateRace(demoCar(), surveyedTrack(bestTrackSurvey(0.05, 0.0005)).track, DEFAULT_ENVIRONMENT, {
      traceEvery: 10,
    });
    expect(r.status).toBe("FINISHED");
    for (const s of r.trace) expect(Math.abs(s.residual)).toBeLessThan(1e-8);
  });
});

describe("survey smoothing (unbiased risk, Wahba 1990)", () => {
  it("computes tr(H) and H_ii from the inverse band exactly as brute-force unit-vector smoothing does", () => {
    const xs = range(0, 2, 0.07).map((x, i) => x + 0.01 * Math.sin(i));
    const sig = xs.map((_, i) => 0.0005 * (1 + 0.3 * Math.cos(i)));
    for (const alpha of [1e-9, 1e-6, 1e-3]) {
      const fast = smooth(xs, xs.map(() => 0), sig, alpha, true);
      let trace = 0;
      xs.forEach((_, i) => {
        const hii = smooth(xs, xs.map((_, j) => (j === i ? 1 : 0)), sig, alpha).g[i]!;
        trace += hii;
        expect(fast.leverage![i]!).toBeCloseTo(hii, 10);
      });
      expect(fast.edf).toBeCloseTo(trace, 9);
    }
  });

  it("fits noisy stations to their stated uncertainty and lands closer to the truth than the data", () => {
    const sigma = 0.0005;
    const survey = bestTrackSurvey(0.025, sigma, 1);
    const { fit, report } = surveyedTrack(survey);
    // With the right uncertainty, chi^2 is expected near n - edf.
    expect(Math.abs(fit.chi2 - (report.stations - fit.edf))).toBeLessThan(3 * Math.sqrt(2 * report.stations));
    const truth = sampleLane(bestTrack(35).surface, survey.stations.map((p) => p.x));
    const surf = new SplineSurface(fit.spline);
    const err = truth.map((p) => surf.at(surf.uAtX(p.x)).p.z - p.z);
    const rms = Math.sqrt(err.reduce((a, e) => a + e * e, 0) / err.length);
    expect(rms).toBeLessThan(0.6 * sigma);
    expect(report.outliers).toEqual([]);
  });

  it("flags a 3 mm blunder as an outlier", () => {
    const survey = bestTrackSurvey(0.05, 0.0005, 3);
    const stations = survey.stations.map((p, i) => (i === 40 ? { x: p.x, z: p.z + 0.003 } : p));
    const { report } = surveyedTrack({ ...survey, stations });
    // 207 stations: 5% family-wise threshold Phi^-1(1 - 0.025 / 207) = 3.671.
    expect(report.outlierThreshold).toBeCloseTo(3.671, 3);
    // The blunder is the worst station; a neighbour it drags may also be flagged until it is removed.
    expect(report.worstX).toBe(stations[40]!.x);
    expect(report.outliers).toContain(stations[40]!.x);
    const { report: refit } = surveyedTrack({ ...survey, stations: stations.filter((_, i) => i !== 40) });
    expect(refit.outliers).toEqual([]);
  });

  it("flags a genuine 3.9-sigma draw in the simulated noise (seed 7, x = 4.6 m), as a 5% test should", () => {
    const { report } = surveyedTrack(bestTrackSurvey(0.025, 0.0005, 7));
    expect(report.outliers.map((x) => x.toFixed(3))).toEqual(["4.600"]);
  });

  it("rejects a lane with a dip too tight for the wheel", () => {
    const stations = range(0, 1, 0.005).map((x) => ({ x, z: 0.004 * Math.exp(-(((x - 0.5) / 0.004) ** 2)) * -1 }));
    expect(() =>
      simulateRace(
        testCar(),
        surveyedTrack({
          name: "dip",
          source: "test",
          measured: false,
          stations,
          sigmaZ: 1e-6,
          sigmaX: 0,
          pinX: 0.2,
          finish: { x: 0.8 },
        }).track,
        testEnv(),
      ),
    ).toThrow(/cannot follow/);
  });
});

describe("survey file", () => {
  it("reads metadata and stations in inches, and labels the profile MEASURED (TRK-004)", () => {
    const exact = bestTrack(35);
    const end = exact.surface.at(exact.surface.length).p.x;
    const rows = sampleLane(exact.surface, range(0, end, inches(2))).map(
      (p) => `${(p.x / inches(1)).toFixed(4)},${(p.z / inches(1)).toFixed(4)}`,
    );
    const pinX = exact.surface.at(exact.pinS).p.x / inches(1);
    const csv = [
      "# name: Test hall, lane 1",
      "# source: synthetic file for the parser test",
      "# measured: true",
      "# units: in",
      "# sigma_z: 0.02",
      "# sigma_x: 0.04",
      `# pin_x: ${pinX.toFixed(4)}`,
      "# timed_distance: 358",
      "# timed_distance_source: https://www.besttrack.com/track_specs.html",
      "x,z",
      ...rows,
    ].join("\n");
    const survey = parseSurveyCsv(csv);
    expect(survey.stations.length).toBe(rows.length);
    expect(survey.sigmaZ).toBeCloseTo(inches(0.02), 15);
    const { track, report } = surveyedTrack(survey);
    expect(track.profileStatus).toBe("MEASURED");
    expect(track.timedDistance.provenance).toBe("MANUFACTURER");
    expect(finishS(track) - track.pinS).toBeCloseTo(inches(358), 12);
    expect(report.outliers).toEqual([]);
  });
});
