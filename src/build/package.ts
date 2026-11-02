// Build package (spec 14; BLD-001, BLD-002, BLD-004, LOC-WB-009, GEO-007). Everything here is derived
// from the master model: the cutting templates are the profiles themselves at 1:1 (6.1), and the STL is
// the evaluated solid (GEO-001: an export, never the master design).
//
// Export gate (14.2): a certified "BUILD THIS CAR" export needs the CERTIFIED context, every published
// hard rule and active lock passing, and nothing unevaluated. A SANDBOX design's exports say SANDBOX;
// a CERTIFIED design short of CERTIFIED COMPLIANT (the gate test, estimated kit values) says
// PROVISIONAL. Either way the sheet says why.

import { type UnitSystem, formatLength, formatMass } from "../core/display.js";
import { toMm } from "../core/units.js";
import { type CarDesign, type ComplianceContext, type Feature, type P2, blockBox, kitOf, kitValuesOf, shapeHalfSize } from "../geometry/design.js";
import { outline } from "../geometry/profile.js";
import type { BodySolid } from "../geometry/solid.js";
import { type KitValues, blockKit, kitNote } from "../kit/kit.js";
import type { CarEvaluation } from "../mass/carModel.js";
import { MATERIALS } from "../mass/materials.js";
import { type EventRules, type Inspection, type Permission, limitOf } from "../rules/cccs.js";

export interface ExportGate {
  /** True only for a certified export (BLD-004). */
  readonly certified: boolean;
  /** Printed across every page when not certified. */
  readonly watermark: string | null;
  /** Why the export is not certified, published-rule results apart from local constraints (14.2). */
  readonly reasons: readonly string[];
}

export function exportGate(ins: Inspection, context: ComplianceContext): ExportGate {
  const certified = context === "CERTIFIED" && ins.state === "CERTIFIED COMPLIANT";
  if (certified) return { certified, watermark: null, reasons: [] };
  const reasons =
    context === "SANDBOX"
      ? ["This design is in the SANDBOX context (MODE-002): nothing is enforced, so nothing it exports is certified."]
      : [`Compliance state: ${ins.state}. A certified export needs every check evaluated, passed and certain.`];
  const failing = ins.lines.filter((l) => l.state === "FAIL");
  const groups: [string, (c: string) => boolean][] = [
    ["Published rules", (c) => c === "PUBLISHED RULE"],
    ["Local constraints", (c) => c === "LOCAL/FROZEN"],
    ["Other checks", (c) => c !== "PUBLISHED RULE" && c !== "LOCAL/FROZEN"],
  ];
  for (const [name, has] of groups) {
    const f = failing.filter((l) => has(l.cls));
    if (f.length) reasons.push(`${name} not met: ${f.map((l) => l.label).join(", ")}.`);
  }
  const open = ins.lines.filter((l) => l.state === "NOT EVALUATED");
  if (open.length) reasons.push(`Not yet evaluated: ${open.map((l) => l.label).join(", ")}.`);
  const unsure = ins.lines.filter((l) => l.state === "PASS" && l.provisional);
  if (context === "CERTIFIED" && unsure.length) reasons.push(`Passed provisionally (estimated kit values or uncertainty): ${unsure.map((l) => l.label).join(", ")}.`);
  return { certified, watermark: context === "SANDBOX" ? "SANDBOX" : "PROVISIONAL", reasons };
}

// --- 1:1 templates -------------------------------------------------------------------------------

const MARGIN = 8; // mm
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f2 = (x: number): string => x.toFixed(2);

/**
 * Side and top cutting templates at 1:1, as an SVG sized in millimetres. Printed at 100 % (not fit to
 * page), the scale-check bars measure 100 mm and 4 in. The print-scale tolerance is a GEO-007 field
 * still to be characterized, so none is claimed.
 */
export function templatesSvg(design: CarDesign, ev: CarEvaluation, gate: ExportGate, ruleset: string, kit: KitValues = kitValuesOf(design)): string {
  const B = blockBox(kit);
  const L = toMm(B.max[0] - B.min[0]);
  const H = toMm(B.max[2] - B.min[2]);
  const W = toMm(B.max[1] - B.min[1]);
  const width = L + 2 * MARGIN;
  const X = (x: number): number => MARGIN + toMm(x - B.min[0]);
  const xf = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
  const out: string[] = [];
  let y0 = 22;

  // A panel: block, outline, axle datums, features, weights and CG, in one projection.
  const panel = (title: string, depth: number, top: number, Y: (v: number) => number, pts: readonly P2[], view: "side" | "top"): void => {
    const lo = view === "side" ? B.min[2] : B.min[1];
    const hi = view === "side" ? B.max[2] : B.max[1];
    out.push(`<text x="${MARGIN}" y="${f2(top - 3)}" class="h">${esc(title)}</text>`);
    out.push(`<rect x="${f2(X(B.min[0]))}" y="${f2(Y(hi))}" width="${f2(L)}" height="${f2(depth)}" class="block"/>`);
    out.push(`<polygon points="${pts.map((p) => `${f2(X(p[0]))},${f2(Y(p[1]))}`).join(" ")}" class="outline"/>`);
    for (const [x, name] of [
      [0, "REAR AXLE"],
      [xf, "FRONT AXLE"],
    ] as const) {
      out.push(`<line x1="${f2(X(x))}" x2="${f2(X(x))}" y1="${f2(Y(hi) - 2)}" y2="${f2(Y(lo) + 2)}" class="datum"/>`);
      out.push(`<text x="${f2(X(x) + 1)}" y="${f2(Y(lo) + 5)}" class="s">${name} (LOCAL/FROZEN)</text>`);
    }
    // Saw-cut lines run across the block: clip them to it.
    out.push(`<clipPath id="clip-${view}"><rect x="${f2(X(B.min[0]) - 1)}" y="${f2(Y(hi) - 1)}" width="${f2(L + 2)}" height="${f2(depth + 2)}"/></clipPath>`);
    out.push(`<g clip-path="url(#clip-${view})">`);
    for (const f of design.features) out.push(...featureMarks(f, view, X, Y));
    out.push("</g>");
    for (const b of design.ballast) {
      const h = shapeHalfSize(b.shape);
      const [u, v, hu, hv] = view === "side" ? [b.center[0], b.center[2], h[0], h[2]] : [b.center[0], b.center[1], h[0], h[1]];
      out.push(`<rect x="${f2(X(u - hu))}" y="${f2(Y(v + hv))}" width="${f2(toMm(2 * hu))}" height="${f2(toMm(2 * hv))}" class="weight"/>`);
      out.push(`<text x="${f2(X(u + hu) + 0.8)}" y="${f2(Y(v) + 1)}" class="s">${esc(b.id)}</text>`);
    }
    const [cu, cv] = view === "side" ? [ev.total.centroid[0], ev.total.centroid[2]] : [ev.total.centroid[0], ev.total.centroid[1]];
    out.push(`<g class="cg"><circle cx="${f2(X(cu))}" cy="${f2(Y(cv))}" r="1.6"/><path d="M${f2(X(cu) - 2.4)},${f2(Y(cv))}h4.8M${f2(X(cu))},${f2(Y(cv) - 2.4)}v4.8"/></g>`);
    out.push(`<text x="${f2(X(cu) + 2.4)}" y="${f2(Y(cv) - 2)}" class="s">CG</text>`);
    out.push(`<text x="${f2(X(B.max[0]) - 1)}" y="${f2(top - 3)}" class="s" text-anchor="end">NOSE →</text>`);
  };

  panel("SIDE OUTLINE (seen from the car's right; turn the sheet over to trace on the left side)", H, y0 + 6, (z) => y0 + 6 + toMm(B.max[2] - z), outline(design.side), "side");
  y0 += 6 + H + 16;
  panel("TOP OUTLINE (seen from above)", W, y0 + 6, (y) => y0 + 6 + toMm(B.max[1] - y), outline(design.top), "top");
  y0 += 6 + W + 16;

  // Scale-check bars.
  const bar = (len: number, ticks: number, label: string, at: number): void => {
    out.push(`<path d="M${MARGIN},${f2(at)}h${f2(len)}" class="bar"/>`);
    for (let i = 0; i <= ticks; i++) out.push(`<path d="M${f2(MARGIN + (len * i) / ticks)},${f2(at)}v${i % ticks === 0 ? -3 : -1.6}" class="tick"/>`);
    out.push(`<text x="${f2(MARGIN + len + 2)}" y="${f2(at)}" class="s">${label}</text>`);
  };
  bar(100, 10, "100 mm", y0);
  bar(toMm(4 * 0.0254), 8, "4 in", y0 + 8);
  out.push(
    `<text x="${MARGIN}" y="${f2(y0 + 15)}" class="s">Print at 100 % (actual size, not fit to page), then measure both bars. Print-scale tolerance: not yet set (GEO-007).</text>`,
  );
  out.push(`<text x="${MARGIN}" y="${f2(y0 + 19)}" class="s">${esc(kitOf(design).block.name)}. ${esc(kitNote(kitOf(design)))} Check the block and axle slots against these lines before cutting.</text>`);
  const height = y0 + 26;

  const head = [
    `<text x="${MARGIN}" y="9" class="t">${esc(design.name)}: cutting templates, 1:1</text>`,
    `<text x="${MARGIN}" y="14" class="s">Pinewood Dynamics · units mm · ${esc(ruleset)} · compliance ${gate.certified ? "CERTIFIED" : "not certified"}</text>`,
  ];
  const mark = gate.watermark
    ? `<text x="${f2(width / 2)}" y="${f2(height / 2)}" class="wm" transform="rotate(-18 ${f2(width / 2)} ${f2(height / 2)})" text-anchor="middle">${esc(gate.watermark)} · NOT CERTIFIED</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(width)}mm" height="${f2(height)}mm" viewBox="0 0 ${f2(width)} ${f2(height)}">
<style>
  text { font-family: Arial, Helvetica, sans-serif; fill: #111; }
  .t { font-size: 4.2px; font-weight: bold; } .h { font-size: 2.8px; font-weight: bold; } .s { font-size: 2.3px; }
  .block { fill: none; stroke: #999; stroke-width: 0.2; stroke-dasharray: 1.2 0.8; }
  .outline { fill: #f3ead9; stroke: #000; stroke-width: 0.35; }
  .datum { stroke: #1f5fa8; stroke-width: 0.2; stroke-dasharray: 2 0.8 0.4 0.8; }
  .hole { fill: none; stroke: #b3261e; stroke-width: 0.25; } .centre { stroke: #b3261e; stroke-width: 0.15; }
  .saw { stroke: #b3261e; stroke-width: 0.3; stroke-dasharray: 1.6 0.8; }
  .weight { fill: none; stroke: #555; stroke-width: 0.25; stroke-dasharray: 1.6 0.6 0.4 0.6; }
  .cg circle { fill: none; stroke: #000; stroke-width: 0.25; } .cg path { stroke: #000; stroke-width: 0.2; }
  .bar { stroke: #000; stroke-width: 0.35; } .tick { stroke: #000; stroke-width: 0.25; }
  .wm { font-size: 11px; font-weight: bold; fill: #000; fill-opacity: 0.08; }
</style>
${mark}
${head.join("\n")}
${out.join("\n")}
</svg>`;
}

/** A feature as seen in one projection: holes outlined with centre marks, saw cuts as lines. */
function featureMarks(f: Feature, view: "side" | "top", X: (x: number) => number, Y: (v: number) => number): string[] {
  const k = view === "side" ? 2 : 1; // the drawing's vertical axis: z in the side view, y in the top
  const across = view === "side" ? 1 : 2; // the axis seen end-on
  if (f.kind === "cut") {
    const out: string[] = [];
    for (const p of f.planes) {
      // A plane seen edge-on in this view: its normal has no component along the axis seen end-on.
      if (Math.abs(p.normal[across]) > 1e-6) continue;
      const dir = [-p.normal[k], p.normal[0]];
      const s = 0.25;
      const a = [p.point[0] - dir[0]! * s, p.point[k] - dir[1]! * s];
      const b = [p.point[0] + dir[0]! * s, p.point[k] + dir[1]! * s];
      out.push(`<line x1="${f2(X(a[0]!))}" y1="${f2(Y(a[1]!))}" x2="${f2(X(b[0]!))}" y2="${f2(Y(b[1]!))}" class="saw"/>`);
    }
    return out;
  }
  const c = f.center;
  const half: [number, number, number] =
    f.kind === "pocket"
      ? [f.size[0] / 2, f.size[1] / 2, f.size[2] / 2]
      : (["x", "y", "z"] as const).map((a) => (a === f.axis ? f.depth / 2 : f.diameter / 2)) as [number, number, number];
  const u = c[0];
  const v = c[k];
  const hu = half[0];
  const hv = half[k];
  const shape =
    f.kind === "bore" && f.axis === (view === "side" ? "y" : "z")
      ? `<circle cx="${f2(X(u))}" cy="${f2(Y(v))}" r="${f2(toMm(f.diameter / 2))}" class="hole"/>`
      : `<rect x="${f2(X(u - hu))}" y="${f2(Y(v + hv))}" width="${f2(toMm(2 * hu))}" height="${f2(toMm(2 * hv))}" class="hole"/>`;
  const m = 1.6;
  return [
    shape,
    `<path d="M${f2(X(u) - m)},${f2(Y(v))}h${2 * m}M${f2(X(u))},${f2(Y(v) - m)}v${2 * m}" class="centre"/>`,
    `<text x="${f2(X(u + hu) + 0.8)}" y="${f2(Y(v + hv) - 0.5)}" class="s">${esc(f.id)}</text>`,
  ];
}

// --- build sheet ---------------------------------------------------------------------------------

/**
 * A printable build sheet (HTML, one file): the templates, then targets, operations in shop order,
 * hole positions, weights, and the export status. Positions are from the block's tail end, its
 * centreline (left positive) and its bottom, the faces a builder measures from.
 */
export function buildSheetHtml(design: CarDesign, ev: CarEvaluation, ins: Inspection, gate: ExportGate, units: UnitSystem, kit: KitValues = kitValuesOf(design)): string {
  const B = blockBox(kit);
  const L = (m: number) => formatLength(m, units);
  const M = (kg: number) => formatMass(kg, units);
  const pos = (c: readonly number[]) =>
    `${L(c[0]! - B.min[0])} from tail · ${L(Math.abs(c[1]!))} ${c[1]! >= 0 ? "left" : "right"} of centre · ${L(c[2]! - B.min[2])} up from bottom`;
  const rules = ins.ruleset;
  const massRule = limitOf(rules, "RUL-006");
  const wb = kit.frontAxleFromRear.value - kit.rearAxleFromRear.value;
  const steps = new Map(ev.build.steps.map((s) => [s.id, s]));
  const holes = design.features
    .filter((f) => f.kind !== "cut")
    .map((f) => {
      const size = f.kind === "bore" ? `⌀ ${L(f.diameter)}, ${L(f.depth)} deep along ${f.axis.toUpperCase()}` : `${L(f.size[0])} × ${L(f.size[1])} × ${L(f.size[2])}`;
      const s = steps.get(f.id);
      return `<tr><td>${esc(f.id)}</td><td>${f.kind === "bore" ? "Bore" : "Pocket"}</td><td>${size}</td><td>${pos(f.center)}</td><td>${s ? `${s.tier ?? "–"}: ${esc(s.how)}` : "–"}</td></tr>`;
    });
  const weights = design.ballast.map((b) => {
    const h = shapeHalfSize(b.shape);
    const comp = ev.components.find((c) => c.group === "ballast" && c.name.endsWith(` ${b.id}`));
    const size = b.shape.kind === "cylinder" ? `⌀ ${L(b.shape.diameter)} × ${L(b.shape.length)} along ${b.shape.axis.toUpperCase()}` : `${L(2 * h[0])} × ${L(2 * h[1])} × ${L(2 * h[2])}`;
    return `<tr><td>${esc(b.id)}</td><td>${MATERIALS[b.material].name}</td><td>${size}</td><td>${comp ? M(comp.mass) : "–"}</td><td>${b.mounting}</td><td>${pos(b.center)}</td></tr>`;
  });
  const cg = ev.total.centroid;
  const ops = ev.build.steps.map((s) => `<li><b>${esc(s.label)}</b> (${s.state === "ok" ? s.tier : s.state === "blocked" ? "cannot be made as drawn" : "removes nothing"}): ${esc(s.how)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(design.name)}: build sheet</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 12mm; font-size: 11pt; }
  h1 { font-size: 16pt; margin: 0 0 2mm; } h2 { font-size: 12pt; margin: 6mm 0 2mm; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; } td, th { border-bottom: 0.2mm solid #bbb; padding: 1mm 2mm 1mm 0; text-align: left; vertical-align: top; }
  .status { border: 0.4mm solid #b3261e; padding: 2mm 3mm; margin: 3mm 0; }
  .note { color: #444; font-size: 9pt; }
  .templates svg { display: block; }
  @media print { .templates { page-break-after: always; } }
</style></head><body>
<div class="templates">${templatesSvg(design, ev, gate, rules.name, kit)}</div>
<h1>${esc(design.name)}: build sheet</h1>
<p class="note">Pinewood Dynamics. ${esc(rules.name)}. Units: ${units === "metric" ? "millimetres and grams" : "inches and ounces"}. Generated ${new Date().toISOString().slice(0, 10)}.</p>
<div class="status"><b>${gate.certified ? "BUILD THIS CAR: certified export" : `${gate.watermark}: not a certified export`}</b><br>${gate.reasons.map(esc).join("<br>")}</div>
<h2>Targets</h2>
<table>
  <tr><th>Finished mass</th><td>${M(ev.total.mass)} predicted${ev.massUncertainty > 0 ? ` ± ${M(2 * ev.massUncertainty)} (2σ, wood density ESTIMATED: weigh the block)` : " (block weighed)"}; ${
    massRule ? `limit ${M(massRule.si)} (${massRule.source.value} ${massRule.source.unit}), margin ${M(massRule.si - ev.total.mass)}. The event's official scale decides.` : "this event sets no mass limit."
  }</td></tr>
  <tr><th>Centre of gravity</th><td>${L(cg[0])} ahead of the rear axle (${L(cg[0] - B.min[0])} from the tail), ${L(cg[2] - B.min[2])} up from the bottom, ${L(Math.abs(cg[1]))} ${cg[1] >= 0 ? "left" : "right"} of centre.</td></tr>
  <tr><th>Kit</th><td>${esc(kitOf(design).block.name)}, on ${esc(kitOf(design).wheels.name.toLowerCase())}${design.kit ? "" : " (assumed: no kit chosen)"}. ${esc(kitNote(kitOf(design)))}${
    kitOf(design).block.notModelled ? ` ${esc(kitOf(design).block.notModelled!)}` : ""
  }</td></tr>
  <tr><th>Wheelbase</th><td>${L(wb)}, LOCAL/FROZEN: set by the kit's axle slots, which are not moved.${
    kitOf(design).block.frontAxleFromRear.provenance === "MEASURED" ? " Measured." : " Value ESTIMATED until the kit is measured."
  }</td></tr>
  <tr><th>Compliance</th><td>${ins.state}</td></tr>
</table>
<h2>Event rules: ${esc(rules.name)}</h2>
<p class="note">${esc(rules.organization)}, ${esc(rules.effective)}. ${esc(rules.sourceLine)}. ${rules.provenance === "LOCAL" ? "Local rules entered for this race." : "As published."} ${
    rules.review.status === "CONFIRMED" ? `Confirmed ${esc(rules.review.date ?? "")}.` : "Not yet confirmed against the event's written rules."
  }</p>
<table>${rules.limits.map((l) => `<tr><th>${esc(l.label)}</th><td>${l.kind === "max" ? "at most" : "at least"} ${l.source.value} ${l.source.unit}</td></tr>`).join("")}
${eventRows(rules.event).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
<h3>Before check-in</h3>
<ul>${rules.event.checklist.map((c) => `<li>☐ ${esc(c)}</li>`).join("")}</ul>
<p class="note">The software cannot verify these; the event's officials decide them.</p>
<h2>Operations, in shop order</h2><ol>${ops}</ol>
<h2>Holes and pockets</h2>
${holes.length ? `<table><tr><th>Id</th><th>Kind</th><th>Size</th><th>Centre</th><th>How</th></tr>${holes.join("")}</table>` : `<p class="note">None.</p>`}
<h2>Weights</h2>
${weights.length ? `<table><tr><th>Id</th><th>Material</th><th>Size</th><th>Mass</th><th>Mounting</th><th>Centre</th></tr>${weights.join("")}</table>` : `<p class="note">None.</p>`}
${design.ballast.some((b) => MATERIALS[b.material].safety === "lead") ? `<p class="note"><b>Lead:</b> wash hands after handling; an adult should handle cutting or melting (SAF-003).</p>` : ""}
</body></html>`;
}

const PERMIT: Record<Permission, string> = { allowed: "Allowed", prohibited: "Not allowed", unknown: "Not stated: ask the event" };

/** The event rules as label and reading, for the sheet. */
function eventRows(e: EventRules): [string, string][] {
  return [
    ["Kit parts", e.kitPartsOnly ? "Wood, wheels and axles from the event's kit" : "Not required"],
    ["Event kit", e.issuedKit ? (blockKit(e.issuedKit)?.name ?? e.issuedKit) : "Not stated: ask the event"],
    ["Kit axle slots", e.axleSlots === "required" ? "Must be used" : e.axleSlots === "optional" ? "Optional (wheelbase may change)" : "Not stated: ask the event"],
    ["Reshaping wheels", PERMIT[e.wheelReshaping]],
    ["Bent or canted axles", PERMIT[e.bentAxles]],
    ["Raised wheel (three-wheel running)", PERMIT[e.raisedWheel]],
    ["Washers, bushings, bearings", PERMIT[e.washersBearings]],
    ["Lubricant", e.lubricant === "dry only" ? "Dry lubricant only" : e.lubricant === "any" ? "Any" : e.lubricant === "none" ? "None" : "Not stated: ask the event"],
  ];
}

// --- STL -----------------------------------------------------------------------------------------

/** Binary STL of the evaluated body solid in the unit chosen at export (6.4: millimetres by default). */
export function bodyStl(body: BodySolid, unit: "mm" | "in", name: string): Uint8Array<ArrayBuffer> {
  const k = unit === "mm" ? 1000 : 1 / 0.0254;
  const P = body.positions;
  const I = body.indices;
  const n = I.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const view = new DataView(buf);
  const header = `Pinewood Dynamics body: ${name}; units ${unit}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const v = [0, 1, 2].map((j) => {
      const i = I[3 * t + j]!;
      return [P[3 * i]! * k, P[3 * i + 1]! * k, P[3 * i + 2]! * k];
    });
    const a = v[0]!;
    const b = v[1]!;
    const c = v[2]!;
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const nrm = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const len = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!) || 1;
    const o = 84 + 50 * t;
    for (let j = 0; j < 3; j++) view.setFloat32(o + 4 * j, nrm[j]! / len, true);
    for (let q = 0; q < 3; q++) for (let j = 0; j < 3; j++) view.setFloat32(o + 12 + 12 * q + 4 * j, v[q]![j]!, true);
    view.setUint16(o + 48, 0, true);
  }
  return new Uint8Array(buf);
}

/** File names state the content and, for the STL, the unit (6.4). */
export const packageFileName = (design: CarDesign, what: "templates" | "build-sheet" | "body", unit?: "mm" | "in"): string => {
  const base = design.name.replace(/[^\w.-]+/g, "_") || "design";
  return what === "templates" ? `${base}.templates.1to1.svg` : what === "build-sheet" ? `${base}.build-sheet.html` : `${base}.body.${unit}.stl`;
};
