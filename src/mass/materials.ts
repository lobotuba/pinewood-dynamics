// Ballast materials (BAL-002, MAT-005, SAF-001/003). Densities are handbook values for the pure
// metal or the common alloy; a real weight's density depends on its alloy and should be checked by
// weighing it.

import { type Sourced, sourced } from "../core/provenance.js";
import type { MaterialId } from "../geometry/design.js";

export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  /** kg/m^3 */
  readonly density: Sourced<number>;
  /** SAF-003: lead gets notices, the adult-installs tag and a non-lead alternative. */
  readonly safety: "none" | "lead";
}

const handbook = (x: number, what: string): Sourced<number> => sourced(x, "DEFAULT", `Handbook density, ${what}`);

export const MATERIALS: Readonly<Record<MaterialId, Material>> = {
  tungsten: {
    id: "tungsten",
    name: "Tungsten alloy",
    // Derby weights are usually tungsten heavy alloy (90-97 % W), 17-18.5 g/cm^3; pure W is 19.25.
    density: sourced(18000, "ESTIMATED", "Tungsten heavy alloy, typical 17-18.5 g/cm^3; pure tungsten 19.25"),
    safety: "none",
  },
  lead: { id: "lead", name: "Lead", density: handbook(11340, "pure lead"), safety: "lead" },
  steel: { id: "steel", name: "Steel", density: handbook(7850, "carbon steel"), safety: "none" },
  brass: { id: "brass", name: "Brass", density: handbook(8500, "free-cutting brass"), safety: "none" },
  zinc: { id: "zinc", name: "Zinc", density: handbook(7140, "pure zinc"), safety: "none" },
  tin: { id: "tin", name: "Tin", density: handbook(7265, "white tin"), safety: "none" },
  copper: { id: "copper", name: "Copper", density: handbook(8960, "pure copper"), safety: "none" },
  aluminium: { id: "aluminium", name: "Aluminium", density: handbook(2700, "pure aluminium"), safety: "none" },
};

/** SAF-003 notice, shown whenever lead is selected or placed and in the build package. */
export const LEAD_NOTICE =
  "Lead: an adult installs this weight. Wash hands after handling, keep it away from mouths, and do " +
  "not sand, cut, drill, file or melt it. Use whole pre-formed weights only.";

/** The non-lead alternative shown beside every lead component (SAF-003): tungsten, same mass. */
export function nonLeadAlternative(leadVolume: number): { material: Material; volume: number } {
  const t = MATERIALS.tungsten;
  return { material: t, volume: (leadVolume * MATERIALS.lead.density.value) / t.density.value };
}
