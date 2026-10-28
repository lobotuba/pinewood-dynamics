// Test fixtures: cars and tracks with exactly known parameters (provenance DEFAULT).

import { sourced } from "../src/core/provenance.js";
import { STANDARD_GRAVITY } from "../src/core/units.js";
import { type Vec2, v2 } from "../src/core/vec2.js";
import type { AxleSpec, CarSpec, Environment } from "../src/physics/car.js";
import { Path } from "../src/track/path.js";
import type { Track } from "../src/track/track.js";

const d = <T>(x: T) => sourced(x, "DEFAULT", "test fixture");

export interface TestCarParams {
  mass?: number;
  cg?: Vec2;
  pitchInertia?: number;
  wheelbase?: number;
  nose?: Vec2;
  dragArea?: number;
  wheelRadius?: number;
  wheelMass?: number; // per axle (both wheels)
  spinInertia?: number; // per axle (both wheels)
  axleRadius?: number;
  mu?: number;
  crr?: number;
}

export function testCar(p: TestCarParams = {}): CarSpec {
  const axle = (): AxleSpec => ({
    wheelRadius: d(p.wheelRadius ?? 0.015),
    wheelMass: d(p.wheelMass ?? 0),
    spinInertia: d(p.spinInertia ?? 0),
    axleRadius: d(p.axleRadius ?? 0.0011),
    axleFriction: d(p.mu ?? 0),
    rollingResistance: d(p.crr ?? 0),
  });
  return {
    name: "test car",
    mass: d(p.mass ?? 0.14),
    cg: d(p.cg ?? v2(0.03, 0.008)),
    pitchInertia: d(p.pitchInertia ?? 3e-4),
    wheelbase: d(p.wheelbase ?? 0.111),
    nose: d(p.nose ?? v2(0.155, 0.008)),
    dragArea: d(p.dragArea ?? 0),
    rear: axle(),
    front: axle(),
  };
}

export const G = STANDARD_GRAVITY;

export const testEnv = (rho = 1.2): Environment => ({
  gravity: d(G),
  airDensity: d(rho),
});

/** A single straight incline at angle `slope` below horizontal, long enough for the timed distance. */
export function straightIncline(slope: number, timedDistance: number, pinS = 0.5): Track {
  return {
    name: "straight incline",
    surface: Path.build(v2(0, 10), -slope, [{ kind: "line", length: pinS + timedDistance + 1 }]),
    profileStatus: "IDEALIZED",
    profileSource: "test",
    pinS,
    timedDistance: d(timedDistance),
  };
}
