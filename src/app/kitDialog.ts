// The kit question (KIT-001): local races use different kits, so the player is asked which kit the car
// is built from when they start (first launch, and New). Every kit in the library is offered, with the
// wheels it can run on and the rules the car is held to; a ruleset that names its event's kit says so
// before the car is started on another one.

import { type UnitSystem, formatLength } from "../core/display.js";
import { type BlockKit, BLOCK_KITS, type KitChoice, blockKit, kitChoice, kitWheels, wheelChoices } from "../kit/kit.js";
import { CCCS_KIT_CAR_2026, type Ruleset, starterRules } from "../rules/cccs.js";
import { kitOf } from "../geometry/design.js";
import type { Store } from "./store.js";

export interface KitAnswer {
  readonly kit: KitChoice;
  readonly shape: "wedge" | "uncut";
  readonly rules: Ruleset;
  /** The rules were made here (starter rules) and belong in the store's library. */
  readonly newRules: boolean;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const STARTER = "starter";

const dims = (b: BlockKit, u: UnitSystem): string =>
  `${formatLength(b.length.value, u)} × ${formatLength(b.width.value, u)} × ${formatLength(b.height.value, u)} block, ` +
  `${formatLength(b.frontAxleFromRear.value - b.rearAxleFromRear.value, u)} wheelbase, ${b.slots} slots`;

/** Why a ruleset will not pass a car on this kit, or "" if it can. */
function conflict(r: Ruleset, kit: KitChoice): string {
  const e = r.event;
  if (!e.kitPartsOnly || !e.issuedKit) return "";
  const issued = blockKit(e.issuedKit)?.name ?? e.issuedKit;
  if (e.issuedKit !== kit.block.id) return `These rules require the event's own kit (${issued}): a car on another kit is inspected as noncompliant and opens in SANDBOX.`;
  if (!kitWheels(kit)) return `These rules require the kit's own wheels and axles: a car on other wheels is inspected as noncompliant and opens in SANDBOX.`;
  return "";
}

/**
 * Ask which kit, wheels, rules and starting shape. Resolves null when the player skips (first launch:
 * decide later, the default kit assumed) or cancels.
 */
export function askKit(dlg: HTMLDialogElement, store: Store, o: { readonly first: boolean; readonly shape: "wedge" | "uncut" }): Promise<KitAnswer | null> {
  const u = store.view.units;
  const d = store.design;
  const current = d.kit ? kitOf(d).block.id : "";
  const rulesets: Ruleset[] = [CCCS_KIT_CAR_2026, ...store.rulesets];
  dlg.innerHTML = `
    <form method="dialog" class="kit-form">
      <h2>Which kit is your car built from?</h2>
      <p class="hint">Races use different kits. Pick the one in your box, or the closest. Its sizes are estimates until you
        measure your own parts in the Kit panel.</p>
      <fieldset class="kit-list"><legend>Block</legend>
        ${BLOCK_KITS.map(
          (b) => `<label class="kit-card"><input type="radio" name="kd-block" value="${b.id}" ${b.id === (current || BLOCK_KITS[0]!.id) ? "checked" : ""}>
            <span><b>${esc(b.name)}</b><span class="hint">${esc(dims(b, u))}${b.notModelled ? ". Driver cut-out not in the block: cut it as a pocket" : ""}</span></span></label>`,
        ).join("")}
      </fieldset>
      <div class="kit-fields">
        <label>Wheels <select id="kd-wheels"></select></label>
        <label>Rules <select id="kd-rules"></select></label>
        <label>Start from <select id="kd-shape"><option value="wedge" ${o.shape === "wedge" ? "selected" : ""}>Wedge starter</option><option value="uncut" ${o.shape === "uncut" ? "selected" : ""}>Uncut block</option></select></label>
      </div>
      <p id="kd-warn" class="notice" hidden></p>
      <div class="kit-actions">
        <button value="skip" id="kd-skip">${o.first ? "Not sure: decide later" : "Cancel"}</button>
        <button value="ok" id="kd-ok" class="primary">Start this car</button>
      </div>
    </form>`;
  const q = <T extends HTMLElement>(id: string): T => dlg.querySelector<T>(`#${id}`)!;
  const wheelsSel = q<HTMLSelectElement>("kd-wheels");
  const rulesSel = q<HTMLSelectElement>("kd-rules");
  let rulesTouched = false;
  const block = (): BlockKit => blockKit(dlg.querySelector<HTMLInputElement>('input[name="kd-block"]:checked')!.value)!;
  const kit = (): KitChoice => {
    const b = block();
    return kitChoice(b, wheelChoices(b).find((w) => w.id === wheelsSel.value) ?? b.wheels);
  };
  const fill = (): void => {
    const b = block();
    const keep = wheelsSel.value;
    wheelsSel.innerHTML = wheelChoices(b)
      .map((w) => `<option value="${w.id}" ${w.id === keep ? "selected" : ""}>${w.kit ? "The kit's own wheels and axles" : esc(w.name)}</option>`)
      .join("");
    // Until the player picks rules, offer the shipped rules where they fit this kit, otherwise starter rules.
    const fits = rulesets.find((r) => r.event.issuedKit === b.id && !conflict(r, kit()));
    const pick = rulesTouched ? rulesSel.value : (fits?.id ?? STARTER);
    rulesSel.innerHTML = [
      ...rulesets.map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name)}${r.provenance === "LOCAL" ? " (local)" : ""}${
            r.event.kitPartsOnly && r.event.issuedKit ? `: ${esc(blockKit(r.event.issuedKit)?.name.split(":")[0]?.toLowerCase() ?? r.event.issuedKit)} only` : ""
          }</option>`,
      ),
      `<option value="${STARTER}">My event's rules: start with length and mass, add the rest later</option>`,
    ].join("");
    rulesSel.value = pick;
    const r = rulesets.find((x) => x.id === rulesSel.value);
    const why = r ? conflict(r, kit()) : "";
    const warn = q<HTMLParagraphElement>("kd-warn");
    warn.textContent = why;
    warn.hidden = !why;
  };
  dlg.onchange = (e) => {
    if ((e.target as HTMLElement).id === "kd-rules") rulesTouched = true;
    fill();
  };
  fill();
  return new Promise((resolve) => {
    dlg.onclose = () => {
      if (dlg.returnValue !== "ok") return resolve(null);
      const k = kit();
      const shape = q<HTMLSelectElement>("kd-shape").value === "uncut" ? "uncut" : "wedge";
      const chosen = rulesets.find((r) => r.id === rulesSel.value);
      resolve(
        chosen
          ? { kit: k, shape, rules: chosen, newRules: false }
          : { kit: k, shape, rules: starterRules(k, `local-${Date.now().toString(36)}`), newRules: true },
      );
    };
    dlg.showModal();
  });
}
