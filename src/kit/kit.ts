// Kit library (KIT-001, CHAR-001..003). Named generically (BRD-007).
//
// Local races use different kits, so the player says which kit the car is built from and which wheels
// it runs on, and every kit is treated alike: a block (size, axle slots) that comes with its own wheels
// and axles, plus wheel sets sold on their own. A design carries its choice as a snapshot (KitChoice),
// so a measured kit travels with the file.
//
// The block figures come from one retailer's comparison of kits (source record below); the slot
// positions it calls "offset" are not dimensioned, so they are taken from the standard kit. Nothing
// here has been measured on a real kit: every value is ESTIMATED or MANUFACTURER until the player
// enters a measurement (MEASURED), and must not be shown as a kit fact (LOC-AX-004).

import { type Provenance, type Sourced, sourced, weakest } from "../core/provenance.js";
import { STANDARD_GRAVITY, grams, inches, ounces } from "../core/units.js";
import { v2 } from "../core/vec2.js";
import type { AxleSpec, CarSpec, Environment } from "../physics/car.js";

/** A kit's wood block, its axle slots, and the wheels and axles that come with it. */
export interface BlockKit {
  readonly id: string;
  readonly name: string;
  readonly length: Sourced<number>;
  readonly width: Sourced<number>;
  readonly height: Sourced<number>;
  /** Axle datums along the block from its rear face, m (CHAR-002). */
  readonly rearAxleFromRear: Sourced<number>;
  readonly frontAxleFromRear: Sourced<number>;
  /** Depth of the axle slots (or channels) in the bottom face, m; the axle seats at the slot's closed end. */
  readonly slotDepth: Sourced<number>;
  readonly slots: "offset" | "centred";
  /** What the kit has that the block solid leaves out, shown with the kit. */
  readonly notModelled?: string;
  readonly wheels: WheelSet;
}

/** Four wheels and their axles. */
export interface WheelSet {
  readonly id: string;
  readonly name: string;
  /** The block kit these come with; null for a set sold on its own. */
  readonly kit: string | null;
  readonly diameter: Sourced<number>;
  /** Overall width, hub to outer face, m (the solid's wheel). */
  readonly width: Sourced<number>;
  /** Width of the rolling tread, m, where published. Recorded; the lateral model takes its own. */
  readonly tread?: Sourced<number>;
  /** One wheel, kg. */
  readonly mass: Sourced<number>;
  /** Bore diameter, m, where published. Recorded; bore clearance is not modelled yet. */
  readonly bore?: Sourced<number>;
  readonly axleDiameter: Sourced<number>;
  readonly axleLength: Sourced<number>;
}

/** What a car is built from: a block kit and the wheels it runs on (the kit's own, or another set). */
export interface KitChoice {
  readonly block: BlockKit;
  readonly wheels: WheelSet;
}

const EST = "Typical derby-kit value from general knowledge; not measured on a kit.";
const est = <T = number>(x: T, note = EST): Sourced<T> => sourced(x, "ESTIMATED", note);

// Source record: Maximum Velocity, "Pinewood Derby Times" v8 i15,
// https://www.maximum-velocity.com/pinewood-derby-times-v8i15/ (accessed 2026-10-30), quoting each
// kit's block as "W x H x L, slots, wheelbase". The kits behind the generic names, in order: Cub Scout
// Grand Prix (and the retailer's own basic kit, the same figures), Awana Grand Prix, CSB Shape N Race,
// PineCar Basic, RA Car Kit, Royal Ranger. A retailer describing other makers' kits: ESTIMATED.
const CATALOG = "Retailer's comparison of kit blocks (W x H x L, slots, wheelbase); not measured on a kit.";
const cat = (x: number, what: string): Sourced<number> => est(x, `${CATALOG} ${what}`);
/** Offset slots: the catalog gives the wheelbase but not where the slots sit, so the rear slot is put where the standard kit's is. */
const OFFSET_REAR = inches(0.875);
const OFFSET = `Rear slot 7/8 in from the rear face as on the standard kit: the catalog does not place offset slots. ${EST}`;

/** The typical wheels and axles, for kits whose wheels are not published. */
const typicalWheels = (kit: string, name = "Kit wheels and axles (typical)"): WheelSet => ({
  id: `${kit}-wheels`,
  name,
  kit,
  diameter: est(inches(1.18)),
  width: est(inches(0.38)),
  mass: est(grams(2.6)),
  axleDiameter: est(inches(0.087)),
  axleLength: est(inches(1.2)),
});

/** A block with slots offset from centre: the rear slot as on the standard kit, the front one a wheelbase ahead. */
function offsetBlock(id: string, name: string, w: number, h: number, l: number, depth: number, wb: number, wheels = typicalWheels(id), notModelled?: string): BlockKit {
  return {
    id,
    name,
    length: cat(l, "Length."),
    width: cat(w, "Width."),
    height: cat(h, "Height."),
    rearAxleFromRear: est(OFFSET_REAR, OFFSET),
    frontAxleFromRear: est(OFFSET_REAR + wb, `Rear slot plus the catalog's wheelbase. ${OFFSET}`),
    slotDepth: cat(depth, "Slot depth."),
    slots: "offset",
    ...(notModelled ? { notModelled } : {}),
    wheels,
  };
}

function centredBlock(id: string, name: string, w: number, h: number, l: number, depth: number, wb: number, wheels: WheelSet, notModelled?: string): BlockKit {
  return {
    id,
    name,
    length: cat(l, "Length."),
    width: cat(w, "Width."),
    height: cat(h, "Height."),
    rearAxleFromRear: cat((l - wb) / 2, "Slots centred on the block's length."),
    frontAxleFromRear: cat((l + wb) / 2, "Slots centred on the block's length."),
    slotDepth: cat(depth, "Slot depth."),
    slots: "centred",
    ...(notModelled ? { notModelled } : {}),
    wheels,
  };
}

/** The standard block; its size is the owner's confirmation and agrees with the catalog (CHAR-001). */
const STANDARD: BlockKit = {
  ...offsetBlock("standard", "Standard kit: 7 in block, 4-3/8 in wheelbase", inches(1.75), inches(1.25), inches(7), inches(1 / 8), inches(4.375)),
  length: est(inches(7), "Standard pinewood derby block, 7 x 1-3/4 x 1-1/4 in nominal (owner, 2026-10-31; matches the retailer's catalog)."),
  width: est(inches(1.75), "Standard pinewood derby block, 7 x 1-3/4 x 1-1/4 in nominal (owner, 2026-10-31; matches the retailer's catalog)."),
  height: est(inches(1.25), "Standard pinewood derby block, 7 x 1-3/4 x 1-1/4 in nominal (owner, 2026-10-31; matches the retailer's catalog)."),
};

// Source record for the club kit's wheels and axles: Pinewood Pro, "Awana Grand Prix lathed wheels"
// (https://www.pinewoodpro.com/awana-grand-prix-lathed-wheels.html) and Derby Dust's Awana wheel
// listings give raw wheels of 1.190 to 1.200 in, about 2.2 g, bore 0.098 in; Maximum Velocity's
// replacement axles for that kit are 0.0920 in +- 0.001 by 1 in (accessed 2026-10-30). Retailers, so
// ESTIMATED. Their axles are "hinge-pin type": the head is not dimensioned.
const RETAIL = "Retailers' listings for this kit's parts; not measured on a kit.";
const CLUB_WHEELS: WheelSet = {
  id: "club-wheels",
  name: "Club kit wheels and axles",
  kit: "club",
  diameter: est(inches(1.195), `${RETAIL} Raw wheels 1.190 to 1.200 in.`),
  width: est(inches(0.38)),
  mass: est(grams(2.2), `${RETAIL} About 2.2 g raw.`),
  bore: est(inches(0.098), `${RETAIL} Bore 0.098 in.`),
  axleDiameter: est(inches(0.092), `${RETAIL} Replacement axle 0.0920 in +- 0.001.`),
  axleLength: est(inches(1), `${RETAIL} Replacement axle shaft 1 in.`),
};

/** The block kits, standard first. */
export const BLOCK_KITS: readonly BlockKit[] = [
  STANDARD,
  centredBlock("club", "Club kit: 6-13/16 in block, centred 3-13/16 in wheelbase", inches(1.75), inches(1.5), inches(6.8125), inches(3 / 16), inches(3.8125), CLUB_WHEELS),
  offsetBlock("wide", "Wide kit: 2-1/4 in block, 3-11/16 in wheelbase", inches(2.25), inches(1.125), inches(6.9375), inches(7 / 32), inches(3.6875)),
  offsetBlock("hobby", "Hobby kit: 1-5/16 in tall block, 4-7/16 in wheelbase", inches(1.75), inches(1.3125), inches(7), inches(1 / 16), inches(4.4375)),
  offsetBlock("narrow", "Narrow kit: 1-5/8 in block, 4-3/16 in wheelbase", inches(1.625), inches(1.375), inches(7), inches(1 / 8), inches(4.1875)),
  centredBlock(
    "long",
    "Long-wheelbase kit: driver cut-out, 5 in wheelbase",
    inches(1.75),
    inches(1.3125),
    inches(6.9375),
    inches(3 / 16),
    inches(5),
    typicalWheels("long"),
    "The block's driver cut-out is not in the solid: cut it as a pocket. Its axle channels are 3/8 in semicircles, taken as 3/16 in deep.",
  ),
];

// Source record: Maximum Velocity, "MV Wheels and Axles", https://www.maximum-velocity.com/product/mv-wheels-and-axles/
// (accessed 2026-10-30), the maker's own spec: wheel 1.192 in, tread 0.319 in, 2.4 g, bore 0.095 in;
// axle 0.087 in +- 0.0005 by 1 in, zinc-coated steel. Overall wheel width and the axle head are not given.
const MAKER = "The wheel maker's published spec for this set.";
/** Wheel sets sold on their own, usable on any kit an event allows them on. */
export const WHEEL_SETS: readonly WheelSet[] = [
  {
    id: "precision-1192",
    name: "Precision wheels and axles: 1.192 in, 2.4 g",
    kit: null,
    diameter: sourced(inches(1.192), "MANUFACTURER", `${MAKER} Diameter 1.192 in.`),
    width: est(inches(0.38), `Overall width not published. ${EST}`),
    tread: sourced(inches(0.319), "MANUFACTURER", `${MAKER} Tread 0.319 in.`),
    mass: sourced(grams(2.4), "MANUFACTURER", `${MAKER} 2.4 g.`),
    bore: sourced(inches(0.095), "MANUFACTURER", `${MAKER} Bore 0.095 in.`),
    axleDiameter: sourced(inches(0.087), "MANUFACTURER", `${MAKER} Axle 0.087 in +- 0.0005, zinc-coated steel.`),
    axleLength: sourced(inches(1), "MANUFACTURER", `${MAKER} Shaft 1 in.`),
  },
];

export const blockKit = (id: string): BlockKit | undefined => BLOCK_KITS.find((b) => b.id === id);

/** A block kit with its own wheels. */
export const kitChoice = (block: BlockKit, wheels: WheelSet = block.wheels): KitChoice => ({ block, wheels });

/** The kit a design without a choice is taken to be built from: the standard kit with its wheels. */
export const DEFAULT_KIT: KitChoice = kitChoice(STANDARD);

/** The wheels a block can run on: its own, then the sets sold separately. */
export const wheelChoices = (block: BlockKit): readonly WheelSet[] => [block.wheels, ...WHEEL_SETS];

/** True when the car runs on the wheels its kit came with. */
export const kitWheels = (k: KitChoice): boolean => k.wheels.kit === k.block.id;

/** The block and wheel figures a player can measure, with the field each replaces. */
export type Measurable =
  | "length"
  | "width"
  | "height"
  | "rearAxleFromRear"
  | "frontAxleFromRear"
  | "slotDepth"
  | "diameter"
  | "wheelWidth"
  | "mass"
  | "axleDiameter";

/**
 * The same kit with the player's measurements (CHAR-001..003), SI, each labelled MEASURED. It stays the
 * same kit (same ids), so an event's kit rule still recognises it.
 */
export function measuredKit(k: KitChoice, m: Partial<Record<Measurable, number>>, note: string): KitChoice {
  const at = (key: Measurable, old: Sourced<number>): Sourced<number> => (m[key] === undefined ? old : sourced(m[key]!, "MEASURED", note));
  const b = k.block;
  const w = k.wheels;
  return {
    block: {
      ...b,
      length: at("length", b.length),
      width: at("width", b.width),
      height: at("height", b.height),
      rearAxleFromRear: at("rearAxleFromRear", b.rearAxleFromRear),
      frontAxleFromRear: at("frontAxleFromRear", b.frontAxleFromRear),
      slotDepth: at("slotDepth", b.slotDepth),
    },
    wheels: { ...w, diameter: at("diameter", w.diameter), width: at("wheelWidth", w.width), mass: at("mass", w.mass), axleDiameter: at("axleDiameter", w.axleDiameter) },
  };
}

/** Every value the geometry, mass model and solver read from a kit, flattened from a KitChoice. */
export interface KitValues {
  readonly blockLength: Sourced<number>;
  readonly blockWidth: Sourced<number>;
  readonly blockHeight: Sourced<number>;
  readonly rearAxleFromRear: Sourced<number>;
  readonly frontAxleFromRear: Sourced<number>;
  readonly wheelRadius: Sourced<number>;
  readonly wheelMass: Sourced<number>;
  readonly wheelSpinInertia: Sourced<number>;
  readonly axleRadius: Sourced<number>;
  readonly wheelWidth: Sourced<number>;
  /** Gap between the body side and the wheel hub, per side. */
  readonly wheelBodyGap: Sourced<number>;
  /** Axle axis above the block's bottom face (sets the slot depth and the underside clearance). */
  readonly axleAboveBlockBottom: Sourced<number>;
  readonly axleShaftLength: Sourced<number>;
  readonly axleHeadDiameter: Sourced<number>;
  readonly axleHeadThickness: Sourced<number>;
  readonly steelDensity: Sourced<number>;
  /** Pine; real kit blocks vary by roughly +-15 %. Weigh the block to replace this (MAT-001). */
  readonly woodDensity: Sourced<number>;
  readonly woodDensityRelativeUncertainty: Sourced<number>;
}

const half = (x: Sourced<number>): Sourced<number> => sourced(x.value / 2, x.provenance, x.source);
const derived = (value: number, from: Provenance[], how: string): Sourced<number> => {
  const p = weakest(from);
  return sourced(value, p === "MEASURED" || p === "MANUFACTURER" || p === "RULE" ? "DERIVED" : p, how);
};

export function kitValues(k: KitChoice): KitValues {
  const b = k.block;
  const w = k.wheels;
  const r = w.diameter.value / 2;
  const ra = w.axleDiameter.value / 2;
  return {
    blockLength: b.length,
    blockWidth: b.width,
    blockHeight: b.height,
    rearAxleFromRear: b.rearAxleFromRear,
    frontAxleFromRear: b.frontAxleFromRear,
    wheelRadius: half(w.diameter),
    wheelMass: w.mass,
    // 0.6 m r^2: most of a derby wheel's mass is in the tread ring.
    wheelSpinInertia: est(0.6 * w.mass.value * r * r, `${EST} Taken as 0.6 m r^2.`),
    axleRadius: half(w.axleDiameter),
    wheelWidth: w.width,
    wheelBodyGap: est(inches(0.03)),
    axleAboveBlockBottom: derived(
      b.slotDepth.value - ra,
      [b.slotDepth.provenance, w.axleDiameter.provenance],
      "Slot depth less the axle radius: the axle seated at the slot's closed end.",
    ),
    axleShaftLength: w.axleLength,
    axleHeadDiameter: est(inches(0.2)),
    axleHeadThickness: est(inches(0.04)),
    steelDensity: sourced(7850, "DEFAULT", "Carbon steel, handbook value"),
    woodDensity: est(420, `${EST} Pine, 0.42 g/cm^3.`),
    woodDensityRelativeUncertainty: est(0.15, `${EST} Spread of pine densities.`),
  };
}

/** The values of the default kit (the standard kit with its wheels), for the solver and the tests. */
export const TYPICAL_KIT_ESTIMATE: KitValues = kitValues(DEFAULT_KIT);

/** Kit dimensions (block and wheels) that are not yet measured, for inspection and export notes. */
export function unmeasured(k: KitChoice): string[] {
  const b = k.block;
  const w = k.wheels;
  const all: [string, Sourced<number>][] = [
    ["block length", b.length],
    ["block width", b.width],
    ["block height", b.height],
    ["axle slots", b.rearAxleFromRear],
    ["axle slots", b.frontAxleFromRear],
    ["slot depth", b.slotDepth],
    ["wheel diameter", w.diameter],
    ["wheel width", w.width],
    ["wheel mass", w.mass],
    ["axle diameter", w.axleDiameter],
  ];
  return [...new Set(all.filter(([, s]) => s.provenance === "ESTIMATED" || s.provenance === "DEFAULT").map(([n]) => n))];
}

/** One line on how far the kit's dimensions can be trusted. */
export function kitNote(k: KitChoice): string {
  const open = unmeasured(k);
  return open.length === 0
    ? `Kit: ${k.block.name}, measured or from the maker.`
    : `Kit dimensions ESTIMATED until measured (${open.join(", ")}; CHAR-001..003).`;
}

export const DEFAULT_ENVIRONMENT: Environment = {
  gravity: sourced(STANDARD_GRAVITY, "DEFAULT", "Standard gravity"),
  airDensity: sourced(1.204, "DEFAULT", "Dry air, 20 C, sea level"),
};

export interface DemoCarOptions {
  readonly name?: string;
  /** Total mass, kg. */
  readonly mass?: number;
  /** CG ahead of the rear axle, m. */
  readonly cgX?: number;
  /** CG above the axle line, m. */
  readonly cgZ?: number;
  readonly axleFriction?: number;
  readonly rollingResistance?: number;
  readonly dragArea?: number;
}

/**
 * A car on the typical kit with ESTIMATED physical properties, for exercising the solver.
 * Defaults: 4.9 oz, CG 1 in ahead of the rear axle and 0.3 in above the axle line.
 */
export function demoCar(o: DemoCarOptions = {}): CarSpec {
  const k = TYPICAL_KIT_ESTIMATE;
  const wb = k.frontAxleFromRear.value - k.rearAxleFromRear.value;
  const axle = (): AxleSpec => ({
    wheelRadius: k.wheelRadius,
    wheelMass: est(2 * k.wheelMass.value, `${EST} Two wheels.`),
    spinInertia: est(2 * k.wheelSpinInertia.value, `${EST} Two wheels.`),
    axleRadius: k.axleRadius,
    axleFriction: est(o.axleFriction ?? 0.15, "Polished axle with graphite: guess pending CHAR-006."),
    rollingResistance: est(o.rollingResistance ?? 0.003, "Plastic wheel on aluminium: guess pending CHAR-006."),
  });
  const mass = o.mass ?? ounces(4.9); // margin below the 5.000 oz limit (MAT-006)
  return {
    name: o.name ?? "Demo car (typical kit, estimated)",
    mass: est(mass, "Demo value"),
    cg: est(v2(o.cgX ?? inches(1), o.cgZ ?? inches(0.3)), "Demo value"),
    // Uniform-rod approximation over the block length.
    pitchInertia: est((mass * k.blockLength.value ** 2) / 12, "Uniform-rod approximation"),
    wheelbase: est(wb),
    nose: est(v2(k.blockLength.value - k.rearAxleFromRear.value, inches(0.3))),
    dragArea: est(o.dragArea ?? 6e-4, "Cd about 0.45 on about 1.35e-3 m^2 frontal area (AERO-001: estimate)."),
    rear: axle(),
    front: axle(),
  };
}
