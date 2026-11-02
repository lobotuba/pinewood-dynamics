// KID level workspace panel (spec 16, 12.7 A, MODE-001): Shape It, Add Weight, Why?, Race and Build It,
// with large labels, plain words and numbers hidden unless asked for. It edits the same design through
// the same store, so CERTIFIED context still refuses anything that breaks a rule, and the same car
// evaluates identically at every level.

import { type UnitSystem, formatMass } from "../core/display.js";
import type { CarDesign, Cut, P2 } from "../geometry/design.js";
import { blockBox, contextOf, kitValuesOf } from "../geometry/design.js";
import { outline } from "../geometry/profile.js";
import { type KidShapeId, KID_SHAPES, kidShapeProfiles, sawLine } from "../kid/shapes.js";
import { type KidWeight, KID_WEIGHTS, isKidWeight, kidBoreId, kidWeightOf, rodMass } from "../kid/weights.js";
import type { WhatIf } from "../kid/whatIf.js";
import { balanceWords, carLengths, kidProblem, lengthsWords } from "../kid/words.js";
import type { CarEvaluation } from "../mass/carModel.js";
import { LEAD_NOTICE, MATERIALS, nonLeadAlternative } from "../mass/materials.js";
import type { CarSpec } from "../physics/car.js";
import { type Inspection, limitOf, rulesOf } from "../rules/cccs.js";
import type { RaceReply } from "./race.worker.js";
import type { Store } from "./store.js";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MM = 1000;

type Step = "shape" | "weight" | "why" | "race" | "build";
const STEPS: readonly [Step, string][] = [
  ["shape", "Shape It"],
  ["weight", "Add Weight"],
  ["why", "Why?"],
  ["race", "Race"],
  ["build", "Build It"],
];

/** What the kid panel needs from the solid and the app; main supplies them. */
export interface KidTools {
  reshape(d: CarDesign, id: KidShapeId): { design: CarDesign; dropped: string[] };
  addWeight(d: CarDesign, kind: KidWeight, id: string): CarDesign | null;
  moveWeight(d: CarDesign, id: string, x: number): CarDesign | null;
  whatIfs(d: CarDesign, ev: CarEvaluation): WhatIf[];
  /** Race a spec in the preview worker; the reply comes back to `onWhy` with this seq. */
  post(spec: CarSpec, seq: number): void;
  race(): void;
}

/** Sequence numbers of what-if races start here, apart from the workspace preview's. */
export const WHY_SEQ = 1_000_000;

interface WhyRun {
  readonly design: CarDesign;
  readonly base: number;
  readonly items: readonly WhatIf[];
  readonly replies: Map<number, RaceReply>;
}

/** The part of the block's side a cut takes off, as a polygon (x, z). */
function cutRegion(c: Cut, box: { min: readonly number[]; max: readonly number[] }): P2[] {
  let poly: P2[] = [
    [box.min[0]!, box.min[2]!],
    [box.max[0]!, box.min[2]!],
    [box.max[0]!, box.max[2]!],
    [box.min[0]!, box.max[2]!],
  ];
  for (const pl of c.planes) {
    const side = (p: P2): number => pl.normal[0] * (p[0] - pl.point[0]) + pl.normal[2] * (p[1] - pl.point[2]);
    const out: P2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const sa = side(a);
      const sb = side(b);
      if (sa >= 0) out.push(a);
      if (sa * sb < 0) {
        const t = sa / (sa - sb);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    poly = out;
  }
  return poly;
}

let counter = 0;
const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export class KidPanel {
  private step: Step = "shape";
  private message = "";
  private lastEv: CarEvaluation | null = null;
  private lastIns: Inspection | null = null;
  private raceTime: number | null = null;
  private why: WhyRun | null = null;
  private seq = WHY_SEQ;
  private whyTimer = 0;
  /** Saw-line drag on the side view, (x, z) in metres. */
  private saw: { a: P2; b: P2 } | null = null;
  /** A weight slider is being dragged: redrawing the panel would take it from under the pointer. */
  private sliding = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
    private readonly tools: KidTools,
  ) {
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("change", (e) => this.onChange(e));
    root.addEventListener("input", (e) => this.onInput(e));
    root.addEventListener("pointerdown", (e) => this.onSawStart(e));
  }

  private get numbers(): boolean {
    return this.store.view.kidNumbers;
  }

  render(d: CarDesign, ev: CarEvaluation, ins: Inspection): void {
    this.lastEv = ev;
    this.lastIns = ins;
    if (this.saw || this.sliding) return; // mid-drag: redrawn on release
    const u = this.store.view.units;
    this.root.innerHTML = `
      ${this.header(d, ev, ins, u)}
      <nav class="kid-steps" role="tablist" aria-label="Steps">${STEPS.map(
        ([id, label]) => `<button role="tab" data-step="${id}" aria-selected="${id === this.step}">${label}</button>`,
      ).join("")}</nav>
      ${this.message ? `<p class="kid-message" role="status">${esc(this.message)}</p>` : ""}
      <section class="kid-body">${this.body(d, ev, ins, u)}</section>
      <label class="kid-numbers"><input type="checkbox" id="kid-numbers" ${this.numbers ? "checked" : ""}> Show numbers</label>`;
    if (this.step === "why") this.scheduleWhy(d, ev);
  }

  /** The workspace preview's time for the current car. */
  renderRace(r: RaceReply): void {
    this.raceTime = r.status === "FINISHED" ? r.time : null;
    const el = this.root.querySelector("#kid-time");
    if (el) el.innerHTML = this.timeHtml();
  }

  private timeHtml(): string {
    return this.raceTime === null ? "racing…" : `${this.raceTime.toFixed(3)} s`;
  }

  private header(d: CarDesign, ev: CarEvaluation, ins: Inspection, u: UnitSystem): string {
    const fails = ins.lines.filter((l) => l.state === "FAIL");
    const practice = contextOf(d) === "SANDBOX";
    const status = fails.length
      ? `<span class="kid-chip bad">✗ Needs fixing: see Why?</span>`
      : practice
        ? `<span class="kid-chip warn">Practice car</span>`
        : `<span class="kid-chip ok">✓ Follows the race rules</span>`;
    const limit = limitOf(rulesOf(d), "RUL-006")?.si ?? null;
    const m = ev.total.mass;
    const f = limit ? Math.min(1, m / limit) : 0;
    const words = !limit ? "" : m > limit ? "too heavy" : m > limit - 0.002 ? "right at the limit" : m > 0.85 * limit ? "almost full" : "room for more weight";
    return `
      <div class="kid-head">
        <div class="kid-name">${esc(d.name)} ${status}</div>
        ${
          limit
            ? `<div class="kid-meter" role="meter" aria-label="Weight" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${m}" aria-valuetext="${words}">
                 <span class="kid-meter-label">Weight: <b>${words}</b>${this.numbers ? ` (${formatMass(m, u)} of ${formatMass(limit, u)})` : ""}</span>
                 <span class="kid-bar"><span style="width:${(100 * f).toFixed(1)}%" class="${m > limit ? "over" : ""}"></span></span></div>`
            : ""
        }
        <div class="kid-time">Race time: <b id="kid-time">${this.timeHtml()}</b></div>
      </div>`;
  }

  private body(d: CarDesign, ev: CarEvaluation, ins: Inspection, u: UnitSystem): string {
    switch (this.step) {
      case "shape":
        return this.shapeHtml(d);
      case "weight":
        return this.weightHtml(d, ev, u);
      case "why":
        return this.whyHtml(d, ev, ins);
      case "race":
        return `<h2>Race</h2>
          <p>Send your car down the track against your other cars.</p>
          <button class="kid-big primary" id="kid-race">Race it!</button>
          <p class="hint">Tip: press <b>Save version</b> at the top before you change your car, so you can race the old one against the new one.</p>`;
      case "build":
        return this.buildHtml(d, ev);
    }
  }

  // --- Shape It -------------------------------------------------------------------------------

  private shapeHtml(d: CarDesign): string {
    const kit = kitValuesOf(d);
    const thumb = (id: KidShapeId): string => {
      const p = kidShapeProfiles(id, kit);
      const b = blockBox(kit);
      const side = outline(p.side).map((q) => `${(q[0] * MM).toFixed(2)},${(-q[1] * MM).toFixed(2)}`).join(" ");
      const top = outline(p.top).map((q) => `${(q[0] * MM).toFixed(2)},${(-q[1] * MM + (b.max[2] - b.min[1]) * MM + 10).toFixed(2)}`).join(" ");
      const vb = [b.min[0] * MM - 2, -b.max[2] * MM - 2, (b.max[0] - b.min[0]) * MM + 4, (b.max[2] - b.min[2] + b.max[1] - b.min[1]) * MM + 14].map((x) => x.toFixed(1)).join(" ");
      return `<svg viewBox="${vb}" class="kid-thumb" aria-hidden="true"><polygon points="${side}"/><polygon points="${top}" class="top"/></svg>`;
    };
    return `<h2>Pick a shape</h2>
      <div class="kid-shapes">${KID_SHAPES.map(
        (s) => `<button class="kid-shape" data-shape="${s.id}">${thumb(s.id)}<b>${esc(s.name)}</b><span>${esc(s.blurb)}</span></button>`,
      ).join("")}</div>
      <h2>Draw a saw line</h2>
      <p class="hint">Drag across the side of your car to show where to saw. The piece away from the middle of the car comes off.
        Changed your mind? Press Undo at the top.</p>
      ${this.sideView(d)}
      <label class="kid-paint">Paint colour <input type="color" id="kid-paint" value="${esc(d.paint)}"></label>`;
  }

  private sideView(d: CarDesign): string {
    const kit = kitValuesOf(d);
    const b = blockBox(kit);
    const pad = 6;
    const r = kit.wheelRadius.value;
    const x0 = b.min[0] * MM - pad;
    const y0 = -(b.max[2] * MM) - pad;
    const w = (b.max[0] - b.min[0]) * MM + 2 * pad;
    const h = (b.max[2] + r) * MM + 2 * pad;
    const pts = (ps: readonly P2[]) => ps.map((q) => `${(q[0] * MM).toFixed(2)},${(-q[1] * MM).toFixed(2)}`).join(" ");
    const xa = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
    const cuts = d.features.filter((f): f is Cut => f.kind === "cut" && f.planes.every((p) => Math.abs(p.normal[1]) < 1e-9));
    const line = this.saw
      ? `<line class="kid-saw" x1="${this.saw.a[0] * MM}" y1="${-this.saw.a[1] * MM}" x2="${this.saw.b[0] * MM}" y2="${-this.saw.b[1] * MM}"/>`
      : "";
    return `<svg id="kid-side" class="kid-side" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Side of your car: drag to draw a saw line">
      <rect x="${b.min[0] * MM}" y="${-b.max[2] * MM}" width="${(b.max[0] - b.min[0]) * MM}" height="${(b.max[2] - b.min[2]) * MM}" class="block"/>
      <polygon points="${pts(outline(d.side))}" class="wood" style="fill:${esc(d.paint)}"/>
      ${cuts.map((c) => `<polygon points="${pts(cutRegion(c, b))}" class="sawn"/>`).join("")}
      ${[0, xa].map((x) => `<circle cx="${x * MM}" cy="0" r="${r * MM}" class="wheel"/>`).join("")}
      <g id="kid-saw-layer">${line}</g>
    </svg>`;
  }

  private svgPoint(svg: SVGSVGElement, e: PointerEvent): P2 {
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [p.x / MM, -p.y / MM];
  }

  private onSawStart(e: PointerEvent): void {
    const svg = (e.target as Element).closest<SVGSVGElement>("#kid-side");
    if (!svg) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const a = this.svgPoint(svg, e);
    this.saw = { a, b: a };
    const layer = svg.querySelector("#kid-saw-layer")!;
    const move = (ev: PointerEvent): void => {
      if (!this.saw) return;
      this.saw = { a: this.saw.a, b: this.svgPoint(svg, ev) };
      layer.innerHTML = `<line class="kid-saw" x1="${this.saw.a[0] * MM}" y1="${-this.saw.a[1] * MM}" x2="${this.saw.b[0] * MM}" y2="${-this.saw.b[1] * MM}"/>`;
    };
    const up = (): void => {
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      const s = this.saw;
      this.saw = null;
      if (!s) return;
      const d = this.store.design;
      const cut = sawLine(d, s.a, s.b, newId("ks"));
      if (typeof cut === "string") this.say(cut);
      else {
        this.message = "";
        this.store.update({ ...d, features: [...d.features, cut] });
      }
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  }

  // --- Add Weight -----------------------------------------------------------------------------

  private weightHtml(d: CarDesign, ev: CarEvaluation, u: UnitSystem): string {
    const b = blockBox(kitValuesOf(d));
    const xa = ev.spec.wheelbase.value;
    const mine = d.ballast.filter(isKidWeight);
    const others = d.ballast.filter((x) => !isKidWeight(x));
    const item = (x: CarDesign["ballast"][number]): string => {
      const k = kidWeightOf(x);
      const lead = x.material === "lead";
      return `<li class="kid-weight">
        <div><b>${esc(k?.name ?? MATERIALS[x.material].name)}</b>${lead ? ' <span class="tag">A GROWN-UP PUTS THIS IN</span>' : ""}
          ${this.numbers && k ? `<span class="hint">${formatMass(rodMass(d, k), u)}</span>` : ""}
          <button class="kid-remove" data-kid-remove="${esc(x.id)}">Take it out</button></div>
        <label class="kid-slide"><span>Back</span><input type="range" data-kid-move="${esc(x.id)}" min="${(b.min[0] * MM).toFixed(1)}" max="${(b.max[0] * MM).toFixed(1)}" step="0.5" value="${(x.center[0] * MM).toFixed(1)}"><span>Front</span></label>
      </li>`;
    };
    const anyLead = mine.some((x) => x.material === "lead");
    return `<h2>Add a weight</h2>
      <div class="kid-add">${KID_WEIGHTS.map(
        (k) => `<button class="kid-big" data-kid-add="${k.id}">+ ${esc(k.name)}${this.numbers ? ` <span class="hint">${formatMass(rodMass(d, k), u)}</span>` : ""}</button>`,
      ).join("")}</div>
      <p class="hint">Each weight is a rod that goes in a hole drilled across the car. It starts at the back; slide it to move it.</p>
      ${mine.length ? `<ul class="kid-weights">${mine.map(item).join("")}</ul>` : `<p class="empty">No weights yet.</p>`}
      ${others.length ? `<p class="hint">${others.length} more weight${others.length > 1 ? "s" : ""} added in Builder: change ${others.length > 1 ? "them" : "it"} there.</p>` : ""}
      ${anyLead ? `<p class="notice">${esc(LEAD_NOTICE)} ${esc(this.leadAlternative())}</p>` : ""}
      <p>Your car's balance point is <b>${balanceWords(ev.total.centroid[0], xa)}</b>. See Why? to find out what moving the weights does.</p>`;
  }

  /** SAF-003: the non-lead alternative beside lead, in words. */
  private leadAlternative(): string {
    const f = nonLeadAlternative(1).volume;
    return `A tungsten rod of the same weight is about ${f < 0.55 ? "half" : f < 0.7 ? "two thirds" : "three quarters"} the size, and does not need a grown-up to put it in.`;
  }

  // --- Why? -----------------------------------------------------------------------------------

  private whyHtml(d: CarDesign, ev: CarEvaluation, ins: Inspection): string {
    const fails = ins.lines.filter((l) => l.state === "FAIL");
    const guesses = ins.lines.some((l) => l.provisional);
    const rules = fails.length
      ? `<ul class="kid-problems">${fails.map((l) => `<li>✗ ${esc(kidProblem(l))}</li>`).join("")}</ul>`
      : `<p class="kid-good">✓ Your car follows every race rule we can check.${guesses ? " Some sizes are guesses until a grown-up measures your kit, so check it at the race too." : ""}</p>`;
    return `<h2>Race rules</h2>${rules}
      <h2>What makes it faster?</h2>
      <p class="hint">We raced your car again with one thing changed each time, down the same track.</p>
      <div id="kid-why">${this.whyResults(d, ev)}</div>
      <p class="hint">These races use guessed sizes and friction, so they compare your cars with each other, not with real race times.</p>`;
  }

  private whyResults(d: CarDesign, ev: CarEvaluation): string {
    const run = this.why;
    if (!run || run.design !== d) return `<p class="empty">Racing…</p>`;
    if (!run.items.length) return `<p class="empty">Add a weight to see what moving it does.</p>`;
    const base = run.replies.get(run.base);
    const len = ev.extents.max[0] - ev.extents.min[0];
    return `<ul class="kid-whatifs">${run.items
      .map((it, i) => {
        const r = run.replies.get(run.base + 1 + i);
        if (!base || !r) return `<li>${esc(it.label)}: <span class="hint">racing…</span></li>`;
        if (base.time === null || r.time === null || base.finishSpeed === null) return `<li>${esc(it.label)}: <span class="hint">the car did not finish.</span></li>`;
        const dt = r.time - base.time;
        const words = lengthsWords(carLengths(dt, base.finishSpeed, len), dt < 0);
        const same = words === "about level";
        return `<li class="${same ? "" : dt < 0 ? "faster" : "slower"}">${esc(it.label)}, it would finish <b>${words}</b> ${same ? "with" : "of"} this one${
          this.numbers ? ` <span class="hint">(${dt >= 0 ? "+" : ""}${dt.toFixed(4)} s)</span>` : ""
        }.</li>`;
      })
      .join("")}</ul>`;
  }

  private scheduleWhy(d: CarDesign, ev: CarEvaluation): void {
    if (this.why?.design === d) return;
    clearTimeout(this.whyTimer);
    this.whyTimer = window.setTimeout(() => {
      if (this.store.design !== d) return;
      const items = this.tools.whatIfs(d, ev);
      const base = (this.seq += 100);
      this.why = { design: d, base, items, replies: new Map() };
      this.tools.post(ev.spec, base);
      items.forEach((it, i) => this.tools.post(it.spec, base + 1 + i));
      this.fillWhy();
    }, 250);
  }

  onWhy(r: RaceReply): void {
    const run = this.why;
    if (!run || r.seq < run.base || r.seq > run.base + run.items.length) return;
    run.replies.set(r.seq, r);
    this.fillWhy();
  }

  private fillWhy(): void {
    const el = this.root.querySelector("#kid-why");
    if (el && this.lastEv) el.innerHTML = this.whyResults(this.store.design, this.lastEv);
  }

  // --- Build It -------------------------------------------------------------------------------

  private buildHtml(d: CarDesign, ev: CarEvaluation): string {
    const practice = contextOf(d) === "SANDBOX";
    const lead = d.ballast.some((b) => b.material === "lead");
    const steps = ev.build.steps.filter((s) => s.state !== "nothing");
    return `<h2>Build your car</h2>
      <p class="kid-safety">Always build with a grown-up. They use the saw and the drill; you mark, sand and paint.</p>
      <div class="kid-add">
        <button class="kid-big" data-export="templates">Print the saw templates</button>
        <button class="kid-big" data-export="sheet">Print the build sheet for your grown-up</button>
      </div>
      <p class="hint">Print at 100 % size, then measure the little scale bars to check.</p>
      ${practice ? `<p class="notice">This is a practice car, so the printouts are marked SANDBOX. Fix it in Why? to make it race-ready.</p>` : ""}
      ${lead ? `<p class="notice">${esc(LEAD_NOTICE)}</p>` : ""}
      ${steps.length ? `<h3>The steps</h3><ol class="kid-build">${steps.map((s) => `<li>${esc(s.label)}${s.state === "blocked" ? " <b>(cannot be made like this)</b>" : ""}</li>`).join("")}</ol>` : ""}`;
  }

  // --- input ----------------------------------------------------------------------------------

  private say(text: string): void {
    this.message = text;
    if (this.lastEv && this.lastIns) this.render(this.store.design, this.lastEv, this.lastIns);
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const d = this.store.design;
    const step = t.closest<HTMLElement>("[data-step]")?.dataset.step as Step | undefined;
    if (step) {
      this.step = step;
      this.say("");
      return;
    }
    const shape = t.closest<HTMLElement>("[data-shape]")?.dataset.shape as KidShapeId | undefined;
    if (shape) {
      const r = this.tools.reshape(d, shape);
      this.message = r.dropped.length ? `${r.dropped.length === 1 ? "A weight did" : `${r.dropped.length} weights did`} not fit in the new shape, so it came out.` : "";
      // A car still called by a starting name takes the shape's name; one the child named keeps it.
      const named = !["Uncut block", "Wedge", ...KID_SHAPES.map((s) => s.name)].includes(d.name);
      this.store.update(named ? r.design : { ...r.design, name: KID_SHAPES.find((s) => s.id === shape)!.name });
      return;
    }
    const add = t.closest<HTMLElement>("[data-kid-add]")?.dataset.kidAdd;
    if (add) {
      const kind = KID_WEIGHTS.find((k) => k.id === add)!;
      const next = this.tools.addWeight(d, kind, newId("kw"));
      if (!next) this.say("There is no room left in the wood for that weight. Try a smaller one.");
      else {
        // The lead notice shows with the weight list once it is in; a rule may still refuse it.
        this.message = "";
        this.store.update(next);
      }
      return;
    }
    const rm = t.closest<HTMLElement>("[data-kid-remove]")?.dataset.kidRemove;
    if (rm) {
      this.message = "";
      this.store.update({ ...d, ballast: d.ballast.filter((b) => b.id !== rm), features: d.features.filter((f) => f.id !== kidBoreId(rm)) });
      return;
    }
    if (t.id === "kid-race") this.tools.race();
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.kidMove) {
      this.sliding = true;
      // Live while sliding: the solid follows without filling the undo history.
      const next = this.tools.moveWeight(this.store.design, t.dataset.kidMove, Number(t.value) / MM);
      if (next) this.store.update(next, false);
    }
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement;
    const d = this.store.design;
    if (t.id === "kid-numbers") this.store.setView({ kidNumbers: t.checked });
    else if (t.id === "kid-paint") this.store.update({ ...d, paint: t.value });
    else if (t.dataset.kidMove) {
      this.sliding = false;
      const next = this.tools.moveWeight(d, t.dataset.kidMove, Number(t.value) / MM);
      if (next) this.store.update(next);
      else this.say("There is not enough wood there for the weight.");
    }
  }
}

