// Screen candidate loss mechanisms against the Duke experiment (VAL-001; docs/validation.md, 5).
// Each mechanism is a physical force law with its own parameter. The script asks how large the
// parameter must be to reproduce the measured mass or CG effect, and what that value then implies
// for the other sweep, the overall level and the paper's own bench measurements.
// Usage: npm run screen:mann2012

import { sourced } from "../src/core/provenance.js";
import type { CarSpec } from "../src/physics/car.js";
import { solveLinear } from "../src/physics/dynamics.js";
import { simulateRace } from "../src/physics/race.js";
import {
  MANN_2012_FIG12 as FIG12,
  MANN_2012_TABLE2 as T2,
  type Mann2012CarOptions,
  mann2012Car,
  mann2012Environment,
  mann2012Track,
} from "../src/validation/mann2012.js";

const track = mann2012Track();
const env = mann2012Environment();
// 2 ms RK4 steps reproduce the 0.1 ms result to 1 ns on this track; the screen needs thousands of races.
const OPTS = { dt: 2e-3, traceEvery: 1_000_000 };
const READING = 0.005; // s, our by-eye reading of Fig. 12

interface Mechanisms {
  /** Coulomb coefficient on both axles (Table 2: 0.167). */
  readonly mu: number;
  /** Extra coefficient on the front axle only. */
  readonly frontExtra: number;
  /** Load-independent hub drag per axle, N m. */
  readonly hub: number;
  /** Multiplier on Table 2's drag area. */
  readonly aero: number;
  /** Friction force ~ load^exponent, coefficient mu at one wheel's weight (the spin-down load). */
  readonly exponent: number;
}
const TABLE2: Mechanisms = { mu: T2.muK, frontExtra: 0, hub: 0, aero: 1, exponent: 1 };

const SPIN_DOWN_LOAD = T2.wheelMass * T2.g; // N per wheel: the bore load in their spin test
/** The paper's spin test measures every bore torque at that load, so hub drag cannot exceed it. */
const HUB_BOUND = 2 * T2.muK * SPIN_DOWN_LOAD * T2.axleRadius; // N m per axle

const s = (x: number): ReturnType<typeof sourced<number>> => sourced(x, "ESTIMATED", "Mechanism screen");

function car(o: Mann2012CarOptions, m: Mechanisms): CarSpec {
  const c = mann2012Car(o);
  const law = m.exponent === 1 ? undefined : { exponent: s(m.exponent), referenceLoad: s(SPIN_DOWN_LOAD) };
  const axle = (a: CarSpec["rear"], mu: number): CarSpec["rear"] => ({
    ...a,
    axleFriction: s(mu),
    hubDrag: s(m.hub),
    ...(law ? { frictionLaw: law } : {}),
  });
  return {
    ...c,
    dragArea: s(c.dragArea.value * m.aero),
    rear: axle(c.rear, m.mu),
    front: axle(c.front, m.mu + m.frontExtra),
  };
}

function time(o: Mann2012CarOptions, m: Mechanisms): number {
  const r = simulateRace(car(o, m), track, env, OPTS);
  if (r.elapsedTime === null) throw new Error(`${r.status}: ${r.message}`);
  return r.elapsedTime;
}

const massPts = FIG12.mass;
const cgPts = FIG12.xBar;
const massEffect = (m: Mechanisms): number => time({ mass: massPts[3]!.x }, m) - time({ mass: massPts[0]!.x }, m);
const cgEffect = (m: Mechanisms): number => time({ xBar: cgPts[4]!.x }, m) - time({ xBar: cgPts[0]!.x }, m);
const MEASURED_MASS = massPts[3]!.time - massPts[0]!.time;
const MEASURED_CG = cgPts[4]!.time - cgPts[0]!.time;

/** All ten Fig. 12 points: residual / sigma, with our reading uncertainty added in quadrature. */
function residuals(m: Mechanisms): number[] {
  const r = (t: number, p: { time: number; errorBar: number }): number => (t - p.time) / Math.hypot(p.errorBar, READING);
  return [...massPts.map((p) => r(time({ mass: p.x }, m), p)), ...cgPts.map((p) => r(time({ xBar: p.x }, m), p))];
}
const chi2 = (m: Mechanisms): number => residuals(m).reduce((a, x) => a + x * x, 0);

/** Root of f on [lo, hi] by bisection; null if f does not change sign. */
function solve(f: (x: number) => number, lo: number, hi: number): number | null {
  let flo = f(lo);
  if (flo * f(hi) > 0) return null;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (fm * flo <= 0) hi = mid;
    else [lo, flo] = [mid, fm];
  }
  return 0.5 * (lo + hi);
}

const ms = (x: number): string => `${(1000 * x).toFixed(1)} ms`;
const line = (label: string, m: Mechanisms, extra = ""): void =>
  console.log(
    `  ${label.padEnd(44)} mass ${ms(massEffect(m)).padStart(9)}   CG ${ms(cgEffect(m)).padStart(9)}   ` +
      `Table 2 car ${time({}, m).toFixed(3)} s   chi2 ${chi2(m).toFixed(0).padStart(4)}${extra}`,
  );

console.log("Mechanism screen against Mann, Gibbs and Sah (2012), Fig. 12");
console.log(`Measured: mass 0.167 -> 0.26 kg ${ms(MEASURED_MASS)};  CG 65 -> 133 mm behind nose ${ms(MEASURED_CG)}.`);
console.log("chi2 over all 10 points (published error bar and 5 ms reading error in quadrature).\n");

console.log("1. Planar model as published");
line("Table 2 values", TABLE2);
line("  no aero drag", { ...TABLE2, aero: 0 });
line("  no aero drag, no axle friction", { ...TABLE2, aero: 0, mu: 0 });
console.log("  With aero off, scaling the car's mass and every inertia together leaves the time unchanged");
console.log("  (test/p6-mechanisms.test.ts). So any mass effect needs a force that does not scale with weight");
console.log("  or an inertia ratio that changes; here that is the fixed wheels and the air.\n");

console.log("2. Load-independent hub drag (hub rub with fixed preload, seal, viscous film)");
console.log(`  The spin-down test bounds it at ${HUB_BOUND.toExponential(2)} N m per axle (all of mu_k counted as hub drag).`);
line("at the spin-down bound", { ...TABLE2, hub: HUB_BOUND });
const hubNeeded = solve((h) => massEffect({ ...TABLE2, hub: h }) - MEASURED_MASS, 0, 40 * HUB_BOUND);
if (hubNeeded !== null)
  line("sized to the measured mass effect", { ...TABLE2, hub: hubNeeded }, `   (${(hubNeeded / HUB_BOUND).toFixed(0)}x the bound)`);

console.log("\n3. Load-dependent axle friction, anchored at the spin-down load");
for (const n of [2 / 3, 1 / 3]) line(`force ~ load^${n.toFixed(2)}`, { ...TABLE2, exponent: n });

console.log("\n4. Aerodynamic drag larger than Table 2");
const aeroNeeded = solve((k) => massEffect({ ...TABLE2, aero: k }) - MEASURED_MASS, 1, 30);
if (aeroNeeded !== null) line(`C_D A x ${aeroNeeded.toFixed(1)}, sized to the mass effect`, { ...TABLE2, aero: aeroNeeded });

console.log("\n5. Extra friction on the front axle only");
const frontNeeded = solve((d) => cgEffect({ ...TABLE2, frontExtra: d }) - MEASURED_CG, 0, 0.5);
if (frontNeeded !== null)
  line(`front mu + ${frontNeeded.toFixed(3)}, sized to the CG effect`, { ...TABLE2, frontExtra: frontNeeded });

// 6. Joint fit: Levenberg-Marquardt over (mu, frontExtra, hub), each kept >= 0.
console.log("\n6. Joint fit of mu, front extra and hub drag to all ten points");
type P = [number, number, number];
const mech = (p: P): Mechanisms => ({ ...TABLE2, mu: p[0], frontExtra: p[1], hub: p[2] });
const scales: P = [0.01, 0.01, HUB_BOUND];
let p: P = [T2.muK, 0, 0];
let r = residuals(mech(p));
let lambda = 1e-2;
for (let it = 0; it < 30; it++) {
  const J = scales.map((h, j) => {
    const q = [...p] as P;
    q[j] = q[j]! + h;
    return residuals(mech(q)).map((x, i) => (x - r[i]!) / h);
  });
  const JtJ = J.map((a) => J.map((b) => a.reduce((acc, x, i) => acc + x * b[i]!, 0)));
  const Jtr = J.map((a) => a.reduce((acc, x, i) => acc + x * r[i]!, 0));
  const A = JtJ.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lambda) : x)));
  const step = solveLinear(A, Jtr);
  const q = p.map((x, j) => Math.max(0, x - step[j]!)) as P;
  const rq = residuals(mech(q));
  const c0 = r.reduce((a, x) => a + x * x, 0);
  const c1 = rq.reduce((a, x) => a + x * x, 0);
  if (c1 < c0) {
    const done = c0 - c1 < 1e-6 * c0;
    [p, r, lambda] = [q, rq, lambda / 3];
    if (done) break;
  } else lambda *= 4;
}
const best = mech(p);
line("best fit", best);
console.log(
  `  mu ${p[0].toFixed(3)}  front extra ${p[1].toFixed(3)}  hub ${p[2].toExponential(2)} N m per axle ` +
    `(${(p[2] / HUB_BOUND).toFixed(0)}x the spin-down bound); 7 degrees of freedom`,
);
console.log("  point   measured  fitted   residual/sigma");
const all = [...massPts.map((q) => ({ o: { mass: q.x }, q, l: `${q.x.toFixed(3)} kg` })), ...cgPts.map((q) => ({ o: { xBar: q.x }, q, l: `${(1000 * q.x).toFixed(0)} mm` }))];
all.forEach(({ o, q, l }, i) => console.log(`  ${l.padEnd(9)} ${q.time.toFixed(3)}    ${time(o, best).toFixed(3)}    ${r[i]!.toFixed(2)}`));

