// M3 race sessions (spec 13): lanes raced under identical conditions, the replay trace, finish order.

import { describe, expect, it } from "vitest";
import { add, dot, rotate, sub, v2 } from "../src/core/vec2.js";
import { DEFAULT_ENVIRONMENT, demoCar } from "../src/kit/kit.js";
import { simulateRace } from "../src/physics/race.js";
import { type LaneResult, type LaneTrace, FIDELITY_STEP, finishOrder, poseAt, raceSession } from "../src/race/session.js";
import { bestTrack, finishS } from "../src/track/track.js";

describe("M3 race sessions", () => {
  const track = bestTrack(35);
  const slow = demoCar({ cgX: 0.07 });
  const session = raceSession([{ label: "A", spec: demoCar() }, null, { label: "B", spec: slow }, { label: "A again", spec: demoCar() }], track, DEFAULT_ENVIRONMENT, "standard");

  it("races every lane with the authoritative solver under identical conditions", () => {
    const direct = simulateRace(demoCar(), track, DEFAULT_ENVIRONMENT, { dt: FIDELITY_STEP.standard });
    expect(session.lanes[0]!.time).toBe(direct.elapsedTime);
    expect(session.lanes[1]).toBeNull();
    // Every lane has the same profile, so the lane does not change the time.
    expect(session.lanes[3]!.time).toBe(session.lanes[0]!.time);
    expect(session.lanes[2]!.time!).toBeGreaterThan(session.lanes[0]!.time!);
    expect(session.dt).toBe(5e-4);
    expect(session.profileStatus).toBe("ESTIMATED");
  });

  it("records a replay trace from the gate to the nose on the finish plane", () => {
    const l = session.lanes[0]!;
    const tr = l.trace;
    const n = tr.t.length;
    expect(tr.t[0]).toBe(0);
    expect(tr.distance[0]).toBe(0);
    expect(tr.t[n - 1]).toBeCloseTo(l.time!, 12);
    // The rear axle and pitch reproduce the nose the solver timed.
    const spec = demoCar();
    const nose = add(v2(tr.x[n - 1]!, tr.z[n - 1]!), rotate(spec.nose.value, tr.theta[n - 1]!));
    const fin = track.surface.at(finishS(track));
    expect(dot(sub(nose, fin.p), fin.t)).toBeCloseTo(0, 9);
    // Samples about 2 ms apart.
    expect(tr.t[10]! - tr.t[9]!).toBeCloseTo(0.002, 9);
    expect(l.maxResidual).toBeLessThan(1e-8);
    expect(l.frictionConsistent).toBe(true);
  });

  it("orders the finish by time; equal times share a place, cars that did not finish have none", () => {
    const lane = (i: number, time: number | null) => ({ lane: i, time }) as unknown as LaneResult;
    expect(finishOrder([lane(0, 2.5), lane(1, 2.4), null, lane(3, null)])).toEqual([
      { lane: 1, place: 1 },
      { lane: 0, place: 2 },
      { lane: 3, place: null },
    ]);
    expect(finishOrder(session.lanes)).toEqual([
      { lane: 0, place: 1 },
      { lane: 3, place: 1 },
      { lane: 2, place: 3 },
    ]);
  });

  it("interpolates the replay, held at the gate before release and at the finish after", () => {
    const tr: LaneTrace = {
      t: Float64Array.from([0, 1, 2]),
      distance: Float64Array.from([0, 1, 4]),
      speed: Float64Array.from([0, 2, 4]),
      x: Float64Array.from([0, 10, 20]),
      z: Float64Array.from([5, 4, 3]),
      theta: Float64Array.from([-0.4, -0.2, 0]),
    };
    expect(poseAt(tr, -3)).toEqual({ x: 0, z: 5, theta: -0.4, distance: 0, speed: 0 });
    expect(poseAt(tr, 1.5)).toEqual({ x: 15, z: 3.5, theta: -0.1, distance: 2.5, speed: 3 });
    expect(poseAt(tr, 9)).toEqual({ x: 20, z: 3, theta: 0, distance: 4, speed: 4 });
  });

  it("fine fidelity agrees with standard to well under the timer's resolution", () => {
    const fine = raceSession([{ label: "A", spec: demoCar() }], track, DEFAULT_ENVIRONMENT, "fine");
    expect(fine.dt).toBe(1e-4);
    expect(Math.abs(fine.lanes[0]!.time! - session.lanes[0]!.time!)).toBeLessThan(1e-6);
  });
});
