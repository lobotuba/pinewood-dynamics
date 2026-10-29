// Data-driven ruleset and inspection (spec 9; CMP-001..009, RUL-001..010). The shipped ruleset is
// named neutrally and paraphrased (BRD-007, spec 9.3). Pass/fail compares unrounded SI values with
// limits converted exactly from their source units (CMP-005, spec 6.4).

import { inches, ounces } from "../core/units.js";
import type { CarEvaluation } from "../mass/carModel.js";

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

export interface Ruleset {
  readonly id: string;
  readonly name: string;
  readonly sourceLine: string;
  readonly limits: readonly RuleLimit[];
}

const lim = (id: string, label: string, kind: "max" | "min", value: string, unit: "in" | "oz"): RuleLimit => ({
  id,
  label,
  quantity: unit === "in" ? "length" : "mass",
  kind,
  source: { value, unit },
  si: unit === "in" ? inches(Number(value)) : ounces(Number(value)),
});

export const CCCS_KIT_CAR_2026: Ruleset = {
  id: "cccs-kit-car-2026",
  name: "CCCS Grand Prix (kit car), 2026 rules",
  sourceLine: "Source: CCCS event rules page, accessed October 2026",
  limits: [
    lim("RUL-001", "Overall length", "max", "7.000", "in"),
    lim("RUL-002", "Overall width", "max", "2.750", "in"),
    lim("RUL-003", "Overall height", "max", "3.000", "in"),
    lim("RUL-004", "Underside clearance", "min", "0.375", "in"),
    lim("RUL-005", "Inside wheel spacing", "min", "1.750", "in"),
    lim("RUL-006", "Mass", "max", "5.000", "oz"),
  ],
};

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

const KIT_NOTE = "Kit dimensions are ESTIMATED until the event kit is measured (CHAR-001..003).";

export function inspect(ev: CarEvaluation, ruleset: Ruleset = CCCS_KIT_CAR_2026): Inspection {
  const e = ev.extents;
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
    { id: "LOC-WB", label: "Wheelbase", cls: "LOCAL/FROZEN", state: "LOCKED", provisional: false, note: "Nominal kit wheelbase, unchanged." },
  );
  const state: ComplianceState = lines.some((l) => l.state === "FAIL") ? "NONCOMPLIANT" : "PROVISIONALLY COMPLIANT";
  return { ruleset, lines, state };
}
