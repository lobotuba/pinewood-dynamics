// Exact unit conversions (controlling spec 6.4, GEO-006, GEO-011).
// Internal master units are SI: metre, kilogram, second, radian.

export const M_PER_IN = 0.0254; // exact by definition
export const M_PER_FT = 12 * M_PER_IN;
export const M_PER_MM = 0.001;
export const KG_PER_OZ = 0.028349523125; // avoirdupois ounce, exact by definition
export const KG_PER_G = 0.001;

export const inches = (x: number): number => x * M_PER_IN;
export const feet = (x: number): number => x * M_PER_FT;
export const mm = (x: number): number => x * M_PER_MM;
export const ounces = (x: number): number => x * KG_PER_OZ;
export const grams = (x: number): number => x * KG_PER_G;
export const degrees = (x: number): number => (x * Math.PI) / 180;

export const toInches = (m: number): number => m / M_PER_IN;
export const toMm = (m: number): number => m / M_PER_MM;
export const toOunces = (kg: number): number => kg / KG_PER_OZ;
export const toGrams = (kg: number): number => kg / KG_PER_G;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

/** Standard gravity (CGPM 1901). Spec: DEFAULT unless precision testing shows a need for local g. */
export const STANDARD_GRAVITY = 9.80665;
