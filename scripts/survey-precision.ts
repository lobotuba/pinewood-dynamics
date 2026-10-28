// How precisely must a track be surveyed? Synthetic surveys of a known lane (BestTrack 35 ft from the
// drawing) with seeded measurement noise, fitted and raced, against the race time on the exact lane.
// Usage: npm run survey:precision

import { gaussian } from "../src/core/random.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { simulateRace } from "../src/physics/race.js";
import { sampleLane, surveyedTrack } from "../src/track/survey.js";
import { bestTrack } from "../src/track/track.js";

const SEEDS = 8;
const exact = bestTrack(35);
const car = demoCar();
const tExact = simulateRace(car, exact, DEFAULT_ENVIRONMENT).elapsedTime!;
const end = exact.surface.at(exact.surface.length).p.x;
const pinX = exact.surface.at(exact.pinS).p.x;

interface Case {
  readonly label: string;
  readonly spacing: number;
  readonly sigmaZ: number;
  readonly sigmaX: number;
  /** One-sigma error in locating the pin horizontally, m. */
  readonly sigmaPin: number;
}

function run(c: Case, seed: number): number {
  const rnd = gaussian(seed);
  const xs: number[] = [];
  for (let x = 0; x <= end + 1e-12; x += c.spacing) xs.push(x);
  // A station is placed at a mis-measured x; its height is read at the true x.
  const truth = sampleLane(exact.surface, xs);
  const stations = truth.map((p) => ({ x: p.x + c.sigmaX * rnd(), z: p.z + c.sigmaZ * rnd() }));
  stations.sort((a, b) => a.x - b.x);
  const { track } = surveyedTrack({
    name: c.label,
    source: "synthetic",
    measured: false,
    stations,
    sigmaZ: Math.max(c.sigmaZ, 1e-6),
    sigmaX: c.sigmaX,
    pinX: pinX + c.sigmaPin * rnd(),
    finish: { timedDistance: exact.timedDistance },
  });
  return simulateRace(car, track, DEFAULT_ENVIRONMENT).elapsedTime! - tExact;
}

const cases: Case[] = [];
for (const spacing of [0.025, 0.05, 0.1]) {
  for (const sigmaZ of [0.00025, 0.0005, 0.001, 0.002]) {
    cases.push({ label: `${spacing * 1000} mm spacing, sigma_z ${sigmaZ * 1000} mm`, spacing, sigmaZ, sigmaX: 0, sigmaPin: 0 });
  }
}
for (const sigmaX of [0.001, 0.003]) {
  cases.push({ label: `50 mm spacing, sigma_z 0.5 mm, sigma_x ${sigmaX * 1000} mm`, spacing: 0.05, sigmaZ: 0.0005, sigmaX, sigmaPin: 0 });
}
for (const sigmaPin of [0.001, 0.003, 0.01]) {
  cases.push({ label: `pin located to ${sigmaPin * 1000} mm (exact lane)`, spacing: 0.05, sigmaZ: 0, sigmaX: 0, sigmaPin });
}

console.log(`Exact lane: ${tExact.toFixed(5)} s. ${SEEDS} seeds per case. Errors in ms.\n`);
console.log(`${"case".padEnd(48)} mean    sd      max|e|`);
for (const c of cases) {
  const e = Array.from({ length: SEEDS }, (_, i) => run(c, 1000 + i) * 1000);
  const mean = e.reduce((a, b) => a + b, 0) / e.length;
  const sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / (e.length - 1));
  const max = Math.max(...e.map(Math.abs));
  console.log(`${c.label.padEnd(48)} ${mean.toFixed(3).padStart(6)}  ${sd.toFixed(3).padStart(6)}  ${max.toFixed(3).padStart(6)}`);
}
