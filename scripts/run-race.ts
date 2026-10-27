// Run demo races on the estimated 35-ft BestTrack profile and print results with provenance.
// Usage: npm run race

import { toInches, toOunces } from "../src/core/units.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { NO_LOSSES } from "../src/physics/dynamics.js";
import { type RaceResult, simulateRace } from "../src/physics/race.js";
import { bestTrack35Estimated } from "../src/track/track.js";

const track = bestTrack35Estimated();
const env = DEFAULT_ENVIRONMENT;

function show(label: string, r: RaceResult): void {
  const l = r.ledger;
  const time = r.elapsedTime === null ? r.status : `${r.elapsedTime.toFixed(4)} s`;
  const speed = r.finishSpeed === null ? "-" : `${r.finishSpeed.toFixed(3)} m/s`;
  console.log(`${label.padEnd(44)} ${time.padStart(10)}  finish ${speed.padStart(10)}`);
  console.log(
    `${"".padEnd(44)} released ${l.released.toFixed(4)} J = body ${l.kineticBody.toFixed(4)} + wheels ${l.kineticWheels.toFixed(4)}` +
      ` + axle ${l.axleLoss.toFixed(4)} + rolling ${l.rollingLoss.toFixed(4)} + aero ${l.aeroLoss.toFixed(4)}` +
      `  (residual ${l.residual.toExponential(1)})`,
  );
  if (r.status !== "FINISHED") console.log(`${"".padEnd(44)} ${r.message}`);
}

console.log(`Track: ${track.name} [profile ${track.profileStatus}]`);
console.log(`  ${track.profileSource}\n`);

const base = demoCar();
console.log(`Car: ${base.name}, ${toOunces(base.mass.value).toFixed(2)} oz, weakest input provenance: ESTIMATED\n`);

show("Ideal (no losses)", simulateRace(base, track, env, { losses: NO_LOSSES }));
show("Realistic, CG 1.0 in ahead of rear axle", simulateRace(base, track, env));
for (const cgIn of [0.25, 0.5, 2.0, 3.0]) {
  const car = demoCar({ cgX: cgIn * 0.0254 });
  show(`Realistic, CG ${cgIn.toFixed(2)} in ahead of rear axle`, simulateRace(car, track, env));
}
show("Realistic, 4.0 oz", simulateRace(demoCar({ mass: 4 * 0.028349523125 }), track, env));
show("Realistic, unlubricated axles (mu 0.35)", simulateRace(demoCar({ axleFriction: 0.35 }), track, env));

const r = simulateRace(base, track, env);
console.log(`\nWheelbase ${toInches(base.wheelbase.value).toFixed(3)} in (ESTIMATED until CHAR-002).`);
console.log(`Solver ${r.record.solverVersion}, dt ${r.record.dt} s, track profile ${r.record.trackProfile}.`);
