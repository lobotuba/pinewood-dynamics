// KID level plain-language diagnostics (spec 16): the same inspection, said so a child can act on it.
// The inspection decides; these words only explain. A check without its own words falls back to the
// inspection's label and note.

import type { InspectionLine } from "../rules/cccs.js";

/** What to say about a failed check, and what to try. */
const FAILED: Readonly<Record<string, string>> = {
  "RUL-001": "Your car is too long for the race. Saw a little off the nose or the tail.",
  "RUL-002": "Your car is too wide for the race. Something sticks out at the side.",
  "RUL-003": "Your car is too tall for the race. Make the highest part lower.",
  "RUL-004": "Your car is too low underneath. It could rub on the rail down the middle of the track.",
  "RUL-005": "The wheels are too close together on the inside. They need room for the track's middle rail.",
  "RUL-006": "Your car is too heavy for the race. Take a weight out, or use a smaller one.",
  "RUL-KIT": "This race says to use the kit it hands out. Pick that kit for your car.",
  "GEO-MOUNT": "A weight is not held on properly. Put it back on the car's surface or into a hole.",
  "GEO-ACCESS": "A hole is sealed up inside the wood, so it cannot be drilled. It needs a way in from outside.",
  "ZONE-WHEEL": "Something is in the way of a wheel. Wheels need room to spin.",
};

/** Short names for a refused change ("That would make your car too long"). */
const BREAKS: Readonly<Record<string, string>> = {
  "RUL-001": "make your car too long",
  "RUL-002": "make your car too wide",
  "RUL-003": "make your car too tall",
  "RUL-004": "make your car too low underneath",
  "RUL-005": "squeeze the wheels too close together",
  "RUL-006": "make your car too heavy",
  "RUL-KIT": "use parts this race does not allow",
  "GEO-MOUNT": "leave a weight loose",
  "GEO-ACCESS": "seal a hole inside the wood",
  "ZONE-WHEEL": "put something in a wheel's way",
};

export function kidProblem(l: InspectionLine): string {
  return FAILED[l.id] ?? `${l.label}: ${l.note}`;
}

/** "That would make your car too long and make your car too heavy." for refused changes. */
export function kidRefusal(lines: readonly InspectionLine[]): string {
  const what = [...new Set(lines.map((l) => BREAKS[l.id] ?? `break the ${l.label.toLowerCase()} rule`))];
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what.at(-1)}` : what[0];
  return `That would ${list}, so it is not allowed in the race. Try something else.`;
}

/** Where the balance point sits along the wheelbase, in words. */
export function balanceWords(cgAheadOfRearAxle: number, wheelbase: number): string {
  const f = cgAheadOfRearAxle / wheelbase;
  if (f < 0) return "behind the back wheels";
  if (f < 0.15) return "right over the back wheels";
  if (f < 0.35) return "near the back";
  if (f < 0.65) return "in the middle";
  return "near the front";
}

/** A time difference as car lengths at the finish line: what a child sees when two cars race. */
export function carLengths(dt: number, finishSpeed: number, carLength: number): number {
  return (Math.abs(dt) * finishSpeed) / carLength;
}

/** How far ahead (or behind) a car finishes, `n` car lengths, in words. */
export function lengthsWords(n: number, ahead: boolean): string {
  const way = ahead ? "ahead" : "behind";
  if (n < 0.05) return "about level";
  if (n < 0.5) return `a nose ${way}`;
  if (n < 1.5) return `about a car length ${way}`;
  return `about ${Math.round(n)} car lengths ${way}`;
}
