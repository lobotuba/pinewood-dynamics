// Sidebar panels: Design Constraints (12.5), mass and CG (7.6), weights (12.4, SAF-003), holes and
// cuts with their build tiers (12.3, 12.6), inspection (9.7, 9.8) and the race preview. States are
// always written out in words, never colour alone (ACC-001).

import { type BuildStep, SQUARE_ENTRY, tierTools } from "../build/tiers.js";
import { type UnitSystem, formatAgainstLimit, formatLength, formatLimit, formatMass } from "../core/display.js";
import { inches, ounces, toInches, toMm, toOunces } from "../core/units.js";
import type { Axis, Ballast, BallastShape, CarDesign, Cut, Feature, MaterialId, Plane, V3 } from "../geometry/design.js";
import { blockBox, kitOf, kitValuesOf, withKit } from "../geometry/design.js";
import {
  BLOCK_KITS,
  type KitChoice,
  type Measurable,
  blockKit,
  catalogueKit,
  kitNote,
  kitWheels,
  measuredKit,
  slotPositions,
  turnedKit,
  wheelChoices,
} from "../kit/kit.js";
import type { Provenance, Sourced } from "../core/provenance.js";
import { CUT_PRESETS, type CutPreset, HOLE_FACES, type HoleFace } from "../geometry/presets.js";
import type { MountState } from "../geometry/solid.js";
import { AXLE_PREPS, type CarEvaluation, shapeHalfSize, shapeVolume } from "../mass/carModel.js";
import { LEAD_NOTICE, MATERIALS, nonLeadAlternative } from "../mass/materials.js";
import { CCCS_KIT_CAR_2026, type EventRules, type Inspection, type InspectionLine, LIMIT_CATALOG, type Permission, type Ruleset, limitOf, localRuleset, rulesOf } from "../rules/cccs.js";
import type { RaceReply } from "./race.worker.js";
import { exportGate } from "../build/package.js";
import { contextOf } from "../geometry/design.js";
import type { Store } from "./store.js";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Why a kit's slots cannot sit where it puts them, or "". */
function slotsWrong(k: KitChoice): string {
  const p = slotPositions(k.block);
  return p.rear.value > 0 && p.front.value > p.rear.value && p.front.value < k.block.length.value
    ? ""
    : "The front slot must be ahead of the rear slot, and both within the block.";
}

/** A length typed in the display units, back to metres. */
const parseLength = (text: string, u: UnitSystem): number | null => {
  const x = Number(text);
  return Number.isFinite(x) && x > 0 ? (u === "metric" ? x / 1000 : inches(x)) : null;
};
/** A signed coordinate typed in the display units, back to metres. */
const parseCoord = (text: string, u: UnitSystem): number | null => {
  const x = Number(text);
  return text.trim() !== "" && Number.isFinite(x) ? (u === "metric" ? x / 1000 : inches(x)) : null;
};
const showLength = (m: number, u: UnitSystem): string => (u === "metric" ? toMm(m).toFixed(2) : toInches(m).toFixed(3));
const lengthUnit = (u: UnitSystem): string => (u === "metric" ? "mm" : "in");
const lengthStep = (u: UnitSystem): number => (u === "metric" ? 0.25 : 0.01);
const DEG = Math.PI / 180;

const STATE_ICON: Record<string, string> = { PASS: "✓", FAIL: "✗", LOCKED: "🔒", "NOT EVALUATED": "–" };

/** Plane normal as azimuth (about Z, from +X) and elevation (from the XY plane), degrees. */
const toAngles = (n: V3): [number, number] => {
  const l = Math.hypot(...n) || 1;
  return [Math.atan2(n[1], n[0]) / DEG, Math.asin(Math.max(-1, Math.min(1, n[2] / l))) / DEG];
};
const fromAngles = (az: number, el: number): V3 => [Math.cos(el * DEG) * Math.cos(az * DEG), Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG)];

/** What the panels need from the solid; main supplies them. */
export interface PanelTools {
  /** Rest a surface weight on the body. */
  seat(b: Ballast): Ballast;
  /** The shortest access hole to a cavity weight, or null if it already opens to the surface. */
  access(b: Ballast, id: string): Feature | null;
  hole(kind: "bore" | "pocket", id: string, face: HoleFace, x: number, width: number, width2: number, depth: number): Feature;
  cut(preset: CutPreset, id: string, size: number, x: number): Cut;
}

export class Panels {
  private seq = 0;
  /** The latest evaluation, so a form-only change can re-render without a new solid. */
  private lastEv: CarEvaluation | null = null;
  /**
   * The add forms are rebuilt only when their key (units, and the hole-or-cut type) changes, so a
   * design update never replaces a form being filled in. Typed values carry over a rebuild.
   */
  private readonly formValues = new Map<string, string>();
  private readonly formKeys = new Map<string, string>();
  /** Open state of the build-sequence list, which is re-rendered with the plan. */
  private readonly openForms = new Set<string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
    private readonly tools: PanelTools,
  ) {
    root.innerHTML = `
      <section id="p-kit" aria-label="Kit"><div id="p-kit-summary"></div><div id="p-kit-form"></div></section>
      <section id="p-constraints" aria-label="Design constraints"></section>
      <section id="p-mass" aria-label="Mass and centre of gravity"></section>
      <section id="p-weights" aria-label="Weights"><div id="p-weights-list"></div><div id="p-weights-form"></div>
        <p class="hint">Drag weights in the 3D view or in either profile.</p></section>
      <section id="p-features" aria-label="Holes, cuts and build tier"><div id="p-features-list"></div><div id="p-features-form"></div>
        <p class="hint">Drag holes and cuts in either profile. A cut seen edge-on shows a handle per plane to turn it.</p></section>
      <section id="p-rules" aria-label="Race rules"><div id="p-rules-summary"></div><div id="p-rules-form"></div></section>
      <section id="p-inspection" aria-label="Inspection"></section>
      <section id="p-build" aria-label="Build package"></section>
      <section id="p-race" aria-label="Race preview"></section>`;
    root.addEventListener("change", (e) => this.onChange(e));
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (/^(aw|af)-/.test(t.id)) this.formValues.set(t.id, t.value);
    });
    // toggle does not bubble.
    root.addEventListener(
      "toggle",
      (e) => {
        const t = e.target as HTMLDetailsElement;
        if (!t.dataset.form) return;
        if (t.open) this.openForms.add(t.dataset.form);
        else this.openForms.delete(t.dataset.form);
      },
      true,
    );
  }

  private q(id: string): HTMLElement {
    return this.root.querySelector(`#${id}`)!;
  }

  /** A remembered form value, or its default. */
  private fv(id: string, fallback: string): string {
    return esc(this.formValues.get(id) ?? fallback);
  }
  private sel(id: string, value: string, fallback: string): string {
    return (this.formValues.get(id) ?? fallback) === value ? "selected" : "";
  }

  render(d: CarDesign, ev: CarEvaluation, ins: Inspection): void {
    this.lastEv = ev;
    const u = this.store.view.units;
    this.renderConstraints(ins);
    this.renderMass(d, ev, u);
    this.renderWeights(d, ev, u);
    this.renderFeatures(d, ev, u);
    this.renderInspection(ins, u);
    this.renderRules(d);
    this.renderBuild(ins);
    this.renderKit(d);
  }

  // --- kit (KIT-001, CHAR-001..003) -------------------------------------------------------------

  private kitError = "";

  private renderKit(d: CarDesign): void {
    const u = this.store.view.units;
    const k = kitOf(d);
    const b = k.block;
    const w = k.wheels;
    const L = (s: Sourced<number>) => formatLength(s.value, u);
    const tag = (...p: Provenance[]) => `<span class="tag">${[...new Set(p)].join("/")}</span>`;
    const pos = slotPositions(b);
    this.q("p-kit-summary").innerHTML = `
      <h2>Kit</h2>
      ${d.kit ? "" : `<p class="notice"><b>No kit chosen.</b> The standard kit is assumed. Which kit is your car built from?</p>`}
      <div class="kit-pick">
        <label>Block kit <select id="kit-block">${d.kit ? "" : `<option value="" selected>Not chosen (standard assumed)</option>`}${BLOCK_KITS.map(
          (x) => `<option value="${x.id}" ${d.kit && x.id === b.id ? "selected" : ""}>${esc(x.name)}</option>`,
        ).join("")}</select></label>
        <label>Wheels <select id="kit-wheels">${wheelChoices(b)
          .map((x) => `<option value="${x.id}" ${x.id === w.id ? "selected" : ""}>${x.kit ? "The kit's own wheels and axles" : esc(x.name)}</option>`)
          .join("")}</select></label>
      </div>
      <table class="kv">
        <tr><th>Block</th><td>${L(b.length)} × ${L(b.width)} × ${L(b.height)}${tag(b.length.provenance, b.width.provenance, b.height.provenance)}</td></tr>
        <tr><th>Wheelbase (${b.slots} slots)</th><td>${formatLength(pos.front.value - pos.rear.value, u)}${tag(pos.rear.provenance, pos.front.provenance)}</td></tr>
        <tr><th>Slot depth</th><td>${L(b.slotDepth)}${tag(b.slotDepth.provenance)}</td></tr>
        <tr><th>Wheel</th><td>⌀ ${L(w.diameter)}, ${formatMass(w.mass.value, u)}${tag(w.diameter.provenance, w.mass.provenance)}</td></tr>
        <tr><th>Axle</th><td>⌀ ${L(w.axleDiameter)} × ${L(w.axleLength)}${tag(w.axleDiameter.provenance, w.axleLength.provenance)}</td></tr>
      </table>
      ${b.notModelled ? `<p class="hint">${esc(b.notModelled)}</p>` : ""}
      ${!kitWheels(k) ? `<p class="hint">Wheels from outside the kit: check that your event allows them (Race rules, Kit parts).</p>` : ""}
      <p class="prov">${esc(kitNote(k))}</p>
      <p class="hint">Changing the kit keeps the shape on the wood; the wheels move to the new kit's slots.</p>`;
    // Measurements: blank keeps the value shown, a typed value is MEASURED.
    const fields: [Measurable, string, "length" | "mass", Sourced<number>][] = [
      ["length", "Block length", "length", b.length],
      ["width", "Block width", "length", b.width],
      ["height", "Block height", "length", b.height],
      ["slotDepth", "Axle slot depth", "length", b.slotDepth],
      ["diameter", "Wheel diameter", "length", w.diameter],
      ["wheelWidth", "Wheel width, hub to outer face", "length", w.width],
      ["mass", "One wheel's mass", "mass", w.mass],
      ["axleDiameter", "Axle diameter", "length", w.axleDiameter],
    ];
    const shown = (q: "length" | "mass", s: Sourced<number>) =>
      q === "length" ? showLength(s.value, u) : u === "metric" ? (s.value * 1000).toFixed(2) : toOunces(s.value).toFixed(3);
    const own = JSON.stringify(k) !== JSON.stringify(catalogueKit(k));
    const estimated = pos.rear.provenance === "ESTIMATED" || pos.front.provenance === "ESTIMATED";
    const overhang = (s: Sourced<number>, front: boolean) => formatLength(front ? b.length.value - s.value : s.value, u);
    this.form("p-kit-form", `${u}|${JSON.stringify(k)}|${this.kitError}|${this.slotError}`, () => `
      <div class="kit-edit kit-slots">
        <h3>Axle slots</h3>
        <table class="kv">
          <tr><th>Rear slot centre from the rear face</th><td>${L(pos.rear)}${tag(pos.rear.provenance)}</td></tr>
          <tr><th>Front slot centre from the rear face</th><td>${L(pos.front)}${tag(pos.front.provenance)}</td></tr>
          <tr><th>Overhang, rear and front</th><td>${overhang(pos.rear, false)} / ${overhang(pos.front, true)}</td></tr>
        </table>
        ${
          estimated
            ? `<p class="hint">${
                b.slots === "offset" ? "The catalogue does not say where this kit's offset slots sit: these are the standard kit's, an estimate." : "Estimated."
              } Measure from the car's rear face to the centre of each slot and set them here.</p>`
            : ""
        }
        <div class="form">
          <label>Rear slot (${lengthUnit(u)}) <input id="ks-rear" inputmode="decimal" placeholder="${showLength(pos.rear.value, u)}"></label>
          <label>Front slot (${lengthUnit(u)}) <input id="ks-front" inputmode="decimal" placeholder="${showLength(pos.front.value, u)}"></label>
          ${this.slotError ? `<p class="bad wide">${esc(this.slotError)}</p>` : ""}
          <button id="ks-save" class="wide">Set slot positions</button>
          ${
            b.slots === "offset"
              ? `<button id="ks-turn" class="wide">Turn the block end for end</button>
                 <p class="hint wide">Swaps the overhangs: the slots move, the shape you drew stays as it is.${b.turned ? " The block is turned from the kit's way round." : ""}</p>`
              : ""
          }
        </div>
      </div>
      <details class="kit-edit" data-form="km"><summary>Enter your kit's measurements</summary>
        <p class="hint">Measure the parts in your kit box and type what you find; leave a field blank to keep the value shown.
          Typed values are marked MEASURED for this car. Weigh the block in Mass and CG.</p>
        <div class="form">
          ${fields
            .map(
              ([id, label, q, s]) =>
                `<label>${label} (${q === "length" ? lengthUnit(u) : u === "metric" ? "g" : "oz"}) <input id="km-${id}" inputmode="decimal" placeholder="${shown(q, s)}${
                  s.provenance === "MEASURED" ? " measured" : ""
                }"></label>`,
            )
            .join("")}
          ${this.kitError ? `<p class="bad wide">${esc(this.kitError)}</p>` : ""}
          <button id="km-save" class="wide">Use these measurements</button>
        </div></details>
      ${
        own
          ? `<p class="hint">Your measurements are kept for your next car on this kit.</p><button id="km-reset">Back to the catalogue values</button>`
          : ""
      }`);
  }

  private saveKitMeasurements(): void {
    const d = this.store.design;
    const u = this.store.view.units;
    const m: Partial<Record<Measurable, number>> = {};
    const ids: Measurable[] = ["length", "width", "height", "slotDepth", "diameter", "wheelWidth", "mass", "axleDiameter"];
    for (const id of ids) {
      const text = this.root.querySelector<HTMLInputElement>(`#km-${id}`)!.value.trim();
      if (!text) continue;
      const x = Number(text);
      const si = !(x > 0) ? null : id === "mass" ? (u === "metric" ? x / 1000 : ounces(x)) : parseLength(text, u);
      if (si === null) {
        this.kitError = `"${text}" is not a positive number.`;
        this.renderKit(d);
        return;
      }
      m[id] = si;
    }
    const next = measuredKit(kitOf(d), m, `Measured by the player, ${new Date().toISOString().slice(0, 10)}`);
    const why = slotsWrong(next);
    if (why) {
      this.kitError = why;
      this.renderKit(d);
      return;
    }
    this.kitError = "";
    this.useKit(d, next);
  }

  private slotError = "";

  /** Set the slot positions the player measured on their car (blank keeps the one shown). */
  private saveSlots(): void {
    const d = this.store.design;
    const u = this.store.view.units;
    const m: Partial<Record<Measurable, number>> = {};
    for (const [id, key] of [["ks-rear", "rearAxleFromRear"], ["ks-front", "frontAxleFromRear"]] as const) {
      const text = this.root.querySelector<HTMLInputElement>(`#${id}`)!.value.trim();
      if (!text) continue;
      const si = Number(text) > 0 ? parseLength(text, u) : null;
      if (si === null) {
        this.slotError = `"${text}" is not a positive number.`;
        this.renderKit(d);
        return;
      }
      m[key] = si;
    }
    if (m.rearAxleFromRear === undefined && m.frontAxleFromRear === undefined) return;
    const next = measuredKit(kitOf(d), m, `Measured by the player, ${new Date().toISOString().slice(0, 10)}`);
    this.slotError = slotsWrong(next);
    if (this.slotError) {
      this.renderKit(d);
      return;
    }
    this.useKit(d, next);
  }

  /** Put the car on this kit and keep it as the player's record of the kit for their next car. */
  private useKit(d: CarDesign, k: KitChoice): void {
    this.store.rememberKit(k);
    this.store.update(withKit(d, k));
  }

  // --- race rules (9.1) -----------------------------------------------------------------------

  private rulesError = "";

  /** The rulesets a design can take: the shipped ones, the local ones, and its own snapshot if it is neither. */
  private rulesChoices(d: CarDesign): Ruleset[] {
    const all: Ruleset[] = [CCCS_KIT_CAR_2026, ...this.store.rulesets];
    const own = rulesOf(d);
    return all.some((r) => r.id === own.id) ? all : [...all, own];
  }

  private renderRules(d: CarDesign): void {
    const r = rulesOf(d);
    const u = this.store.view.units;
    const choices = this.rulesChoices(d);
    const limits = r.limits.map((l) => `<li>${esc(l.label)} ${formatLimit(l.si, l.source, l.kind, u)}</li>`).join("");
    const open = LIMIT_CATALOG.filter((c) => !limitOf(r, c.id)).map((c) => c.label);
    this.q("p-rules-summary").innerHTML = `
      <h2>Race rules</h2>
      <div class="row"><select id="rules-pick" aria-label="Rules this car is held to">${choices
        .map((c) => `<option value="${esc(c.id)}" ${c.id === r.id ? "selected" : ""}>${esc(c.name)}${c.provenance === "LOCAL" ? " (local)" : ""}</option>`)
        .join("")}</select>
        ${this.store.rulesets.some((x) => x.id === r.id) ? `<button class="icon-btn" id="rules-delete" title="Delete this local ruleset">×</button>` : ""}</div>
      <p class="prov">${esc(r.organization)}, ${esc(r.effective)}. ${esc(r.sourceLine)}.
        <span class="tag">${r.provenance}</span> <span class="tag">${r.review.status === "CONFIRMED" ? `CONFIRMED ${esc(r.review.date ?? "")}` : "UNREVIEWED"}</span></p>
      <ul class="rule-limits">${limits}<li>Kit: ${
        !r.event.kitPartsOnly ? "parts from outside the kit allowed" : r.event.issuedKit ? `the event's own (${esc(blockKit(r.event.issuedKit)?.name ?? r.event.issuedKit)})` : "the event's own (which kit not recorded)"
      }</li></ul>
      ${open.length ? `<p class="hint">No limit set for: ${open.join(", ")}.</p>` : ""}`;
    // The edit form is rebuilt only when the rules themselves change, so typing in it survives updates.
    const lim = (id: string) => limitOf(r, id)?.source.value ?? "";
    const sel = (id: string, value: string, options: [string, string][]) =>
      `<select id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const permit: [string, string][] = [
      ["unknown", "Not stated"],
      ["allowed", "Allowed"],
      ["prohibited", "Not allowed"],
    ];
    this.form("p-rules-form", `${u}|${JSON.stringify(r)}|${this.rulesError}`, () => `
      <details class="rules-edit" data-form="rl"><summary>Edit as local rules</summary>
        <p class="hint">Local events vary. Copy your event's written rules here; the car is then inspected, blocked in
          CERTIFIED context, raced and exported under them. Leave a limit blank if your event does not set it.</p>
        <div class="form">
          <label>Name <input id="rl-name" value="${esc(r.provenance === "LOCAL" ? r.name : `${r.name} (local)`)}"></label>
          <label>Event or club <input id="rl-org" value="${esc(r.organization)}"></label>
          <label>Effective (year or date) <input id="rl-effective" value="${esc(r.effective)}"></label>
          <label>Source <input id="rl-source" value="${esc(r.provenance === "LOCAL" ? r.sourceLine : "Our event's rules sheet")}"></label>
          ${LIMIT_CATALOG.map(
            (c) => `<label>${c.label}, ${c.kind === "max" ? "at most" : "at least"} (${c.unit}) <input id="rl-${c.id}" inputmode="decimal" value="${esc(lim(c.id))}"></label>`,
          ).join("")}
          <label>Kit parts only ${sel("rl-kit", r.event.kitPartsOnly ? "yes" : "no", [["yes", "Required"], ["no", "Not required"]])}</label>
          <label>Event kit ${sel("rl-issued", r.event.issuedKit ?? "", [["", "Not stated"], ...BLOCK_KITS.map((b): [string, string] => [b.id, esc(b.name)])])}</label>
          <label>Kit axle slots ${sel("rl-slots", r.event.axleSlots, [["unknown", "Not stated"], ["required", "Must be used"], ["optional", "Optional"]])}</label>
          <label>Reshaping wheels ${sel("rl-wheels", r.event.wheelReshaping, permit)}</label>
          <label>Bent or canted axles ${sel("rl-bent", r.event.bentAxles, permit)}</label>
          <label>Raised wheel ${sel("rl-raised", r.event.raisedWheel, permit)}</label>
          <label>Washers, bearings ${sel("rl-washers", r.event.washersBearings, permit)}</label>
          <label>Lubricant ${sel("rl-lube", r.event.lubricant, [["unknown", "Not stated"], ["dry only", "Dry only"], ["any", "Any"], ["none", "None"]])}</label>
          <label class="wide">Check-in checklist, one per line <textarea id="rl-checklist" rows="4">${esc(r.event.checklist.join("\n"))}</textarea></label>
          <label class="wide check"><input type="checkbox" id="rl-confirmed" ${r.review.status === "CONFIRMED" ? "checked" : ""}> Checked against the event's written rules</label>
          ${this.rulesError ? `<p class="bad wide">${esc(this.rulesError)}</p>` : ""}
          <button id="rl-save" class="wide">Save and use these rules</button>
        </div></details>`);
  }

  private saveRules(): void {
    const d = this.store.design;
    const base = rulesOf(d);
    const v = (id: string) => this.root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)!.value;
    const limits: Record<string, string | null> = {};
    for (const c of LIMIT_CATALOG) limits[c.id] = v(`rl-${c.id}`).trim() || null;
    try {
      const id = base.provenance === "LOCAL" ? base.id : `local-${Date.now().toString(36)}`;
      const made = localRuleset(
        base,
        {
          name: v("rl-name").trim() || "Local rules",
          organization: v("rl-org").trim(),
          effective: v("rl-effective").trim(),
          sourceLine: v("rl-source").trim(),
          limits,
          event: {
            kitPartsOnly: v("rl-kit") === "yes",
            ...(v("rl-issued") ? { issuedKit: v("rl-issued") } : {}),
            axleSlots: v("rl-slots") as EventRules["axleSlots"],
            wheelReshaping: v("rl-wheels") as Permission,
            bentAxles: v("rl-bent") as Permission,
            raisedWheel: v("rl-raised") as Permission,
            washersBearings: v("rl-washers") as Permission,
            lubricant: v("rl-lube") as EventRules["lubricant"],
            checklist: v("rl-checklist").split("\n").map((x) => x.trim()).filter(Boolean),
          },
        },
        id,
      );
      const confirmed = this.root.querySelector<HTMLInputElement>("#rl-confirmed")!.checked;
      const rules: Ruleset = confirmed ? { ...made, review: { status: "CONFIRMED", date: new Date().toISOString().slice(0, 10) } } : made;
      this.rulesError = "";
      this.store.saveRuleset(rules);
      this.store.update({ ...d, rules });
    } catch (err) {
      this.rulesError = (err as Error).message;
      this.renderRules(d);
    }
  }

  /** Build package (spec 14): the downloads, and why they are not a certified export. */
  private renderBuild(ins: Inspection): void {
    const gate = exportGate(ins, contextOf(this.store.design));
    this.q("p-build").innerHTML = `
      <h2>Build package</h2>
      <div class="export-actions">
        <button data-export="sheet" title="Templates, targets, operations, holes and weights on one printable page">Build sheet</button>
        <button data-export="templates" title="Side and top outlines at 1:1, with scale-check bars">Templates (SVG)</button>
        <button data-export="stl-mm">Body STL (mm)</button>
        <button data-export="stl-in">Body STL (in)</button>
      </div>
      <p class="notice"><b>${gate.certified ? "Certified export" : `${gate.watermark}: not a certified export.`}</b> ${gate.reasons.map(esc).join(" ")}</p>
      <p class="hint">Print the templates at 100 % and measure the scale bars before cutting. The project file is Save in the top bar.</p>`;
  }

  private renderConstraints(ins: Inspection): void {
    const pick = (id: string): InspectionLine | undefined => ins.lines.find((l) => l.id === id);
    const envelope = ["RUL-001", "RUL-002", "RUL-003"].map(pick);
    const envState = envelope.some((l) => l?.state === "FAIL") ? "FAIL" : "PASS";
    const rows: [string, string, string, boolean][] = [
      [STATE_ICON.LOCKED!, "Axle locations", "LOCAL/FROZEN", false],
      [STATE_ICON.LOCKED!, "Wheelbase", "LOCAL/FROZEN", false],
      ["–", "Starting-gate face", "PUBLISHED RULE, provisional", true],
      [STATE_ICON[pick("ZONE-WHEEL")?.state ?? "PASS"]!, "Wheel envelopes", "PROTECTED", pick("ZONE-WHEEL")?.state === "FAIL"],
      [STATE_ICON[pick("RUL-004")?.state ?? "PASS"]!, "Guide-rail clearance", "PUBLISHED RULE", pick("RUL-004")?.state === "FAIL"],
      [STATE_ICON[envState]!, "Rules envelope", "PUBLISHED RULE", envState === "FAIL"],
    ];
    this.q("p-constraints").innerHTML = `
      <h2>Design constraints</h2>
      <ul class="constraints">${rows
        .map(([icon, label, cls, warn]) => `<li class="${warn ? "warn" : ""}"><span class="icon" aria-hidden="true">${icon}</span><span>${label}</span><span class="cls">${cls}</span></li>`)
        .join("")}</ul>`;
  }

  private renderMass(d: CarDesign, ev: CarEvaluation, u: UnitSystem): void {
    const groups: [string, CarEvaluation["components"][number]["group"]][] = [
      ["Body (wood)", "body"],
      ["Wheels (4)", "wheel"],
      ["Axles (4)", "axle"],
      ["Weights", "ballast"],
    ];
    const sum = (g: string): number => ev.components.filter((c) => c.group === g).reduce((a, c) => a + c.mass, 0);
    const [cx, cy, cz] = ev.total.centroid;
    const wb = blockBox(kitValuesOf(d));
    const band = 2 * ev.massUncertainty;
    this.q("p-mass").innerHTML = `
      <h2>Mass and CG</h2>
      <div class="big">${formatMass(ev.total.mass, u)} <span class="pm">${band > 0 ? `± ${formatMass(band, u)} (2σ)` : "weighed block"}</span></div>
      <table class="kv">
        ${groups.map(([label, g]) => `<tr><th>${label}</th><td>${formatMass(sum(g), u)}</td></tr>`).join("")}
        <tr><th>CG ahead of rear axle</th><td>${formatLength(cx, u)}</td></tr>
        <tr><th>CG off centre (left +)</th><td>${formatLength(cy, u)}</td></tr>
        <tr><th>CG above axle line</th><td>${formatLength(cz, u)}</td></tr>
        <tr><th>CG from rear of block</th><td>${formatLength(cx - wb.min[0], u)}</td></tr>
      </table>
      <p class="prov">Wood density ${(ev.bodyDensity.value / 1000).toFixed(3)} g/cm³ — <b>${ev.bodyDensity.provenance}</b>.
        ${ev.bodyDensity.provenance === "DERIVED" ? "From the weighed block." : "Weigh the uncut block to replace the estimate."}</p>
      <label class="row">Weighed uncut block
        <input id="block-mass" type="number" step="0.01" min="0" placeholder="not weighed"
          value="${d.measuredBlockMass === undefined ? "" : (u === "metric" ? d.measuredBlockMass * 1000 : d.measuredBlockMass / 0.028349523125).toFixed(u === "metric" ? 2 : 3)}">
        <span>${u === "metric" ? "g" : "oz"}</span></label>
      <label class="row">Axles
        <select id="axle-prep">${Object.entries(AXLE_PREPS)
          .map(([id, p]) => `<option value="${id}" ${id === d.axlePrep ? "selected" : ""}>${esc(p.name)} (μ ${p.friction.value}, ${p.friction.provenance})</option>`)
          .join("")}</select></label>
      <label class="row">Paint <input id="paint" type="color" value="${esc(d.paint)}"></label>`;
  }

  /** A step's tier, or its blocking state, as a tag. */
  private tierTag(s: BuildStep | undefined): string {
    if (!s) return "";
    if (s.state === "blocked") return '<span class="tier blocked">✗ CANNOT BE MADE</span>';
    if (s.state === "nothing") return '<span class="tier nothing">REMOVES NO WOOD</span>';
    return `<span class="tier" data-tier="${s.tier}">${s.tier}</span>`;
  }

  private posInputs(id: string, c: V3, u: UnitSystem, attr: string): string {
    return `<div class="wpos"><span class="rowlabel">at</span>${(["x", "y", "z"] as const)
      .map((a, k) => `<label>${a}<input type="number" step="${lengthStep(u)}" ${attr}="${esc(id)}" data-axis="${k}" value="${showLength(c[k]!, u)}"></label>`)
      .join("")}<span>${lengthUnit(u)}</span></div>`;
  }

  private renderWeights(d: CarDesign, ev: CarEvaluation, u: UnitSystem): void {
    const sel = this.store.view.selection;
    const mounting: Readonly<Record<string, MountState>> = ev.mounting;
    const lu = lengthUnit(u);
    const anyLead = d.ballast.some((b) => b.material === "lead");
    const item = (b: Ballast): string => {
      const mat = MATERIALS[b.material];
      const mass = mat.density.value * shapeVolume(b.shape);
      const selected = sel?.kind === "ballast" && sel.id === b.id;
      const dims =
        b.shape.kind === "cylinder"
          ? `⌀ ${formatLength(b.shape.diameter, u)} × ${formatLength(b.shape.length, u)} along ${b.shape.axis.toUpperCase()}`
          : `${b.shape.size.map((s) => showLength(s, u)).join(" × ")} ${lu}`;
      const lead = b.material === "lead" ? nonLeadAlternative(shapeVolume(b.shape)) : null;
      const step = ev.build.steps.find((s) => s.id === b.id);
      return `<li class="weight${selected ? " selected" : ""}" data-select="${esc(b.id)}">
        <div class="wtitle"><b>${esc(mat.name)}</b> ${b.material === "lead" ? '<span class="tag">ADULT INSTALLS</span>' : ""}
          <span class="wmass">${formatMass(mass, u)}</span>
          <button class="icon-btn" data-delete="${esc(b.id)}" title="Remove weight" aria-label="Remove weight">✕</button></div>
        <div class="wdims">${dims}; ${b.mounting === "cavity" ? "in a drilled cavity" : `mounted on the ${b.mounting}`}
          ${b.mounting !== "cavity" && mounting[b.id] !== "touching" ? `<span class="bad">${mounting[b.id] === "floating" ? "✗ not touching the body" : "✗ cuts into the body"}</span>` : ""}
          ${b.mounting !== "cavity" ? `<button class="icon-btn" data-seat="${esc(b.id)}" title="Rest it on the body surface">Seat</button>` : ""}</div>
        ${
          b.mounting === "cavity" && step
            ? `<div class="wdims">Cavity ${this.tierTag(step)} ${step.state === "blocked" ? `<button class="icon-btn" data-access="${esc(b.id)}" title="Drill the shortest hole from the surface to it">Drill access</button>` : ""}
               <div class="cls">${esc(step.how)}</div></div>`
            : ""
        }
        ${this.posInputs(b.id, b.center, u, "data-pos")}
        <div class="prov">Density ${(mat.density.value / 1000).toFixed(2)} g/cm³, ${mat.density.provenance}${lead ? `. Non-lead alternative: tungsten, ${formatMass(mass, u)} in ${(lead.volume * 1e6).toFixed(2)} cm³` : ""}</div>
      </li>`;
    };
    const metal = (Object.keys(MATERIALS) as MaterialId[]).map((id) => `<option value="${id}" ${this.sel("aw-material", id, "tungsten")}>${MATERIALS[id].name}</option>`).join("");
    this.q("p-weights-list").innerHTML = `
      <h2>Weights</h2>
      ${anyLead ? `<p class="notice" role="note">⚠ ${LEAD_NOTICE}</p>` : ""}
      <ul class="weights">${d.ballast.map(item).join("") || '<li class="empty">No weights yet.</li>'}</ul>`;
    this.form("p-weights-form", u, () => `
      <details class="add-weight" data-form="aw"><summary>Add weight</summary>
        <div class="form">
          <label>Material <select id="aw-material">${metal}</select></label>
          <label>Shape <select id="aw-shape"><option value="cylinder" ${this.sel("aw-shape", "cylinder", "cylinder")}>Cylinder</option><option value="block" ${this.sel("aw-shape", "block", "cylinder")}>Block</option></select></label>
          <label>Mounting <select id="aw-mount">${(
            [
              ["cavity", "Drilled cavity"],
              ["top", "Top"],
              ["underside", "Underside"],
              ["side", "Side"],
            ] as const
          )
            .map(([v, l]) => `<option value="${v}" ${this.sel("aw-mount", v, "cavity")}>${l}</option>`)
            .join("")}</select></label>
          <label>Axis (cylinder) <select id="aw-axis"><option value="y" ${this.sel("aw-axis", "y", "y")}>Across (Y)</option><option value="x" ${this.sel("aw-axis", "x", "y")}>Along (X)</option><option value="z" ${this.sel("aw-axis", "z", "y")}>Vertical (Z)</option></select></label>
          <label>Diameter / length ${lu} <input id="aw-a" type="number" step="any" value="${this.fv("aw-a", showLength(inches(0.375), u))}"></label>
          <label>Length / width ${lu} <input id="aw-b" type="number" step="any" value="${this.fv("aw-b", showLength(inches(1.0), u))}"></label>
          <label>Height ${lu} (block) <input id="aw-c" type="number" step="any" value="${this.fv("aw-c", showLength(inches(0.25), u))}"></label>
          <label>or target mass ${u === "metric" ? "g" : "oz"} <input id="aw-mass" type="number" step="any" placeholder="sets the last dimension" value="${this.fv("aw-mass", "")}"></label>
          <button id="aw-add">Add</button>
          <p class="hint">With a target mass, a cylinder's length or a block's height is calculated from the material's density.
            A cavity weight sealed inside the wood fails inspection until it has a way in: use Drill access.</p>
        </div></details>`);
  }

  private renderFeatures(d: CarDesign, ev: CarEvaluation, u: UnitSystem): void {
    const sel = this.store.view.selection;
    const lu = lengthUnit(u);
    const rho = ev.bodyDensity.value;
    const steps = new Map(ev.build.steps.map((s) => [s.id, s]));
    const dimInput = (id: string, key: string, value: number, label: string): string =>
      `<label>${label}<input type="number" step="${lengthStep(u)}" min="0" data-fdim="${esc(id)}" data-key="${key}" value="${showLength(value, u)}"></label>`;
    const item = (f: Feature): string => {
      const step = steps.get(f.id);
      const selected = sel?.kind === "feature" && sel.id === f.id;
      let title: string;
      let body: string;
      if (f.kind === "bore") {
        title = "Bore";
        body = `<div class="wpos"><span class="rowlabel">size</span>${dimInput(f.id, "diameter", f.diameter, "⌀")}${dimInput(f.id, "depth", f.depth, "length")}
          <label>axis<select data-faxis="${esc(f.id)}">${(["x", "y", "z"] as const).map((a) => `<option ${a === f.axis ? "selected" : ""}>${a}</option>`).join("")}</select></label><span>${lu}</span></div>
          ${this.posInputs(f.id, f.center, u, "data-fpos")}`;
      } else if (f.kind === "pocket") {
        title = "Pocket";
        body = `<div class="wpos"><span class="rowlabel">size</span>${(["x", "y", "z"] as const).map((a, k) => dimInput(f.id, `size${k}`, f.size[k]!, a)).join("")}<span>${lu}</span></div>
          ${this.posInputs(f.id, f.center, u, "data-fpos")}`;
      } else {
        title = f.planes.length === 2 ? "Wedge cut" : "Saw cut";
        body = `${this.posInputs(f.id, f.planes[0].point, u, "data-cpt")}
          ${f.planes
            .map((p, k) => {
              const [az, el] = toAngles(p.normal);
              return `<div class="wpos"><span class="rowlabel">plane ${k + 1}</span>
                <label>az<input type="number" step="1" data-caz="${esc(f.id)}" data-plane="${k}" value="${az.toFixed(1)}"></label>
                <label>el<input type="number" step="1" data-cel="${esc(f.id)}" data-plane="${k}" value="${el.toFixed(1)}"></label><span>°</span></div>`;
            })
            .join("")}`;
      }
      const removed = step ? step.removed : 0;
      return `<li class="weight feature-item${selected ? " selected" : ""}" data-fselect="${esc(f.id)}">
        <div class="wtitle"><b>${title}</b> ${this.tierTag(step)}
          <span class="wmass" title="Wood this operation removes on its own">−${formatMass(removed * rho, u)}</span>
          <button class="icon-btn" data-fdelete="${esc(f.id)}" title="Remove" aria-label="Remove">✕</button></div>
        ${step ? `<div class="cls">${esc(step.how)}</div>` : ""}
        ${body}
      </li>`;
    };
    const plan = ev.build;
    const kind = this.formValues.get("af-kind") ?? "bore";
    const faces = (Object.keys(HOLE_FACES) as HoleFace[]).map((k) => `<option value="${k}" ${this.sel("af-face", k, "top")}>${HOLE_FACES[k].label}</option>`).join("");
    const presets = (Object.keys(CUT_PRESETS) as CutPreset[])
      .filter((k) => (kind === "wedge" ? k === "notch" : k !== "notch"))
      .map((k) => `<option value="${k}" ${this.sel("af-preset", k, kind === "wedge" ? "notch" : "nose")}>${CUT_PRESETS[k]}</option>`)
      .join("");
    const xm = (blockBox(kitValuesOf(d)).max[0] + blockBox(kitValuesOf(d)).min[0]) / 2;
    this.q("p-features-list").innerHTML = `
      <h2>Holes and cuts</h2>
      <div class="build-tier">Build tier <b class="tier" data-tier="${plan.tier}">${plan.tier}</b> <span class="cls">${plan.provenance}</span>
        <div class="hint">${esc(tierTools(plan.tier))}.${plan.blocked.length > 0 ? ` <b class="bad">${plan.blocked.length} operation${plan.blocked.length > 1 ? "s" : ""} cannot be made as drawn.</b>` : ""}</div></div>
      <details class="build-steps" data-form="steps" ${this.openForms.has("steps") ? "open" : ""}><summary>Build sequence (${plan.steps.length} steps)</summary>
        <ol class="steps">${plan.steps
          .map((s) => `<li><b>${esc(s.label)}</b> ${this.tierTag(s)}<div class="cls">${esc(s.how)}${s.removed > 0 ? ` Removes ${formatMass(s.removed * rho, u)} of wood.` : ""}</div></li>`)
          .join("")}</ol>
        <p class="hint">Tiers classify the kind of operation only; tool lists and precision per tier are TBD (12.6).
          A drill meeting the surface within ${(SQUARE_ENTRY.value / DEG).toFixed(0)}° of square counts as square (${SQUARE_ENTRY.provenance}).</p></details>
      <ul class="weights">${d.features.map(item).join("") || '<li class="empty">No holes or cuts yet.</li>'}</ul>`;
    this.form("p-features-form", `${u}|${kind}`, () => `
      <details class="add-weight" data-form="af"><summary>Add hole or cut</summary>
        <div class="form" data-kind="${esc(kind)}">
          <label>Type <select id="af-kind">${(
            [
              ["bore", "Bore (drilled hole)"],
              ["pocket", "Pocket"],
              ["cut", "Saw cut"],
              ["wedge", "Wedge cut (V-notch)"],
            ] as const
          )
            .map(([v, l]) => `<option value="${v}" ${kind === v ? "selected" : ""}>${l}</option>`)
            .join("")}</select></label>
          <label data-for="bore pocket">From <select id="af-face">${faces}</select></label>
          <label data-for="cut wedge">Cut <select id="af-preset">${presets}</select></label>
          <label data-for="bore pocket">${kind === "bore" ? "Diameter" : "Width"} ${lu} <input id="af-a" type="number" step="any" value="${this.fv("af-a", showLength(inches(0.25), u))}"></label>
          <label data-for="pocket">Length ${lu} <input id="af-b" type="number" step="any" value="${this.fv("af-b", showLength(inches(0.5), u))}"></label>
          <label data-for="bore pocket cut wedge">${kind === "bore" || kind === "pocket" ? "Depth" : kind === "wedge" ? "Notch depth" : "Size"} ${lu}
            <input id="af-depth" type="number" step="any" value="${this.fv("af-depth", showLength(inches(0.25), u))}"></label>
          <label data-for="bore pocket cut wedge">At x ${lu} <input id="af-x" type="number" step="any" value="${this.fv("af-x", showLength(xm, u))}"></label>
          <button id="af-add">Add</button>
          <p class="hint">Depth is measured from where the tool first meets the wood. x runs forward from the rear axle; nose and tail holes, and the corner and end chamfers, ignore it.</p>
        </div></details>`);
  }

  /** Rebuild a form host only when its key changes, keeping its open state. */
  private form(host: string, key: string, html: () => string): void {
    if (this.formKeys.get(host) === key) return;
    const el = this.q(host);
    const wasOpen = el.querySelector("details")?.open ?? false;
    const units = key.split("|")[0]!;
    const prevUnits = this.formKeys.get(host)?.split("|")[0];
    // Lengths typed in the other unit system would be misread: fall back to the defaults.
    if (prevUnits !== undefined && prevUnits !== units)
      for (const k of [...this.formValues.keys()]) if (/^(aw|af)-(a|b|c|mass|depth|x)$/.test(k)) this.formValues.delete(k);
    this.formKeys.set(host, key);
    el.innerHTML = html();
    if (wasOpen) el.querySelector("details")!.open = true;
  }

  private renderInspection(ins: Inspection, u: UnitSystem): void {
    const row = (l: InspectionLine): string => {
      const limit = l.limit ? formatLimit(l.limit.si, l.limit.source, l.limit.kind, u) : "";
      const value =
        l.limit && l.value !== undefined ? formatAgainstLimit(l.value, l.limit.si, l.limit.kind, l.limit.quantity, u) : "";
      const state = l.state + (l.provisional && l.state === "PASS" ? " (provisional)" : "");
      return `<tr class="${l.state === "FAIL" ? "fail" : l.provisional ? "prov-row" : ""}">
        <td><span aria-hidden="true">${STATE_ICON[l.state] ?? ""}</span> ${state}</td>
        <td>${esc(l.label)}<div class="cls">${l.cls}</div></td><td>${value}</td><td>${limit}</td></tr>
        <tr class="note"><td></td><td colspan="3">${esc(l.note)}</td></tr>`;
    };
    this.q("p-inspection").innerHTML = `
      <h2>Inspection</h2>
      <div class="compliance" data-state="${ins.state}"><b>${ins.state}</b></div>
      <p class="prov">${esc(ins.ruleset.name)}. ${esc(ins.ruleset.sourceLine)}.</p>
      <table class="inspect"><thead><tr><th>State</th><th>Check</th><th>Car</th><th>Limit</th></tr></thead>
      <tbody>${ins.lines.map(row).join("")}</tbody></table>`;
  }

  raceStarted(): number {
    this.q("p-race").classList.add("running");
    return ++this.seq;
  }

  renderRace(r: RaceReply): void {
    if (r.seq !== this.seq) return; // a newer design is already racing
    const u = this.store.view.units;
    const el = this.q("p-race");
    el.classList.remove("running");
    const L = r.ledger;
    const pct = (x: number): string => `${((100 * x) / L.released).toFixed(1)} %`;
    const speed = r.finishSpeed === null ? "–" : u === "metric" ? `${r.finishSpeed.toFixed(3)} m/s` : `${(r.finishSpeed / 0.3048).toFixed(2)} ft/s`;
    el.innerHTML = `
      <h2>Race preview</h2>
      <div class="big">${r.time === null ? r.status : `${r.time.toFixed(4)} s`}</div>
      <p class="prov">${esc(r.track)}: profile <b>${r.profileStatus}</b>. Kit, friction and drag values are <b>ESTIMATED</b>,
        so compare designs with each other rather than with real race times.</p>
      ${r.time === null || r.status !== "FINISHED" ? `<p class="notice">${esc(r.message)}</p>` : ""}
      <table class="kv">
        <tr><th>Finish speed</th><td>${speed}</td></tr>
        <tr><th>Kinetic energy at finish</th><td>${pct(L.kinetic)}</td></tr>
        <tr><th>Axle friction</th><td>${pct(L.axle)}</td></tr>
        <tr><th>Rolling resistance</th><td>${pct(L.rolling)}</td></tr>
        <tr><th>Air drag</th><td>${pct(L.aero)}</td></tr>
        <tr><th>Ledger residual</th><td>${L.residual.toExponential(1)} J</td></tr>
      </table>`;
  }

  // --- input handling -------------------------------------------------------------------------

  private mapFeature(id: string, f: (x: Feature) => Feature): void {
    const d = this.store.design;
    this.store.update({ ...d, features: d.features.map((x) => (x.id === id ? f(x) : x)) });
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const d = this.store.design;
    const u = this.store.view.units;
    if (/^(aw|af)-/.test(t.id)) {
      this.formValues.set(t.id, t.value);
      if (t.id === "af-kind" && this.lastEv) {
        this.formValues.delete("af-preset");
        this.renderFeatures(d, this.lastEv, u);
      }
      return;
    }
    if (t.id === "kit-block" || t.id === "kit-wheels") {
      const k = kitOf(d);
      const b = t.id === "kit-block" ? blockKit(t.value) : k.block;
      if (!b) return;
      // A new block comes with its own wheels unless the car runs on a set from outside the kit.
      const keep = t.id === "kit-wheels" ? wheelChoices(b).find((x) => x.id === t.value) : kitWheels(k) ? undefined : wheelChoices(b).find((x) => x.id === k.wheels.id);
      // The player's own record of the kit (measured, turned) where they have one.
      this.store.update(withKit(d, this.store.kitFor(b, keep ?? b.wheels)));
      return;
    }
    if (t.id === "rules-pick") {
      const chosen = this.rulesChoices(d).find((r) => r.id === t.value);
      if (chosen) this.store.update({ ...d, rules: chosen });
      return;
    }
    if (t.id === "axle-prep") this.store.update({ ...d, axlePrep: t.value as CarDesign["axlePrep"] });
    else if (t.id === "paint") this.store.update({ ...d, paint: t.value });
    else if (t.id === "block-mass") {
      const x = Number(t.value);
      const { measuredBlockMass: _m, ...rest } = d;
      this.store.update(t.value === "" || !(x > 0) ? rest : { ...d, measuredBlockMass: u === "metric" ? x / 1000 : x * 0.028349523125 });
    } else if (t.dataset.pos) {
      const id = t.dataset.pos;
      const k = Number(t.dataset.axis);
      const m = parseCoord(t.value, u);
      if (m === null) return;
      this.store.update({
        ...d,
        ballast: d.ballast.map((b) => (b.id === id ? { ...b, center: setK(b.center, k, m) } : b)),
      });
    } else if (t.dataset.fpos) {
      const k = Number(t.dataset.axis);
      const m = parseCoord(t.value, u);
      if (m === null) return;
      this.mapFeature(t.dataset.fpos, (f) => (f.kind === "cut" ? f : { ...f, center: setK(f.center, k, m) }));
    } else if (t.dataset.cpt) {
      const k = Number(t.dataset.axis);
      const m = parseCoord(t.value, u);
      if (m === null) return;
      this.mapFeature(t.dataset.cpt, (f) =>
        f.kind === "cut" ? { ...f, planes: f.planes.map((p) => ({ ...p, point: setK(p.point, k, m) })) as unknown as Cut["planes"] } : f,
      );
    } else if (t.dataset.caz || t.dataset.cel) {
      const id = (t.dataset.caz ?? t.dataset.cel)!;
      const k = Number(t.dataset.plane);
      const x = Number(t.value);
      if (!Number.isFinite(x)) return;
      this.mapFeature(id, (f) => {
        if (f.kind !== "cut") return f;
        const planes = f.planes.map((p, i): Plane => {
          if (i !== k) return p;
          const [az, el] = toAngles(p.normal);
          return { ...p, normal: t.dataset.caz ? fromAngles(x, el) : fromAngles(az, x) };
        });
        return { ...f, planes: planes as unknown as Cut["planes"] };
      });
    } else if (t.dataset.fdim) {
      const m = parseLength(t.value, u);
      if (m === null) return;
      const key = t.dataset.key!;
      this.mapFeature(t.dataset.fdim, (f) => {
        if (f.kind === "bore" && (key === "diameter" || key === "depth")) return { ...f, [key]: m };
        if (f.kind === "pocket" && key.startsWith("size")) return { ...f, size: setK(f.size, Number(key.slice(4)), m) };
        return f;
      });
    } else if (t.dataset.faxis) {
      this.mapFeature(t.dataset.faxis, (f) => (f.kind === "bore" ? { ...f, axis: t.value as Axis } : f));
    }
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const d = this.store.design;
    if (t.id === "rl-save") {
      this.saveRules();
      return;
    }
    if (t.id === "km-save") {
      this.saveKitMeasurements();
      return;
    }
    if (t.id === "ks-save") {
      this.saveSlots();
      return;
    }
    if (t.id === "ks-turn") {
      this.useKit(d, turnedKit(kitOf(d)));
      return;
    }
    if (t.id === "km-reset") {
      this.kitError = this.slotError = "";
      this.useKit(d, catalogueKit(kitOf(d)));
      return;
    }
    if (t.id === "rules-delete") {
      const gone = rulesOf(d).id;
      // The design keeps its snapshot as the shipped rules; the local set leaves the library.
      this.store.update({ ...d, rules: CCCS_KIT_CAR_2026 });
      this.store.deleteRuleset(gone);
      return;
    }
    const del = t.closest<HTMLElement>("[data-delete]");
    if (del) {
      this.store.update({ ...d, ballast: d.ballast.filter((b) => b.id !== del.dataset.delete) });
      return;
    }
    const fdel = t.closest<HTMLElement>("[data-fdelete]");
    if (fdel) {
      this.store.update({ ...d, features: d.features.filter((f) => f.id !== fdel.dataset.fdelete) });
      if (this.store.view.selection?.id === fdel.dataset.fdelete) this.store.setView({ selection: null });
      return;
    }
    const seat = t.closest<HTMLElement>("[data-seat]");
    if (seat) {
      this.store.update({ ...d, ballast: d.ballast.map((b) => (b.id === seat.dataset.seat ? this.tools.seat(b) : b)) });
      return;
    }
    const access = t.closest<HTMLElement>("[data-access]");
    if (access) {
      const b = d.ballast.find((x) => x.id === access.dataset.access);
      const f = b ? this.tools.access(b, newId("f")) : null;
      if (f) {
        this.store.update({ ...d, features: [...d.features, f] });
        this.store.setView({ selection: { kind: "feature", id: f.id } });
      }
      return;
    }
    if (t.id === "aw-add") {
      this.addWeight();
      return;
    }
    if (t.id === "af-add") {
      this.addFeature();
      return;
    }
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t.closest("summary")) return;
    const pick = t.closest<HTMLElement>("[data-select]");
    if (pick) this.store.setView({ selection: { kind: "ballast", id: pick.dataset.select! } });
    const fpick = t.closest<HTMLElement>("[data-fselect]");
    if (fpick) this.store.setView({ selection: { kind: "feature", id: fpick.dataset.fselect! } });
  }

  private addFeature(): void {
    const u = this.store.view.units;
    const val = (id: string): string => (this.root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement).value;
    const kind = val("af-kind");
    const depth = parseLength(val("af-depth"), u);
    const x = parseCoord(val("af-x"), u);
    if (depth === null || x === null) return;
    const id = newId("f");
    let f: Feature;
    if (kind === "bore" || kind === "pocket") {
      const a = parseLength(val("af-a"), u);
      const b = kind === "pocket" ? parseLength(val("af-b"), u) : a;
      if (a === null || b === null) return;
      // A pocket's length runs along the car where it can, otherwise across it.
      const face = val("af-face") as HoleFace;
      const [w1, w2] = kind === "pocket" && HOLE_FACES[face].axis !== "x" ? [b, a] : [a, b];
      f = this.tools.hole(kind, id, face, x, w1, w2, depth);
    } else f = this.tools.cut(val("af-preset") as CutPreset, id, depth, x);
    const d = this.store.design;
    this.store.update({ ...d, features: [...d.features, f] });
    this.store.setView({ selection: { kind: "feature", id } });
  }

  private addWeight(): void {
    const u = this.store.view.units;
    const val = (id: string): string => (this.root.querySelector(`#${id}`) as HTMLInputElement).value;
    const material = val("aw-material") as MaterialId;
    const kind = val("aw-shape") as BallastShape["kind"];
    const mounting = val("aw-mount") as Ballast["mounting"];
    const axis = val("aw-axis") as Axis;
    const a = parseLength(val("aw-a"), u);
    const b = parseLength(val("aw-b"), u);
    const c = parseLength(val("aw-c"), u);
    const target = Number(val("aw-mass"));
    const targetKg = target > 0 ? (u === "metric" ? target / 1000 : target * 0.028349523125) : null;
    const rho = MATERIALS[material].density.value;
    let shape: BallastShape;
    if (kind === "cylinder") {
      if (a === null) return;
      const length = targetKg !== null ? targetKg / (rho * Math.PI * (a / 2) ** 2) : b;
      if (length === null) return;
      shape = { kind: "cylinder", diameter: a, length, axis };
    } else {
      if (a === null || b === null) return;
      const height = targetKg !== null ? targetKg / (rho * a * b) : c;
      if (height === null) return;
      shape = { kind: "block", size: [a, b, height] };
    }
    const d = this.store.design;
    const bb = blockBox(kitValuesOf(d));
    const n = d.ballast.length;
    const id = newId("w");
    // Surface mountings start against the block's face; cavity weights low in the body.
    const h = shapeHalfSize(shape);
    const z = mounting === "top" ? bb.max[2] + h[2] : mounting === "underside" ? bb.min[2] - h[2] : bb.min[2] + Math.max(inches(0.45), h[2] + inches(0.1));
    const x = inches(0.6) + n * inches(0.5);
    const y = mounting === "side" ? bb.max[1] + h[1] : 0;
    this.store.update({ ...d, ballast: [...d.ballast, this.tools.seat({ id, material, shape, center: [x, y, z], mounting })] });
    this.store.setView({ selection: { kind: "ballast", id } });
  }
}

const setK = (c: V3, k: number, m: number): V3 => {
  const out = [...c] as [number, number, number];
  out[k] = m;
  return out as V3;
};

let counter = 0;
const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
