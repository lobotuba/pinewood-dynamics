// Display formatting (spec 6.4, 9.7; GEO-011, CMP-006). Metric by default, English selectable.
// Rounding never makes a failing value look like a passing one: against a minimum a value rounds
// down, against a maximum it rounds up.

import { toGrams, toInches, toMm, toOunces } from "./units.js";

export type UnitSystem = "metric" | "english";
export type Toward = "nearest" | "down" | "up";

const round = (x: number, decimals: number, toward: Toward): number => {
  const k = 10 ** decimals;
  const y = x * k;
  // Snap only floating-point noise (1e-12 relative), so 0.1778 m shows as 7.000 in, not 7.001.
  const n = Math.round(y);
  if (Math.abs(y - n) <= 1e-12 * Math.max(1, Math.abs(y))) return n / k;
  return (toward === "down" ? Math.floor(y) : toward === "up" ? Math.ceil(y) : n) / k;
};

const DECIMALS = { metric: { length: 2, mass: 2 }, english: { length: 3, mass: 3 } } as const;

function format(x: number, quantity: "length" | "mass", units: UnitSystem, toward: Toward, extra = 0): string {
  const d = DECIMALS[units][quantity] + extra;
  const v = quantity === "length" ? (units === "metric" ? toMm(x) : toInches(x)) : units === "metric" ? toGrams(x) : toOunces(x);
  const unit = quantity === "length" ? (units === "metric" ? "mm" : "in") : units === "metric" ? "g" : "oz";
  return `${round(v, d, toward).toFixed(d)} ${unit}`;
}

export const formatLength = (m: number, units: UnitSystem, toward: Toward = "nearest"): string => format(m, "length", units, toward);
export const formatMass = (kg: number, units: UnitSystem, toward: Toward = "nearest"): string => format(kg, "mass", units, toward);

/**
 * A measured value against a limit, rounded toward failure (CMP-006). If the value fails but its
 * rounded display would equal the limit's, more decimals are shown until the failure is visible.
 */
export function formatAgainstLimit(value: number, limit: number, kind: "max" | "min", quantity: "length" | "mass", units: UnitSystem): string {
  const toward: Toward = kind === "max" ? "up" : "down";
  const fails = kind === "max" ? value > limit : value < limit;
  for (let extra = 0; extra < 6; extra++) {
    const shown = format(value, quantity, units, toward, extra);
    if (!fails || shown !== format(limit, quantity, units, "nearest", extra)) return shown;
  }
  return format(value, quantity, units, toward, 6);
}

/**
 * A limit in the selected units, with its source value alongside when they differ, marked ≈ when the
 * conversion is not exact at display precision (spec 6.4): "≤ ≈141.75 g (5.000 oz)".
 */
export function formatLimit(si: number, source: { value: string; unit: "in" | "oz" }, kind: "max" | "min", units: UnitSystem): string {
  const op = kind === "max" ? "≤" : "≥";
  const sourceUnits: UnitSystem = "english";
  if (units === sourceUnits) return `${op} ${source.value} ${source.unit}`;
  const shown = source.unit === "in" ? formatLength(si, units) : formatMass(si, units);
  const exact = source.unit === "in" ? Math.abs(round(toMm(si), 2, "nearest") - toMm(si)) < 1e-9 : Math.abs(round(toGrams(si), 2, "nearest") - toGrams(si)) < 1e-9;
  return `${op} ${exact ? "" : "≈"}${shown} (${source.value} ${source.unit})`;
}
