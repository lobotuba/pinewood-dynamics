// Lateral dynamics and guide-rail contact (P6, P7) against the Duke experiment (VAL-001;
// docs/validation.md, section 7). Their car's alignment is not published, so each plausible kind of
// misalignment is raced as given, nothing fitted: front toe, rear toe, and a car set down crooked at
// the gate. Then camber, with the thrust faces that take each wheel's axial load (docs/validation.md,
// section 8). For each: the Table 2 car's time, the mass and CG effects, and chi² over Fig. 12.
// Usage: npm run screen:lateral [-- --search [--play <mm>]]

import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import type { CarSpec, ThrustFace } from "../src/physics/car.js";
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
  /** Camber of both axles, rad, positive tops out; or of the rear and front separately. */
  readonly camber?: number | readonly [number, number];
  /** Friction at the thrust faces (axle heads and body). Omitted: frictionless, as in section 7. */
  readonly faces?: boolean;
  /** Axial play of every wheel, m, the hub's restitution on its faces, and where the wheels start (fraction of the play out). */
  readonly play?: number;
  readonly playE?: number;
  readonly playStart?: number;
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
    ...(a.camber === undefined
      ? {}
      : {
          camber: {
            rear: est(typeof a.camber === "number" ? a.camber : a.camber[0], "Swept"),
            front: est(typeof a.camber === "number" ? a.camber : a.camber[1], "Swept"),
            treadWidth: est(inches(0.3), "Kit wheel tread width"),
          },
        }),
    ...(a.play === undefined
      ? {}
      : {
          play: {
            rear: est(a.play, "Swept"),
            front: est(a.play, "Swept"),
            restitution: est(a.playE ?? 0.3, "Plastic hub on a steel head or painted wood: guess"),
            start: est(a.playStart ?? 0.5, "Swept"),
          },
        }),
  };
}

// Effective friction radius of a uniformly loaded annulus.
const annulus = (ri: number, ro: number): number => ((2 / 3) * (ro ** 3 - ri ** 3)) / (ro ** 2 - ri ** 2);
const SHANK = inches(0.087) / 2;
const face = (radius: number, mu: number, why: string): ThrustFace => ({ radius: est(radius, why), friction: est(mu, why) });

function car(o: Mann2012CarOptions, a: Alignment): CarSpec {
  const base = mann2012Car(o);
  if (!a.faces) return { ...base, lateral: lateral(a) };
  const faces = {
    // Steel nail head on the plastic hub: the bore's own pair, so its measured coefficient.
    head: face(annulus(SHANK, inches(0.19) / 2), base.rear.axleFriction.value, "Nail head 0.19 in on the hub, mu_k of Table 2"),
    // Plastic hub boss on the painted body.
    body: face(annulus(SHANK, inches(0.3) / 2), 0.35, "Hub boss 0.3 in on painted wood: guess"),
  };
  return { ...base, rear: { ...base.rear, thrustFaces: faces }, front: { ...base.front, thrustFaces: faces }, lateral: lateral(a) };
}

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
      `rail ${pct(L.railFrictionLoss + L.railImpactLoss)}, scrub ${pct(L.treadLoss)}, faces ${pct(L.thrustLoss)}, hops ${base.hops.count}` +
        (a.play === undefined ? "" : `, hubs ${pct(L.stopImpactLoss + L.boreSlideLoss)}`),
    ].join("  "),
  );
}

const mm = 1e-3;
const playArg = process.argv.indexOf("--play");
const searchPlay = playArg >= 0 ? Number(process.argv[playArg + 1]) * mm : undefined;
const tables = searchPlay === undefined;
if (tables) console.log(`Measured: mass effect ${ms(MEASURED_MASS)}, CG effect ${ms(MEASURED_CG)}; Table 2 car about 2.25-2.27 s.\n`);
const cases: Alignment[] = [
  { label: "Aligned (planar result)" },
  ...[1, 2, 4, 8].map((m) => ({ label: `Front toe ${m} mrad`, toeF: m / 1000 })),
  ...[2, 4, 8].map((m) => ({ label: `Rear toe ${m} mrad`, toeR: m / 1000 })),
  ...[5, 10, 20].map((m) => ({ label: `Set down ${m} mrad crooked, square axles`, heading: m / 1000 })),
  { label: "Front toe 4 mrad, rail friction 0.15", toeF: 0.004, muC: 0.15 },
  { label: "Front toe 4 mrad, tread friction 0.6", toeF: 0.004, muT: 0.6 },
  { label: "Crooked 10 mrad, restitution 0.8", heading: 0.01, e: 0.8 },
];
if (tables) for (const c of cases) evaluate(c);

// Camber, with friction at the faces that hold each wheel along its axle. Three degrees is the usual
// bend in a canted axle.
const deg3 = (3 * Math.PI) / 180;
if (tables) console.log("\nWith thrust-face friction, and camber (positive tops out):");
const cambered: Alignment[] = [
  { label: "Aligned, faces", faces: true },
  { label: "Front toe 4 mrad, faces", toeF: 0.004, faces: true },
  { label: "Front toe 4 mrad, tops out 3 deg", toeF: 0.004, camber: deg3, faces: true },
  { label: "Front toe 4 mrad, tops in 3 deg", toeF: 0.004, camber: -deg3, faces: true },
  { label: "Front toe 4 mrad, rear tops in, front out", toeF: 0.004, camber: [-deg3, deg3], faces: true },
  { label: "Tops out 3 deg, square axles", camber: deg3, faces: true },
  { label: "Tops in 3 deg, square axles", camber: -deg3, faces: true },
  { label: "Crooked 10 mrad, tops out 3 deg", heading: 0.01, camber: deg3, faces: true },
  { label: "Crooked 10 mrad, tops in 3 deg", heading: 0.01, camber: -deg3, faces: true },
];
if (tables) for (const c of cambered) evaluate(c);

// Axial play: the wheels slide along their axles between the body and the heads (docs/validation.md,
// section 9). 1/32 in is a common setting; the gate position of the wheels is unknown, so it is swept.
if (tables) console.log("\nWith axial play (and thrust-face friction):");
const played: Alignment[] = [
  { label: "Aligned, play 0.8 mm", faces: true, play: 0.8 * mm },
  { label: "Front toe 4 mrad, play 0.8 mm", toeF: 0.004, faces: true, play: 0.8 * mm },
  { label: "Front toe 4 mrad, play 0.8 mm, wheels in", toeF: 0.004, faces: true, play: 0.8 * mm, playStart: 0 },
  { label: "Front toe 4 mrad, play 0.8 mm, wheels out", toeF: 0.004, faces: true, play: 0.8 * mm, playStart: 1 },
  { label: "Front toe 4 mrad, play 0.8 mm, hub e 0.6", toeF: 0.004, faces: true, play: 0.8 * mm, playE: 0.6 },
  { label: "Front toe 4 mrad, play 2 mm", toeF: 0.004, faces: true, play: 2 * mm },
  { label: "Front toe 1 mrad, play 0.8 mm", toeF: 0.001, faces: true, play: 0.8 * mm },
  { label: "Front toe 4 mrad, play 0.8 mm, tops out 3 deg", toeF: 0.004, camber: deg3, faces: true, play: 0.8 * mm },
  { label: "Front toe 4 mrad, play 0.8 mm, tops in 3 deg", toeF: 0.004, camber: -deg3, faces: true, play: 0.8 * mm },
  { label: "Tops in 3 deg, play 0.8 mm", camber: -deg3, faces: true, play: 0.8 * mm },
  { label: "Crooked 10 mrad, play 0.8 mm", heading: 0.01, faces: true, play: 0.8 * mm },
];
if (tables) for (const c of played) evaluate(c);

// Joint search over the unknowns, inside plausible ranges: front toe, rail friction (graphite on the
// faces can bring it well down), restitution, how crooked the car was set down, and camber, with
// thrust-face friction. Ten data points against five parameters: a good chi² here would say the class
// can explain the data, not that it does. Restitution stops at 0.6: at 0.9 a wheel pressed on the rail
// bounces hundreds of times before it settles, and race times then move by milliseconds with the step
// (docs/physics-model.md, section 11), so a ranking there means nothing. Ranked at the 0.5 ms step.
// With --play the search runs with that axial play (mm) on every wheel, and the tables are skipped.
if (process.argv.includes("--search")) {
  const scored: { a: Alignment; chi2: number }[] = [];
  for (const toeF of [0, 1e-3, 2e-3, 4e-3])
    for (const muC of [0.05, 0.1, 0.3])
      for (const e of [0.3, 0.6])
        for (const heading of [0, 5e-3, 10e-3])
          for (const camber of [-deg3, 0, deg3]) {
            const a: Alignment = {
              label: `toe ${toeF * 1e3} mrad, mu_c ${muC}, e ${e}, crooked ${heading * 1e3} mrad, camber ${((camber * 180) / Math.PI).toFixed(0)} deg`,
              toeF,
              muC,
              e,
              heading,
              camber,
              faces: true,
              ...(searchPlay === undefined ? {} : { play: searchPlay }),
            };
            const t = (o: Mann2012CarOptions): number | null => simulateRace(car(o, a), track, env, OPTS).elapsedTime;
            let chi2 = 0;
            for (const [pts, key] of [[massPts, "mass"], [cgPts, "xBar"]] as const)
              for (const p of pts) {
                const x = t({ [key]: p.x });
                chi2 += x === null ? Infinity : ((x - p.time) / Math.hypot(p.errorBar, READING)) ** 2;
              }
            scored.push({ a, chi2 });
          }
  scored.sort((p, q) => p.chi2 - q.chi2);
  const withPlay = searchPlay === undefined ? "" : `, play ${searchPlay / mm} mm`;
  console.log(`\nJoint search (${scored.length} combinations${withPlay}, 0.5 ms steps); best five:`);
  for (const s of scored.slice(0, 5)) evaluate(s.a);
}
