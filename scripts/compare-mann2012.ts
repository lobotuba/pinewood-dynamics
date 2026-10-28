// Compare the solver with the published Duke experiment (Mann, Gibbs and Sah 2012, Fig. 12).
// Usage: npm run compare:mann2012

import { simulateRace } from "../src/physics/race.js";
import {
  MANN_2012_CITATION,
  MANN_2012_FIG12,
  type Mann2012CarOptions,
  type MeasuredPoint,
  mann2012Car,
  mann2012Environment,
  mann2012Track,
} from "../src/validation/mann2012.js";

const track = mann2012Track();
const env = mann2012Environment();
const time = (o: Mann2012CarOptions): number => {
  const r = simulateRace(mann2012Car(o), track, env);
  if (r.elapsedTime === null) throw new Error(`${r.status}: ${r.message}`);
  return r.elapsedTime;
};

function table(title: string, unit: string, pts: readonly MeasuredPoint[], opts: (x: number) => Mann2012CarOptions): void {
  console.log(`\n${title}`);
  console.log(`  ${unit.padEnd(10)} measured          predicted  diff      d(measured)  d(predicted)`);
  const pred = pts.map((p) => time(opts(p.x)));
  pts.forEach((p, i) => {
    const d = pred[i]! - p.time;
    const dm = p.time - pts[0]!.time;
    const dp = pred[i]! - pred[0]!;
    console.log(
      `  ${p.x.toFixed(4).padEnd(10)} ${p.time.toFixed(3)} +- ${p.errorBar.toFixed(3)}   ${pred[i]!.toFixed(4)}    ${(d >= 0 ? "+" : "") + d.toFixed(4)}   ` +
        `${dm.toFixed(3).padStart(7)}      ${dp.toFixed(4).padStart(7)}`,
    );
  });
}

console.log(`Comparison with ${MANN_2012_CITATION}`);
console.log(`Track: ${track.name}; timed distance ${track.timedDistance.value.toFixed(3)} m`);
const top = track.surface.at(track.pinS).p.z;
console.log(`Start height of pin plane above flat: ${top.toFixed(3)} m (paper d = 1.17 m)`);
console.log(`Table 2 car: ${time({}).toFixed(4)} s`);

table("Fig. 12a: varying mass (Table 2 CG)", "mass kg", MANN_2012_FIG12.mass, (x) => ({ mass: x }));
table("Fig. 12b: varying CG (Table 2 mass)", "xBar m", MANN_2012_FIG12.xBar, (x) => ({ xBar: x }));
