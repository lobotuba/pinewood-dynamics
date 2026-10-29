// From an evaluated design to mass properties, envelope extents and the solver's car description
// (spec 7.1, 7.2, 7.6; MAT-001). The player never types total mass: it is the sum of the parts.

import { type Provenance, type Sourced, sourced } from "../core/provenance.js";
import { v2 } from "../core/vec2.js";
import type { BallastShape, CarDesign, V3 } from "../geometry/design.js";
import { blockBox, shapeHalfSize } from "../geometry/design.js";
import type { BodySolid, MountState } from "../geometry/solid.js";
import { wheelCentres } from "../geometry/solid.js";
import { TYPICAL_KIT_ESTIMATE } from "../kit/kit.js";
import { type BuildPlan, planBuild } from "../build/tiers.js";
import type { AxleSpec, CarSpec, UnderbodyPoint } from "../physics/car.js";
import { type Mat3, type MassPart, ZERO3, boxInertia, combine, cylinderInertia, meshMassProperties, scaleMat } from "./inertia.js";
import { MATERIALS } from "./materials.js";

export interface Component extends MassPart {
  readonly name: string;
  readonly group: "body" | "wheel" | "axle" | "ballast";
  readonly provenance: Provenance;
  /** Wheels only: true spin inertia is handled by the solver, so pitch counts them as points. */
  readonly pointMassForPitch?: boolean;
}

export interface Extents {
  readonly min: V3;
  readonly max: V3;
  /** Lowest point of the car other than the wheel treads, above the wheel contact plane, m (CMP-004). */
  readonly underside: { readonly height: number; readonly what: string };
  /** Between the inner faces of opposing wheels, as installed, m. */
  readonly insideWheelSpacing: number;
  /** Weights whose bounding box enters a wheel's swept envelope (spec 9.6), strictest reading. */
  readonly wheelEnvelopeIntrusions: readonly string[];
}

export interface CarEvaluation {
  readonly components: readonly Component[];
  readonly total: MassPart;
  /** One-sigma uncertainty of the total mass, kg: the wood density spread unless the block was weighed. */
  readonly massUncertainty: number;
  readonly bodyDensity: Sourced<number>;
  readonly extents: Extents;
  readonly frontalArea: number;
  /** How each surface-mounted weight meets the body. */
  readonly mounting: Readonly<Record<string, MountState>>;
  /** Shop-order operations with the build tier each needs (12.6). */
  readonly build: BuildPlan;
  readonly spec: CarSpec;
}

export interface AxlePrep {
  readonly name: string;
  readonly friction: Sourced<number>;
}

export const AXLE_PREPS: Readonly<Record<CarDesign["axlePrep"], AxlePrep>> = {
  "stock-dry": {
    name: "Stock axles, no lubricant",
    friction: sourced(0.167, "ESTIMATED", "Mann, Gibbs and Sah 2012 spin-down, dry nail axle on a different kit"),
  },
  "polished-graphite": {
    name: "Polished axles, graphite",
    friction: sourced(0.15, "ESTIMATED", "Guess pending CHAR-006 calibration"),
  },
};

/** C_D for a derby body: a guess until measured (AERO-001). */
export const DRAG_COEFFICIENT = sourced(0.45, "ESTIMATED", "Bluff body near the ground; AERO-001 estimate");

export function shapeVolume(shape: BallastShape): number {
  return shape.kind === "cylinder" ? Math.PI * (shape.diameter / 2) ** 2 * shape.length : shape.size[0] * shape.size[1] * shape.size[2];
}


export { shapeHalfSize };

export function evaluateCar(design: CarDesign, body: BodySolid, kit = TYPICAL_KIT_ESTIMATE): CarEvaluation {
  const b = blockBox(kit);
  const blockVolume = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  const bodyDensity: Sourced<number> =
    design.measuredBlockMass === undefined
      ? kit.woodDensity
      : sourced(design.measuredBlockMass / blockVolume, "DERIVED", "Weighed uncut block / block volume (uniform density)");

  const components: Component[] = [];
  if (!body.empty) {
    const mp = meshMassProperties(body.positions, body.indices);
    const rho = bodyDensity.value;
    components.push({
      name: "Body",
      group: "body",
      mass: rho * mp.volume,
      centroid: mp.centroid,
      inertia: scaleMat(mp.inertia, rho),
      provenance: bodyDensity.provenance,
    });
  }

  const r = kit.wheelRadius.value;
  const ww = kit.wheelWidth.value;
  const mw = kit.wheelMass.value;
  const spin = kit.wheelSpinInertia.value;
  const names = ["Rear left", "Rear right", "Front left", "Front right"];
  const outerFace = kit.blockWidth.value / 2 + kit.wheelBodyGap.value + ww;
  const ra = kit.axleRadius.value;
  const L = kit.axleShaftLength.value;
  const rh = kit.axleHeadDiameter.value / 2;
  const th = kit.axleHeadThickness.value;
  const steel = kit.steelDensity.value;
  const shaftMass = steel * Math.PI * ra * ra * L;
  const headMass = steel * Math.PI * rh * rh * th;
  wheelCentres(kit).forEach((c, i) => {
    // Wheel: spin inertia about Y as given; across, a ring of the same radius of gyration (estimate).
    const across = spin / 2 + (mw * ww * ww) / 12;
    const inertia: Mat3 = [across, 0, 0, 0, spin, 0, 0, 0, across];
    components.push({ name: `${names[i]} wheel`, group: "wheel", mass: mw, centroid: c, inertia, provenance: "ESTIMATED", pointMassForPitch: true });
    // Axle: shaft from the wheel's outer face inward, head outside it.
    const side = Math.sign(c[1]);
    const shaft: MassPart = {
      mass: shaftMass,
      centroid: [c[0], side * (outerFace - L / 2), 0],
      inertia: cylinderInertia(shaftMass, ra, L, "y"),
    };
    const head: MassPart = {
      mass: headMass,
      centroid: [c[0], side * (outerFace + th / 2), 0],
      inertia: cylinderInertia(headMass, rh, th, "y"),
    };
    components.push({ name: `${names[i]} axle`, group: "axle", ...combine([shaft, head]), provenance: "ESTIMATED" });
  });

  for (const bl of design.ballast) {
    const mat = MATERIALS[bl.material];
    const m = mat.density.value * shapeVolume(bl.shape);
    const inertia = bl.shape.kind === "cylinder" ? cylinderInertia(m, bl.shape.diameter / 2, bl.shape.length, bl.shape.axis) : boxInertia(m, bl.shape.size);
    components.push({ name: `${mat.name} weight ${bl.id}`, group: "ballast", mass: m, centroid: bl.center, inertia, provenance: mat.density.provenance });
  }

  const total = combine(components);
  const pitch = combine(components.map((c) => (c.pointMassForPitch ? { ...c, inertia: ZERO3 } : c)));
  const bodyMass = components.find((c) => c.group === "body")?.mass ?? 0;
  const massUncertainty = design.measuredBlockMass === undefined ? bodyMass * kit.woodDensityRelativeUncertainty.value : 0;

  // Envelope: body, wheels, axle heads and every weight (the measurement box sees everything).
  const lo = [...body.bounds.min] as number[];
  const hi = [...body.bounds.max] as number[];
  const grow = (p: V3, h: V3): void => {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]! - h[k]!);
      hi[k] = Math.max(hi[k]!, p[k]! + h[k]!);
    }
  };
  if (body.empty) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Infinity, -Infinity];
  for (const c of wheelCentres(kit)) grow(c, [r, ww / 2, r]);
  for (const c of wheelCentres(kit)) grow([c[0], Math.sign(c[1]) * (outerFace + th / 2), 0], [rh, th / 2, rh]);
  let low = { z: body.empty ? Infinity : body.bounds.min[2], what: "body" };
  if (-rh < low.z) low = { z: -rh, what: "axle head" };
  for (const bl of design.ballast) {
    const h = shapeHalfSize(bl.shape);
    grow(bl.center, h);
    if (bl.center[2] - h[2] < low.z) low = { z: bl.center[2] - h[2], what: `weight ${bl.id}` };
  }
  // Wheel swept envelope: the wheel's bounding box plus 1/32 in all round (strictest reading).
  const pad = 0.03 * 0.0254;
  const intrusions = design.ballast
    .filter((bl) => {
      const h = shapeHalfSize(bl.shape);
      return wheelCentres(kit).some((c) =>
        [0, 1, 2].every((k) => Math.abs(bl.center[k]! - c[k]!) < h[k]! + [r, ww / 2, r][k]! + pad),
      );
    })
    .map((bl) => bl.id);
  const extents: Extents = {
    min: lo as unknown as V3,
    max: hi as unknown as V3,
    underside: { height: low.z + r, what: low.what },
    insideWheelSpacing: kit.blockWidth.value + 2 * kit.wheelBodyGap.value,
    wheelEnvelopeIntrusions: intrusions,
  };

  return {
    components,
    total,
    massUncertainty,
    bodyDensity,
    extents,
    frontalArea: body.frontalArea,
    mounting: body.mounting,
    build: planBuild(design, body),
    spec: carSpec(design, body, total, pitch, kit),
  };
}

function carSpec(design: CarDesign, body: BodySolid, total: MassPart, pitch: MassPart, kit = TYPICAL_KIT_ESTIMATE): CarSpec {
  const derived = <T>(x: T, how: string): Sourced<T> => sourced(x, "ESTIMATED", `Derived from the design with estimated kit and material values: ${how}`);
  // Nose: foremost point. For a flat front, the middle of the front face's height range.
  let noseX = -Infinity;
  let zLo = Infinity;
  let zHi = -Infinity;
  const P = body.positions;
  for (let i = 0; i < P.length; i += 3) noseX = Math.max(noseX, P[i]!);
  for (let i = 0; i < P.length; i += 3)
    if (P[i]! > noseX - 1e-5) {
      zLo = Math.min(zLo, P[i + 2]!);
      zHi = Math.max(zHi, P[i + 2]!);
    }
  let nose = v2(noseX, 0.5 * (zLo + zHi));
  for (const bl of design.ballast) {
    const front = bl.center[0] + shapeHalfSize(bl.shape)[0];
    if (front > nose.x) nose = v2(front, bl.center[2]);
  }
  const prep = AXLE_PREPS[design.axlePrep];
  const axle = (): AxleSpec => ({
    wheelRadius: kit.wheelRadius,
    wheelMass: sourced(2 * kit.wheelMass.value, kit.wheelMass.provenance, "Two wheels"),
    spinInertia: sourced(2 * kit.wheelSpinInertia.value, kit.wheelSpinInertia.provenance, "Two wheels"),
    axleRadius: kit.axleRadius,
    axleFriction: prep.friction,
    rollingResistance: sourced(0.003, "ESTIMATED", "Plastic wheel on aluminium: guess pending CHAR-006"),
  });
  return {
    name: design.name,
    mass: derived(total.mass, "sum of body, wheels, axles and weights"),
    cg: derived(v2(total.centroid[0], total.centroid[2]), "mass-weighted centroids"),
    pitchInertia: derived(pitch.inertia[4], "I_yy about the CG, wheels as point masses"),
    wheelbase: sourced(kit.frontAxleFromRear.value - kit.rearAxleFromRear.value, kit.frontAxleFromRear.provenance, "Kit axle datums"),
    nose: derived(nose, "foremost point of the solid"),
    dragArea: derived(DRAG_COEFFICIENT.value * body.frontalArea, "C_D 0.45 (estimate) times the silhouette area"),
    rear: axle(),
    front: axle(),
    underbody: derived(underbody(design, body), "lowest point of the solid and hung weights in each 2 mm cell of the plan view"),
  };
}

const CELL = 0.002;

/**
 * The underside: in each 2 mm by 2 mm cell of the plan view, the lowest point of the body or of a
 * weight mounted outside it. The body is cut by the plane through each cell row's centre x; along
 * each triangle's cut segment the lowest point within a cell is at one of the segment's ends there.
 */
export function underbody(design: CarDesign, body: BodySolid): UnderbodyPoint[] {
  const cells = new Map<string, UnderbodyPoint>();
  const put = (ix: number, iy: number, z: number): void => {
    const k = `${ix},${iy}`;
    const old = cells.get(k);
    if (!old || z < old.z) cells.set(k, { x: (ix + 0.5) * CELL, y: (iy + 0.5) * CELL, z });
  };
  const P = body.positions;
  const I = body.indices;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t]!, I[t + 1]!, I[t + 2]!].map((i) => [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!] as const);
    const xs = v.map((q) => q[0]);
    for (let ix = Math.ceil(Math.min(...xs) / CELL - 0.5); ix <= Math.floor(Math.max(...xs) / CELL - 0.5); ix++) {
      const x = (ix + 0.5) * CELL;
      // Where the triangle's edges cross the plane.
      const cut: [number, number][] = [];
      for (let e = 0; e < 3; e++) {
        const a = v[e]!;
        const b = v[(e + 1) % 3]!;
        if ((a[0] - x) * (b[0] - x) > 0) continue;
        if (a[0] === b[0]) cut.push([a[1], a[2]], [b[1], b[2]]);
        else {
          const u = (x - a[0]) / (b[0] - a[0]);
          cut.push([a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])]);
        }
      }
      if (cut.length < 2) continue;
      // The segment's ends: the two cut points farthest apart, ordered by y.
      let [lo, hi] = [cut[0]!, cut[1]!];
      for (const a of cut) for (const c of cut) if (Math.hypot(c[0] - a[0], c[1] - a[1]) > Math.hypot(hi[0] - lo[0], hi[1] - lo[1])) [lo, hi] = [a, c];
      if (hi[0] < lo[0]) [lo, hi] = [hi, lo];
      // A segment straight up and down (a vertical face) has its lowest point at its lower end.
      const zAt = (y: number) => (hi[0] === lo[0] ? Math.min(lo[1], hi[1]) : lo[1] + ((y - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]));
      for (let iy = Math.floor(lo[0] / CELL); iy * CELL <= hi[0]; iy++) {
        const y0 = Math.max(lo[0], iy * CELL);
        const y1 = Math.min(hi[0], (iy + 1) * CELL);
        if (y1 < y0) continue;
        put(ix, iy, Math.min(zAt(y0), zAt(y1)));
      }
    }
  }
  for (const bl of design.ballast) {
    if (bl.mounting === "cavity") continue;
    const h = shapeHalfSize(bl.shape);
    const c = bl.center;
    for (let ix = Math.ceil((c[0] - h[0]) / CELL - 0.5); (ix + 0.5) * CELL <= c[0] + h[0]; ix++)
      for (let iy = Math.floor((c[1] - h[1]) / CELL); iy * CELL <= c[1] + h[1]; iy++) put(ix, iy, c[2] - h[2]);
  }
  return [...cells.values()];
}
