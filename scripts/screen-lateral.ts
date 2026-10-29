// Lateral dynamics and guide-rail contact (P6, P7) against the Duke experiment (VAL-001;
// docs/validation.md, section 7). Their car's alignment is not published, so each plausible kind of
// misalignment is raced as given, nothing fitted: front toe, rear toe, and a car set down crooked at
// the gate. For each: the Table 2 car's time, the mass and CG effects, and chi² over Fig. 12.
// Usage: npm run screen:lateral

import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import type { CarSpec } from "../src/physics/car.js";
import type { LateralCarSpec } from "../src/physics/lateral.js";
import { type RaceResult, simulateRace } from "../src/physics/race.js";
import { TYPICAL_LANE_LATERAL } from "../src/track/track.js";
import {
  MANN_2012_FIG12 as FIG12,
  MANN_2012_TABLE2 as T2,
  type Mann2012CarOptions,
  mann2012Car,
  mann2012Environment,
  mann2012Track,
} from "../src/validation/mann2012.js";

const track = { ...mann2012Track(), lateral: TYPICAL_LANE_LATERAL };
const env = mann2012Environment();
// 0.5 ms: within 0.2 ms of the converged time for a car that strikes and rides the rail (test/p6-p7).
const OPTS = { dt: 5e-4, traceEvery: 1_000_000 };
const READING = 0.005;

const est = (x: number, why: string) => sourced(x, "ESTIMATED", why);

interface Alignment {
  readonly label: string;
  readonly toeF?: number;
  readonly toeR?: number;
  readonly heading?: number;
  readonly muT?: number;
  readonly muC?: number;
  readonly e?: number;
}

function lateral(a: Alignment): LateralCarSpec {
  // Their I_G is pitch; a 7 in x 1.75 in body about 30 mm tall has I_zz about 3 % larger.
  const L = inches(7);
  const W = inches(1.75);
  const H = 0.03;
  return {
    yawInertia: est((T2.pitchInertia * (L * L + W * W)) / (L * L + H * H), "Table 2 I_G scaled to yaw for a 7 x 1.75 x 1.2 in body"),
    cgOffset: est(0, "Centred"),
    insideWheelSpacing: est(inches(1.81), "Kit body width plus typical wheel-body gaps"),
    toe: { rear: est(a.toeR ?? 0, "Swept"), front: est(a.toeF ?? 0, "Swept") },
    treadFriction: est(a.muT ?? 0.35, "Hard plastic on the lane: guess"),
    railFriction: est(a.muC ?? 0.3, "Plastic wheel face on the rail, no graphite (their races): guess"),
    railRestitution: est(a.e ?? 0.5, "Plastic on the rail: guess"),
    start: { offset: est(0, "Centred at the gate"), heading: est(a.heading ?? 0, "Swept") },
  };
}

const car = (o: Mann2012CarOptions, a: Alignment): CarSpec => ({ ...mann2012Car(o), lateral: lateral(a) });

function race(o: Mann2012CarOptions, a: Alignment): RaceResult {
  const r = simulateRace(car(o, a), track, env, OPTS);
  if (r.elapsedTime === null) throw new Error(`${a.label}: ${r.status}: ${r.message}`);
  return r;
}

const massPts = FIG12.mass;
const cgPts = FIG12.xBar;
const MEASURED_MASS = massPts[3]!.time - massPts[0]!.time;
const MEASURED_CG = cgPts[4]!.time - cgPts[0]!.time;
const ms = (x: number): string => `${(1000 * x).toFixed(1)} ms`;

function evaluate(a: Alignment): void {
  const mt = massPts.map((p) => race({ mass: p.x }, a).elapsedTime!);
  const ct = cgPts.map((p) => race({ xBar: p.x }, a).elapsedTime!);
  const r = (t: number, p: { time: number; errorBar: number }): number => (t - p.time) / Math.hypot(p.errorBar, READING);
  const chi2 = [...mt.map((t, i) => r(t, massPts[i]!)), ...ct.map((t, i) => r(t, cgPts[i]!))].reduce((s, x) => s + x * x, 0);
  const base = race({}, a);
  const L = base.ledger;
  const pct = (x: number): string => `${((100 * x) / L.released).toFixed(1)} %`;
  console.log(
    [
      a.label.padEnd(38),
      `mass ${ms(mt[3]! - mt[0]!).padStart(9)}`,
      `CG ${ms(ct[4]! - ct[0]!).padStart(9)}`,
      `Table 2 ${base.elapsedTime!.toFixed(3)} s`,
      `chi² ${chi2.toFixed(0).padStart(5)}`,
      `rail ${pct(L.railFrictionLoss + L.railImpactLoss)}, scrub ${pct(L.treadLoss)}, hops ${base.hops.count}`,
    ].join("  "),
  );
}

console.log(`Measured: mass effect ${ms(MEASURED_MASS)}, CG effect ${ms(MEASURED_CG)}; Table 2 car about 2.25-2.27 s.\n`);
const cases: Alignment[] = [
  { label: "Aligned (planar result)" },
  ...[1, 2, 4, 8].map((m) => ({ label: `Front toe ${m} mrad`, toeF: m / 1000 })),
  ...[2, 4, 8].map((m) => ({ label: `Rear toe ${m} mrad`, toeR: m / 1000 })),
  ...[5, 10, 20].map((m) => ({ label: `Set down ${m} mrad crooked, square axles`, heading: m / 1000 })),
  { label: "Front toe 4 mrad, rail friction 0.15", toeF: 0.004, muC: 0.15 },
  { label: "Front toe 4 mrad, tread friction 0.6", toeF: 0.004, muT: 0.6 },
  { label: "Crooked 10 mrad, restitution 0.8", heading: 0.01, e: 0.8 },
];
for (const c of cases) evaluate(c);

// Joint search over the unknowns, inside plausible ranges: front toe, rail friction (graphite on the
// faces can bring it well down), restitution and how crooked the car was set down. Ten data points
// against four parameters: a good chi² here would say the class can explain the data, not that it does.
if (process.argv.includes("--search")) {
  const coarse = { dt: 1e-3, traceEvery: 1_000_000 };
  const scored: { a: Alignment; chi2: number }[] = [];
  for (const toeF of [0, 0.5e-3, 1e-3, 2e-3, 4e-3])
    for (const muC of [0.02, 0.05, 0.1, 0.2])
      for (const e of [0.3, 0.6, 0.9])
        for (const heading of [0, 5e-3, 10e-3]) {
          const a: Alignment = { label: `toe ${toeF * 1e3} mrad, mu_c ${muC}, e ${e}, crooked ${heading * 1e3} mrad`, toeF, muC, e, heading };
          const t = (o: Mann2012CarOptions): number | null => simulateRace(car(o, a), track, env, coarse).elapsedTime;
          let chi2 = 0;
          for (const [pts, key] of [[massPts, "mass"], [cgPts, "xBar"]] as const)
            for (const p of pts) {
              const x = t({ [key]: p.x });
              chi2 += x === null ? Infinity : ((x - p.time) / Math.hypot(p.errorBar, READING)) ** 2;
            }
          scored.push({ a, chi2 });
        }
  scored.sort((p, q) => p.chi2 - q.chi2);
  console.log(`\nJoint search (${scored.length} combinations, 1 ms steps); best five, re-raced at 0.5 ms:`);
  for (const s of scored.slice(0, 5)) evaluate(s.a);
}
