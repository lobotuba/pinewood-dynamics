// Race-day environment (AERO-001): air density from the room's temperature, pressure and humidity.

import { sourced } from "../core/provenance.js";
import { STANDARD_GRAVITY } from "../core/units.js";
import type { Environment } from "./car.js";

const R_UNIVERSAL = 8.314462618; // J/(mol K), CODATA 2018 (exact by SI definition of k and N_A)
const M_DRY_AIR = 0.0289652; // kg/mol
const M_WATER = 0.01801528; // kg/mol

/** Saturation vapour pressure over water, Pa (Buck 1996), valid about -40..50 C. */
export function saturationVapourPressure(temperatureC: number): number {
  const T = temperatureC;
  return 611.21 * Math.exp((18.678 - T / 234.5) * (T / (257.14 + T)));
}

/**
 * Moist-air density, kg/m^3, treating dry air and water vapour as ideal gases (partial pressures).
 * relativeHumidity is a fraction 0..1. The ideal-gas error is below 0.05% at room conditions.
 */
export function airDensity(temperatureC: number, pressurePa: number, relativeHumidity = 0): number {
  const T = temperatureC + 273.15;
  const pv = relativeHumidity * saturationVapourPressure(temperatureC);
  return ((pressurePa - pv) * M_DRY_AIR + pv * M_WATER) / (R_UNIVERSAL * T);
}

export interface RoomConditions {
  readonly temperatureC: number;
  readonly pressurePa: number;
  readonly relativeHumidity: number;
  /** How the conditions were obtained, e.g. "thermometer and barometer at the track". */
  readonly note: string;
  readonly measured: boolean;
}

/** Environment with air density DERIVED from room conditions (MEASURED inputs) or estimates. */
export function environmentFrom(room: RoomConditions): Environment {
  const rho = airDensity(room.temperatureC, room.pressurePa, room.relativeHumidity);
  const how = `${room.temperatureC} C, ${room.pressurePa} Pa, RH ${room.relativeHumidity}: ${room.note}`;
  return {
    gravity: sourced(STANDARD_GRAVITY, "DEFAULT", "Standard gravity"),
    airDensity: sourced(rho, room.measured ? "DERIVED" : "ESTIMATED", how),
  };
}
