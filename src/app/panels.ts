// Sidebar panels: Design Constraints (12.5), mass and CG (7.6), weights (12.4, SAF-003), inspection
// (9.7, 9.8) and the race preview. States are always written out in words, never colour alone (ACC-001).

import { type UnitSystem, formatAgainstLimit, formatLength, formatLimit, formatMass } from "../core/display.js";
import { inches, toInches, toMm } from "../core/units.js";
import type { Axis, Ballast, BallastShape, CarDesign, MaterialId, V3 } from "../geometry/design.js";
import { blockBox } from "../geometry/design.js";
import { AXLE_PREPS, type CarEvaluation, shapeHalfSize, shapeVolume } from "../mass/carModel.js";
import { LEAD_NOTICE, MATERIALS, nonLeadAlternative } from "../mass/materials.js";
import type { MountState } from "../geometry/solid.js";
import type { Inspection, InspectionLine } from "../rules/cccs.js";
import type { RaceReply } from "./race.worker.js";
import type { Store } from "./store.js";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A length typed in the display units, back to metres. */
const parseLength = (text: string, u: UnitSystem): number | null => {
  const x = Number(text);
  return Number.isFinite(x) && x > 0 ? (u === "metric" ? x / 1000 : inches(x)) : null;
};
const showLength = (m: number, u: UnitSystem): string => (u === "metric" ? toMm(m).toFixed(2) : toInches(m).toFixed(3));
const lengthUnit = (u: UnitSystem): string => (u === "metric" ? "mm" : "in");

const STATE_ICON: Record<string, string> = { PASS: "✓", FAIL: "✗", LOCKED: "🔒", "NOT EVALUATED": "–" };

export class Panels {
  private seq = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
    /** Rest a surface weight on the body (needs the solid, so main supplies it). */
    private readonly seat: (b: Ballast) => Ballast,
  ) {
    root.innerHTML = `
      <section id="p-constraints" aria-label="Design constraints"></section>
      <section id="p-mass" aria-label="Mass and centre of gravity"></section>
      <section id="p-weights" aria-label="Weights"></section>
      <section id="p-inspection" aria-label="Inspection"></section>
      <section id="p-race" aria-label="Race preview"></section>`;
    root.addEventListener("change", (e) => this.onChange(e));
    root.addEventListener("click", (e) => this.onClick(e));
  }

  private q(id: string): HTMLElement {
    return this.root.querySelector(`#${id}`)!;
  }

  render(d: CarDesign, ev: CarEvaluation, ins: Inspection): void {
    const u = this.store.view.units;
    this.renderConstraints(ins);
    this.renderMass(d, ev, u);
    this.renderWeights(d, ev.mounting, u);
    this.renderInspection(ins, u);
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
    const wb = blockBox();
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

  private renderWeights(d: CarDesign, mounting: Readonly<Record<string, MountState>>, u: UnitSystem): void {
    const sel = this.store.view.selection;
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
      return `<li class="weight${selected ? " selected" : ""}" data-select="${esc(b.id)}">
        <div class="wtitle"><b>${esc(mat.name)}</b> ${b.material === "lead" ? '<span class="tag">ADULT INSTALLS</span>' : ""}
          <span class="wmass">${formatMass(mass, u)}</span>
          <button class="icon-btn" data-delete="${esc(b.id)}" title="Remove weight" aria-label="Remove weight">✕</button></div>
        <div class="wdims">${dims}; ${b.mounting === "cavity" ? "in a drilled cavity" : `mounted on the ${b.mounting}`}
          ${b.mounting !== "cavity" && mounting[b.id] !== "touching" ? `<span class="bad">${mounting[b.id] === "floating" ? "✗ not touching the body" : "✗ cuts into the body"}</span>` : ""}
          ${b.mounting !== "cavity" ? `<button class="icon-btn" data-seat="${esc(b.id)}" title="Rest it on the body surface">Seat</button>` : ""}</div>
        <div class="wpos">
          ${(["x", "y", "z"] as const)
            .map((a, k) => `<label>${a}<input type="number" step="${u === "metric" ? 0.25 : 0.01}" data-pos="${esc(b.id)}" data-axis="${k}" value="${showLength(b.center[k]!, u)}"></label>`)
            .join("")}<span>${lu}</span></div>
        <div class="prov">Density ${(mat.density.value / 1000).toFixed(2)} g/cm³, ${mat.density.provenance}${lead ? `. Non-lead alternative: tungsten, ${formatMass(mass, u)} in ${(lead.volume * 1e6).toFixed(2)} cm³` : ""}</div>
      </li>`;
    };
    const metal = (Object.keys(MATERIALS) as MaterialId[]).map((id) => `<option value="${id}">${MATERIALS[id].name}</option>`).join("");
    this.q("p-weights").innerHTML = `
      <h2>Weights</h2>
      ${anyLead ? `<p class="notice" role="note">⚠ ${LEAD_NOTICE}</p>` : ""}
      <ul class="weights">${d.ballast.map(item).join("") || '<li class="empty">No weights yet.</li>'}</ul>
      <details class="add-weight"><summary>Add weight</summary>
        <div class="form">
          <label>Material <select id="aw-material">${metal}</select></label>
          <label>Shape <select id="aw-shape"><option value="cylinder">Cylinder</option><option value="block">Block</option></select></label>
          <label>Mounting <select id="aw-mount"><option value="cavity">Drilled cavity</option><option value="top">Top</option><option value="underside">Underside</option><option value="side">Side</option></select></label>
          <label>Axis (cylinder) <select id="aw-axis"><option value="y">Across (Y)</option><option value="x">Along (X)</option><option value="z">Vertical (Z)</option></select></label>
          <label>Diameter / length ${lu} <input id="aw-a" type="number" step="any" value="${showLength(inches(0.375), u)}"></label>
          <label>Length / width ${lu} <input id="aw-b" type="number" step="any" value="${showLength(inches(1.0), u)}"></label>
          <label>Height ${lu} (block) <input id="aw-c" type="number" step="any" value="${showLength(inches(0.25), u)}"></label>
          <label>or target mass ${u === "metric" ? "g" : "oz"} <input id="aw-mass" type="number" step="any" placeholder="sets the last dimension"></label>
          <button id="aw-add">Add</button>
          <p class="hint">With a target mass, a cylinder's length or a block's height is calculated from the material's density.</p>
        </div></details>
      <p class="hint">Drag weights in the 3D view or in either profile.</p>`;
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

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const d = this.store.design;
    const u = this.store.view.units;
    if (t.id === "axle-prep") this.store.update({ ...d, axlePrep: t.value as CarDesign["axlePrep"] });
    else if (t.id === "paint") this.store.update({ ...d, paint: t.value });
    else if (t.id === "block-mass") {
      const x = Number(t.value);
      const { measuredBlockMass: _m, ...rest } = d;
      this.store.update(t.value === "" || !(x > 0) ? rest : { ...d, measuredBlockMass: u === "metric" ? x / 1000 : x * 0.028349523125 });
    } else if (t.dataset.pos) {
      const id = t.dataset.pos;
      const k = Number(t.dataset.axis);
      const x = Number(t.value);
      if (!Number.isFinite(x)) return;
      const m = u === "metric" ? x / 1000 : inches(x);
      this.store.update({
        ...d,
        ballast: d.ballast.map((b) => {
          if (b.id !== id) return b;
          const c = [...b.center] as [number, number, number];
          c[k] = m;
          return { ...b, center: c as V3 };
        }),
      });
    }
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const d = this.store.design;
    const del = t.closest<HTMLElement>("[data-delete]");
    if (del) {
      this.store.update({ ...d, ballast: d.ballast.filter((b) => b.id !== del.dataset.delete) });
      return;
    }
    const seat = t.closest<HTMLElement>("[data-seat]");
    if (seat) {
      this.store.update({ ...d, ballast: d.ballast.map((b) => (b.id === seat.dataset.seat ? this.seat(b) : b)) });
      return;
    }
    if (t.id === "aw-add") {
      this.addWeight();
      return;
    }
    const pick = t.closest<HTMLElement>("[data-select]");
    if (pick && !(t instanceof HTMLInputElement)) this.store.setView({ selection: { kind: "ballast", id: pick.dataset.select! } });
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
    const bb = blockBox();
    const n = d.ballast.length;
    const id = `w${Date.now().toString(36)}`;
    // Surface mountings start against the block's face; cavity weights low in the body.
    const h = shapeHalfSize(shape);
    const z = mounting === "top" ? bb.max[2] + h[2] : mounting === "underside" ? bb.min[2] - h[2] : bb.min[2] + Math.max(inches(0.45), h[2] + inches(0.1));
    const x = inches(0.6) + n * inches(0.5);
    const y = mounting === "side" ? bb.max[1] + h[1] : 0;
    this.store.update({ ...d, ballast: [...d.ballast, this.seat({ id, material, shape, center: [x, y, z], mounting })] });
    this.store.setView({ selection: { kind: "ballast", id } });
  }
}
