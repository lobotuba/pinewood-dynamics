// Data-driven ruleset and inspection (spec 9; CMP-001..009, RUL-001..010). The shipped ruleset is
// named neutrally and paraphrased (BRD-007, spec 9.3). Pass/fail compares unrounded SI values with
// limits converted exactly from their source units (CMP-005, spec 6.4).

import type { CarDesign, ComplianceContext } from "../geometry/design.js";
import { inches, ounces } from "../core/units.js";
import type { CarEvaluation } from "../mass/carModel.js";
import { type KitChoice, blockKit, kitNote, kitWheels } from "../kit/kit.js";

export type ConstraintClass = "GEOMETRY VALIDITY" | "PUBLISHED RULE" | "LOCAL/FROZEN" | "PROTECTED" | "ADVISORY";
export type LineState = "PASS" | "FAIL" | "LOCKED" | "NOT EVALUATED";
export type Quantity = "length" | "mass";

export interface RuleLimit {
  readonly id: string;
  readonly label: string;
  readonly quantity: Quantity;
  readonly kind: "max" | "min";
  /** In source units and precision, exactly as the source states it (CMP-006). */
  readonly source: { readonly value: string; readonly unit: "in" | "oz" };
  /** The same limit in SI, converted exactly. */
  readonly si: number;
}

/** What an event's rules say about a practice: allowed, prohibited, or not stated (UNKNOWN until sourced). */
export type Permission = "allowed" | "prohibited" | "unknown";

/**
 * The event's rules beyond the measured limits: what may be done to the kit, and process rules the
 * software cannot verify (CMP-008), kept as a checklist for the build package. Alignment practices
 * gate the Release 2 alignment controls: a control is offered only where its practice is allowed
 * (WHL-005, WHL-009).
 */
export interface EventRules {
  /** Wood, wheels and axles must come from the event's kit. */
  readonly kitPartsOnly: boolean;
  /** The block kit the event issues, by kit library id. Omitted: not stated. */
  readonly issuedKit?: string;
  /** The kit's axle slots must be used (no extended wheelbase). */
  readonly axleSlots: "required" | "optional" | "unknown";
  /** Rounding, bevelling, cupping or lightening the wheels (RUL-008). */
  readonly wheelReshaping: Permission;
  /** Bent or canted axles: camber and toe. */
  readonly bentAxles: Permission;
  /** Running on three wheels, one raised clear of the track. */
  readonly raisedWheel: Permission;
  /** Washers, bushings, sleeves or bearings with the wheels or axles. */
  readonly washersBearings: Permission;
  readonly lubricant: "dry only" | "any" | "none" | "unknown";
  /** Process rules: entrant present, new work, no changes after check-in, and so on. */
  readonly checklist: readonly string[];
}

/**
 * A ruleset (9.1, CMP-002): what it is, where it comes from, how far it is confirmed, its limits and its
 * event rules. A design carries an immutable snapshot of its ruleset, so every inspection, race result
 * and export says exactly which rules it was held to.
 */
export interface Ruleset {
  readonly id: string;
  readonly name: string;
  /** Organization or event. */
  readonly organization: string;
  /** Version or effective date, as the source gives it. */
  readonly effective: string;
  readonly sourceLine: string;
  /** PUBLISHED: as an event published it. LOCAL: edited for a local race (a local override, 9.1). */
  readonly provenance: "PUBLISHED" | "LOCAL";
  readonly review: { readonly status: "UNREVIEWED" | "CONFIRMED"; readonly date?: string };
  /** The measured limits; a limit the event does not set is simply absent. */
  readonly limits: readonly RuleLimit[];
  readonly event: EventRules;
}

/** The limits inspection can measure, with their source units (6.4: limits keep their source units). */
export const LIMIT_CATALOG: readonly { readonly id: string; readonly label: string; readonly kind: "max" | "min"; readonly unit: "in" | "oz" }[] = [
  { id: "RUL-001", label: "Overall length", kind: "max", unit: "in" },
  { id: "RUL-002", label: "Overall width", kind: "max", unit: "in" },
  { id: "RUL-003", label: "Overall height", kind: "max", unit: "in" },
  { id: "RUL-004", label: "Underside clearance", kind: "min", unit: "in" },
  { id: "RUL-005", label: "Inside wheel spacing", kind: "min", unit: "in" },
  { id: "RUL-006", label: "Mass", kind: "max", unit: "oz" },
];

export const ruleLimit = (id: string, label: string, kind: "max" | "min", value: string, unit: "in" | "oz"): RuleLimit => ({
  id,
  label,
  quantity: unit === "in" ? "length" : "mass",
  kind,
  source: { value, unit },
  si: unit === "in" ? inches(Number(value)) : ounces(Number(value)),
});

const lim = ruleLimit;

export const CCCS_KIT_CAR_2026: Ruleset = {
  id: "cccs-kit-car-2026",
  name: "CCCS Grand Prix (kit car), 2026 rules",
  organization: "CCCS church kit-car Grand Prix",
  effective: "2026",
  sourceLine: "Source: CCCS event rules page, accessed October 2026",
  provenance: "PUBLISHED",
  review: { status: "UNREVIEWED" },
  limits: [
    lim("RUL-001", "Overall length", "max", "7.000", "in"),
    lim("RUL-002", "Overall width", "max", "2.750", "in"),
    lim("RUL-003", "Overall height", "max", "3.000", "in"),
    lim("RUL-004", "Underside clearance", "min", "0.375", "in"),
    lim("RUL-005", "Inside wheel spacing", "min", "1.750", "in"),
    lim("RUL-006", "Mass", "max", "5.000", "oz"),
  ],
  // Spec 9.2: what the source says, and what it leaves UNKNOWN.
  event: {
    kitPartsOnly: true,
    // The source requires the club's own kit wood, wheels and axles (spec 9.2).
    issuedKit: "club",
    axleSlots: "unknown",
    wheelReshaping: "prohibited",
    bentAxles: "unknown",
    raisedWheel: "unknown",
    washersBearings: "unknown",
    lubricant: "unknown",
    checklist: [
      "Entrant present at check-in.",
      "Car built for this race and not raced before.",
      "No changes after check-in.",
      "The child takes part in the design and build.",
      "The kit maker's name stays visible on the wheel sidewalls (RUL-009).",
    ],
  },
};

/** The rules a design is held to: its own snapshot, or the shipped ruleset for designs from before rulesets travelled with them. */
export const rulesOf = (d: Pick<CarDesign, "rules">): Ruleset => d.rules ?? CCCS_KIT_CAR_2026;

/** A limit of a ruleset, or undefined where the event sets none. */
export const limitOf = (r: Ruleset, id: string): RuleLimit | undefined => r.limits.find((l) => l.id === id);

/**
 * A local edit of a ruleset (9.1 local overrides): the given limits in their source units (null removes
 * a limit) and event rules, under a new name, marked LOCAL and unreviewed.
 */
export function localRuleset(
  base: Ruleset,
  edit: {
    readonly name: string;
    readonly organization: string;
    readonly effective: string;
    readonly sourceLine: string;
    readonly limits: Readonly<Record<string, string | null>>;
    readonly event: EventRules;
  },
  id: string,
): Ruleset {
  const limits = LIMIT_CATALOG.flatMap((c) => {
    const v = c.id in edit.limits ? edit.limits[c.id] : limitOf(base, c.id)?.source.value;
    if (v === null || v === undefined || v.trim() === "") return [];
    if (!(Number(v) > 0)) throw new Error(`${c.label}: "${v}" is not a positive number of ${c.unit === "in" ? "inches" : "ounces"}.`);
    return [ruleLimit(c.id, c.label, c.kind, v.trim(), c.unit)];
  });
  return {
    id,
    name: edit.name,
    organization: edit.organization,
    effective: edit.effective,
    sourceLine: edit.sourceLine,
    provenance: "LOCAL",
    review: { status: "UNREVIEWED" },
    limits,
    event: edit.event,
  };
}

/**
 * Starter rules for an event whose rules are not entered yet (the kit question's default away from the
 * shipped event): the length and mass limits only, since width, height and clearances depend on the kit,
 * and the event's kit as the one chosen. Running on wheels from outside the kit says the event allows
 * other parts. LOCAL and unreviewed until the player enters their event's own rules.
 */
export function starterRules(kit: KitChoice, id: string): Ruleset {
  return localRuleset(
    CCCS_KIT_CAR_2026,
    {
      name: "My event (starter rules: length and mass only)",
      organization: "My event",
      effective: String(new Date().getFullYear()),
      sourceLine: "Starter rules, to be replaced with the event's own in Race rules",
      limits: { "RUL-002": null, "RUL-003": null, "RUL-004": null, "RUL-005": null },
      event: { ...CCCS_KIT_CAR_2026.event, kitPartsOnly: kitWheels(kit), issuedKit: kit.block.id },
    },
    id,
  );
}

export interface InspectionLine {
  readonly id: string;
  readonly label: string;
  readonly cls: ConstraintClass;
  readonly state: LineState;
  readonly limit?: RuleLimit;
  /** Measured value in SI. */
  readonly value?: number;
  /** The true value may straddle the limit: provenance or uncertainty (CMP-004). */
  readonly provisional: boolean;
  /** Strictest-reading statement, provenance, or reason (CMP-009). */
  readonly note: string;
}

export type ComplianceState =
  | "NOT EVALUATED"
  | "PARTIALLY EVALUATED"
  | "PROVISIONALLY COMPLIANT"
  | "CERTIFIED COMPLIANT"
  | "NONCOMPLIANT"
  | "SANDBOX/RULES DISABLED";

export interface Inspection {
  readonly ruleset: Ruleset;
  readonly lines: readonly InspectionLine[];
  readonly state: ComplianceState;
}

/**
 * Kit parts (spec 9.2: the event's own kit wood, wheels and axles). Passes where the event allows other
 * parts; otherwise the design must be on the kit the event issues, with that kit's wheels. Not evaluated
 * while the event's kit or the design's kit is not known.
 */
function kitLine(ev: CarEvaluation, e: EventRules): InspectionLine {
  const base = { id: "RUL-KIT", label: "Kit parts", cls: "PUBLISHED RULE" as const };
  const k = ev.kit;
  if (!e.kitPartsOnly) return { ...base, state: "PASS", provisional: false, note: "The event allows parts from outside its kit." };
  if (!e.issuedKit)
    return { ...base, state: "NOT EVALUATED", provisional: true, note: "The event requires its own kit, but which kit is not recorded: set it in Race rules." };
  const issued = blockKit(e.issuedKit)?.name ?? e.issuedKit;
  if (!ev.kitChosen) return { ...base, state: "NOT EVALUATED", provisional: true, note: `The event issues the ${issued}. Choose the kit this car is built from in the Kit panel.` };
  if (k.block.id !== e.issuedKit) return { ...base, state: "FAIL", provisional: false, note: `The event requires its own kit (${issued}); this car is built on the ${k.block.name}.` };
  if (!kitWheels(k)) return { ...base, state: "FAIL", provisional: false, note: `The event requires its kit's own wheels and axles; this car runs on ${k.wheels.name.toLowerCase()}.` };
  return { ...base, state: "PASS", provisional: false, note: `Built on the event's kit with its own wheels and axles.` };
}

/**
 * Inspect a car against a ruleset. The state depends on the compliance context (9.4, 5.2): in SANDBOX
 * a car that fails nothing is SANDBOX/RULES DISABLED, never compliant; in CERTIFIED it is CERTIFIED
 * COMPLIANT only when every line is evaluated, passed and certain, and otherwise at best PROVISIONALLY
 * COMPLIANT. A failing car is NONCOMPLIANT in either.
 */
export function inspect(ev: CarEvaluation, ruleset: Ruleset = CCCS_KIT_CAR_2026, context: ComplianceContext = "CERTIFIED"): Inspection {
  const e = ev.extents;
  const KIT_NOTE = kitNote(ev.kit);
  const measured: Record<string, { value: number; note: string; band?: number }> = {
    "RUL-001": { value: e.max[0] - e.min[0], note: `Longest point to longest point along X, every part included. ${KIT_NOTE}` },
    "RUL-002": { value: e.max[1] - e.min[1], note: `Widest points, wheels and axle heads included. ${KIT_NOTE}` },
    "RUL-003": { value: e.max[2] - (e.min[2] < 0 ? e.min[2] : 0), note: `Wheel contact plane to the tallest point. ${KIT_NOTE}` },
    "RUL-004": {
      value: e.underside.height,
      note: `Lowest non-tread point (${e.underside.what}) over the full length, not only between the axles, because the guide rail runs the whole length. ${KIT_NOTE}`,
    },
    "RUL-005": { value: e.insideWheelSpacing, note: `Inner wheel faces as installed. ${KIT_NOTE}` },
    "RUL-006": {
      value: ev.total.mass,
      band: 2 * ev.massUncertainty,
      note:
        ev.massUncertainty > 0
          ? "Predicted mass; the event's official scale decides. Wood density is ESTIMATED: weigh the block to tighten this."
          : "Predicted mass from the weighed block; the event's official scale decides.",
    },
  };
  const bad = Object.entries(ev.mounting).filter(([, m]) => m !== "touching");
  const mountLine: InspectionLine = {
    id: "GEO-MOUNT",
    label: "Weight mounting",
    cls: "GEOMETRY VALIDITY",
    state: bad.length === 0 ? "PASS" : "FAIL",
    provisional: false,
    note:
      bad.length === 0
        ? Object.keys(ev.mounting).length === 0
          ? "No surface-mounted weights."
          : "Every surface weight touches the body."
        : bad.map(([id, m]) => (m === "floating" ? `Weight ${id} is not touching the body.` : `Weight ${id} cuts into the body: drill a cavity or move it.`)).join(" "),
  };
  const blocked = ev.build.blocked;
  const accessLine: InspectionLine = {
    id: "GEO-ACCESS",
    label: "Holes can be made",
    cls: "GEOMETRY VALIDITY",
    state: blocked.length === 0 ? "PASS" : "FAIL",
    provisional: false,
    note:
      blocked.length === 0
        ? "Every bore, pocket and weight cavity has a straight way in from outside."
        : blocked.map((b) => `${b.label} (${b.id}): ${b.how}`).join(" "),
  };
  const lines: InspectionLine[] = ruleset.limits.map((l) => {
    const m = measured[l.id];
    if (!m) return { id: l.id, label: l.label, cls: "PUBLISHED RULE", state: "NOT EVALUATED", limit: l, provisional: true, note: "No measurement defined." };
    // A value equal to the limit passes ("at least", "maximum").
    const pass = l.kind === "max" ? m.value <= l.si : m.value >= l.si;
    const band = m.band ?? 0;
    const straddles = l.kind === "max" ? m.value + band > l.si : m.value - band < l.si;
    return {
      id: l.id,
      label: l.label,
      cls: "PUBLISHED RULE",
      state: pass ? "PASS" : "FAIL",
      limit: l,
      value: m.value,
      provisional: pass && (straddles || l.quantity === "length"),
      note: pass && straddles && band > 0 ? `${m.note} ADVISORY: the ±2σ mass band reaches the limit.` : m.note,
    };
  });
  lines.unshift(mountLine, accessLine);
  lines.push(
    kitLine(ev, ruleset.event),
    {
      id: "RUL-007",
      label: "Starting-gate face",
      cls: "PUBLISHED RULE",
      state: "NOT EVALUATED",
      provisional: true,
      note: "Front must not come to a point or slope upward so as to defeat the starting peg. Pin geometry is UNKNOWN (CHAR-004).",
    },
    {
      id: "ZONE-WHEEL",
      label: "Wheel envelopes",
      cls: "PROTECTED",
      state: e.wheelEnvelopeIntrusions.length === 0 ? "PASS" : "FAIL",
      provisional: false,
      note:
        e.wheelEnvelopeIntrusions.length === 0
          ? "No part enters a wheel's swept envelope (bounding box plus 1/32 in)."
          : `Weight ${e.wheelEnvelopeIntrusions.join(", ")} enters a wheel's swept envelope.`,
    },
    { id: "LOC-AX", label: "Axle locations", cls: "LOCAL/FROZEN", state: "LOCKED", provisional: false, note: "Official axle slots, unchanged; the design cannot move them." },
    { id: "LOC-WB", label: "Wheelbase", cls: "LOCAL/FROZEN", state: "LOCKED", provisional: false, note: `The ${ev.kit.block.name}'s wheelbase, unchanged.` },
  );
  const certain = lines.every((l) => (l.state === "PASS" || l.state === "LOCKED") && !l.provisional);
  const state: ComplianceState = lines.some((l) => l.state === "FAIL")
    ? "NONCOMPLIANT"
    : context === "SANDBOX"
      ? "SANDBOX/RULES DISABLED"
      : certain
        ? "CERTIFIED COMPLIANT"
        : "PROVISIONALLY COMPLIANT";
  return { ruleset, lines, state };
}

/**
 * The enforced checks a design fails: published rules, local/frozen locks and protected zones (5.2,
 * 12.2). In CERTIFIED context each blocks the edit that caused it. Geometry validity (a weight not yet
 * seated, a cavity not yet drilled through) is reported, not enforced: those are states a design
 * passes through while it is being built up, as in "place the weight, then drill its access".
 */
export const violations = (ins: Inspection): InspectionLine[] =>
  ins.lines.filter((l) => l.state === "FAIL" && (l.cls === "PUBLISHED RULE" || l.cls === "LOCAL/FROZEN" || l.cls === "PROTECTED"));
