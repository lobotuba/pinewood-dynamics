// Provenance labels (controlling spec 0.7, External Knowns Register).
// Every physical input carries one so the solver never silently turns an
// assumption into a fact.

export type Provenance =
  | "RULE"
  | "MANUFACTURER"
  | "MEASURED"
  | "DERIVED"
  | "ESTIMATED"
  | "DEFAULT"
  | "UNKNOWN"
  | "LOCAL_FROZEN";

export interface Sourced<T> {
  readonly value: T;
  readonly provenance: Provenance;
  /** Where the value came from: citation, measurement record, or reason for the estimate. */
  readonly source?: string;
}

export function sourced<T>(value: T, provenance: Provenance, source?: string): Sourced<T> {
  return source === undefined ? { value, provenance } : { value, provenance, source };
}

/** A value that has not been characterized. Using it in a calculation is an error. */
export interface Unknown {
  readonly provenance: "UNKNOWN";
  readonly note: string;
}

export function unknown(note: string): Unknown {
  return { provenance: "UNKNOWN", note };
}

export function isUnknown<T>(q: Sourced<T> | Unknown): q is Unknown {
  return q.provenance === "UNKNOWN";
}

/**
 * Least-certain provenance first; used to report the weakest input behind a result.
 * ESTIMATED ranks below DEFAULT: a default is a documented standard value (e.g. standard gravity),
 * an estimate is a modelling guess (e.g. axle friction before calibration).
 */
const CERTAINTY_ORDER: readonly Provenance[] = [
  "UNKNOWN",
  "ESTIMATED",
  "DEFAULT",
  "DERIVED",
  "LOCAL_FROZEN",
  "MEASURED",
  "MANUFACTURER",
  "RULE",
];

export function weakest(provenances: Iterable<Provenance>): Provenance {
  let worst = CERTAINTY_ORDER.length - 1;
  for (const p of provenances) worst = Math.min(worst, CERTAINTY_ORDER.indexOf(p));
  return CERTAINTY_ORDER[worst]!;
}
