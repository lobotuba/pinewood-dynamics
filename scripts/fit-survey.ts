// Fit a track survey file and race the demo car on it (CHAR-005; docs/track-survey.md).
// Usage: npm run survey -- path/to/survey.csv

import { readFileSync } from "node:fs";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { simulateRace } from "../src/physics/race.js";
import { parseSurveyCsv, surveyedTrack } from "../src/track/survey.js";
import { bestTrack } from "../src/track/track.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run survey -- path/to/survey.csv");
  process.exit(1);
}

const survey = parseSurveyCsv(readFileSync(file, "utf8"));
const { track, report, fit } = surveyedTrack(survey);
const mm = (m: number): string => `${(m * 1000).toFixed(2)} mm`;

console.log(`${track.name} [profile ${track.profileStatus}]`);
console.log(`  ${track.profileSource}`);
console.log(`\nFit`);
console.log(`  stations              ${report.stations}`);
console.log(`  chi^2 / n             ${report.chi2PerStation.toFixed(3)}  (expected about ${(1 - fit.edf / report.stations).toFixed(3)})`);
console.log(`  rms residual          ${mm(report.rmsResidual)}`);
console.log(`  worst station         x = ${report.worstX.toFixed(4)} m, ${report.worstSigma.toFixed(2)} sigma`);
console.log(`  outlier threshold     ${report.outlierThreshold.toFixed(2)} sigma`);
if (report.outliers.length > 0) {
  console.log(`  OUTLIERS at x = ${report.outliers.map((x) => x.toFixed(4)).join(", ")} m`);
  console.log("    Re-measure the worst one first, then refit: one bad station can drag its neighbours over the line.");
}
if (report.chi2PerStation > 1.5) {
  console.log("  chi^2 is well above its expected value: the stated sigma_z / sigma_x are probably too small.");
}
console.log(`  tightest concave      ${report.minConcaveRadius.toFixed(3)} m radius`);
console.log(`  tightest convex       ${report.minConvexRadius.toFixed(3)} m radius`);
console.log(`  drop pin to finish    ${report.dropPinToFinish.toFixed(4)} m`);
console.log(`  timed distance        ${track.timedDistance.value.toFixed(4)} m [${track.timedDistance.provenance}]`);

const car = demoCar();
const measured = simulateRace(car, track, DEFAULT_ENVIRONMENT);
const drawing = simulateRace(car, bestTrack(35), DEFAULT_ENVIRONMENT);
const show = (t: number | null): string => (t === null ? "no finish" : `${t.toFixed(4)} s`);
console.log(`\nDemo car (${car.name})`);
console.log(`  on this survey               ${show(measured.elapsedTime)}  ${measured.status === "FINISHED" ? "" : measured.message}`);
console.log(`  on BestTrack 35 ft drawing   ${show(drawing.elapsedTime)}`);
