// Roll (quasi-static load transfer between the sides) and the underside clearance monitor, against
// hand statics and the transition's circular geometry.

import { describe, expect, it } from "vitest";
import { sourced } from "../src/core/provenance.js";
import { inches } from "../src/core/units.js";
import { v2 } from "../src/core/vec2.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import type { CarSpec, UnderbodyPoint } from "../src/physics/car.js";
import { type LateralCarSpec, type LateralModel, lateralStep } from "../src/physics/lateral.js";
import { simulateRace } from "../src/physics/race.js";
import { TYPICAL_LANE_LATERAL, type Track, bestTrack } from "../src/track/track.js";
import { G, straightIncline, testCar, testEnv } from "./helpers.js";

const d = <T>(x: T) => sourced(x, "DEFAULT", "test fixture");

const model = (o: Partial<LateralModel> = {}): LateralModel => ({
  m: 0.14,
  Iz: 3e-4,
  xc: 0.03,
  yc: 0,
  wheelbase: 0.111,
  spacing: inches(1.81),
  railWidth: inches(1.625),
  railHeight: inches(0.25),
  toe: [0, 0],
  camber: [0, 0],
  treadWidth: 0,
  radius: [0.015, 0.015],
  wheelMass: [0, 0],
  muT: 0.6,
  muC: 0.3,
  e: 0,
  gLat: 0,
  cgHeight: 0.025,
  ...o,
});
const b = inches(1.81) / 2;
const step = (L: LateralModel) => lateralStep(L, { Y: 0, psi: 0, dY: 0, dPsi: 0 }, { h: 1e-4, v0: [1, 1], v1: [1, 1], N: [0.7, 0.6] });

describe("Roll: load moves between the sides", () => {
  it("a CG off the centreline loads that side by y_c (N_r + N_f) / (4 b) per wheel", () => {
    const st = step(model({ yc: 0.002 }));
    const shift = (0.002 * 1.3) / (4 * b);
    expect(st.wheels[0][0].roll).toBeCloseTo(shift, 14);
    expect(st.wheels[1][0].roll).toBeCloseTo(shift, 14);
    expect(st.wheels[0][1].roll).toBeCloseTo(-shift, 14);
  });

  it("a cross slope unloads the uphill wheels by z_cg m g_lat / (4 b), the treads holding", () => {
    const L = model({ gLat: 1 });
    const st = step(L);
    expect(st.next.dY).toBeCloseTo(0, 14);
    expect(st.wheels[0][0].roll).toBeCloseTo((-0.025 * 0.14 * 1) / (4 * b), 14);
    expect(st.wheels[1][1].roll).toBeCloseTo((0.025 * 0.14 * 1) / (4 * b), 14);
  });

  it("tips the car where the uphill wheels' load reaches zero, and not before", () => {
    // Incline 0.1 rad, CG 40 mm above the axles at mid-wheelbase: the lighter axle's uphill wheel
    // lifts when z_cg m g sin(c) / (4 b) reaches half that axle's load.
    const alpha = 0.1;
    const car = (cross: number): [CarSpec, Track] => {
      const c = testCar({ cg: v2(0.0555, 0.04) });
      const lat: LateralCarSpec = {
        yawInertia: d(3e-4),
        cgOffset: d(0),
        insideWheelSpacing: d(inches(1.81)),
        toe: { rear: d(0), front: d(0) },
        treadFriction: d(0.8),
        railFriction: d(0.3),
        railRestitution: d(0.5),
      };
      const t = { ...straightIncline(alpha, 1), lateral: { ...TYPICAL_LANE_LATERAL, crossSlope: d(cross) } };
      return [{ ...c, lateral: lat }, t];
    };
    const zcg = 0.04 + 0.015;
    // Static axle loads on the incline: front m g cos(alpha) x_cg / WB, rear the rest.
    const Nf = 0.14 * G * Math.cos(alpha) * (0.0555 / 0.111);
    const Nmin = Math.min(Nf, 0.14 * G * Math.cos(alpha) - Nf);
    const critical = Math.asin((2 * b * Nmin) / (zcg * 0.14 * G));
    const [below, tb] = car(0.98 * critical);
    expect(simulateRace(below, tb, testEnv(0)).status).toBe("FINISHED");
    const [above, ta] = car(1.02 * critical);
    const r = simulateRace(above, ta, testEnv(0));
    expect(r.status).toBe("OUTSIDE_MODEL_VALIDITY");
    expect(r.message).toMatch(/left wheel lifts in roll/);
  });
});

describe("Underside clearance over the lane and the rail", () => {
  const track = bestTrack(35);
  const r = demoCar().rear.wheelRadius.value;
  const WB = demoCar().wheelbase.value;
  const h = inches(0.25);
  // One low point 60 mm ahead of the front axle, over the rail's raised edge (BestTrack's rail is
  // cleared down its middle 1 in, so only its edges, 0.5 to 0.8125 in out, have a top).
  const nosePoint = (aboveRail: number): UnderbodyPoint[] => [{ x: WB + 0.06, y: inches(0.65), z: -r + h + aboveRail }];
  const car = (pts: UnderbodyPoint[] | null): CarSpec => {
    const c = demoCar();
    return pts ? { ...c, underbody: d(pts) } : c;
  };

  it("finds the transition's least clearance from its circular geometry, without changing the race", () => {
    // Both axles on the arc of radius R: wheel centres at R - r from its centre, the body's x axis
    // their chord. A body point (x, z) is sqrt((x - c)^2 + (k - z)^2) from the centre, with c = WB/2
    // and k = sqrt((R - r)^2 - c^2), so its height above the lane is R minus that.
    const R = inches(41) / ((26 * Math.PI) / 180);
    const c = WB / 2;
    const k = Math.sqrt((R - r) ** 2 - c * c);
    const p = nosePoint(0.003)[0]!;
    const onArc = R - Math.hypot(p.x - c, k - p.z) - h;
    const res = simulateRace(car(nosePoint(0.003)), track, DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(res.status).toBe("FINISHED");
    expect(res.clearance!.kind).toBe("rail");
    // The car passes through that pose, so the least clearance is no more than it; on the arc's ends,
    // with one axle still on a straight, it is a little less.
    expect(res.clearance!.rail).toBeLessThanOrEqual(onArc + 1e-9);
    expect(res.clearance!.rail).toBeGreaterThan(onArc - 2e-5);
    expect(onArc).toBeLessThan(0.003 - 5e-4);
    // A monitor, not a force: the time is the car's without it.
    expect(res.elapsedTime).toBe(simulateRace(car(null), track, DEFAULT_ENVIRONMENT, { dt: 5e-4 }).elapsedTime);
  });

  it("ends the race where a low overhang meets the rail in the transition", () => {
    const res = simulateRace(car(nosePoint(3e-4)), track, DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(res.status).toBe("OUTSIDE_MODEL_VALIDITY");
    expect(res.message).toMatch(/touches the guide rail 171\.1 mm ahead of the rear axle/);
  });

  it("lets a point over the rail's cleared middle pass where a solid rail would stop it", () => {
    const pts: UnderbodyPoint[] = [{ x: WB + 0.06, y: 0, z: -r + h + 3e-4 }];
    const res = simulateRace(car(pts), track, DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(res.status).toBe("FINISHED");
    expect(res.clearance!.rail).toBe(Infinity);
  });

  it("checks against the lane, not the rail, beside the rail's reach", () => {
    const pts: UnderbodyPoint[] = [{ x: WB + 0.06, y: 0.03, z: -r + 3e-4 }];
    const res = simulateRace(car(pts), track, DEFAULT_ENVIRONMENT, { dt: 5e-4 });
    expect(res.status).toBe("OUTSIDE_MODEL_VALIDITY");
    expect(res.message).toMatch(/touches the lane/);
  });
});
