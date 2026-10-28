// Side and top profile editors (spec 12.3): 2D panels beside the 3D view; edits update the solid
// live. Drawn in model millimetres. Side view: x right, z up. Top view: x right, car's left (+Y) up.
//
// Drag a vertex to move it; click an edge to add a vertex there; double-click a vertex to delete it.
// Weights can be dragged here too. Hold Alt to turn off the 0.25 mm snap.

import { formatLength } from "../core/display.js";
import type { CarDesign, P2, V3 } from "../geometry/design.js";
import { blockBox } from "../geometry/design.js";
import { wheelCentres } from "../geometry/solid.js";
import { TYPICAL_KIT_ESTIMATE as K } from "../kit/kit.js";
import { type CarEvaluation, shapeHalfSize } from "../mass/carModel.js";
import { CCCS_KIT_CAR_2026 } from "../rules/cccs.js";
import type { Store } from "./store.js";

const NS = "http://www.w3.org/2000/svg";
const MM = 1000;
const SNAP = 0.25e-3;

type Which = "side" | "top";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** Index of the vertical coordinate in a 3D point for this view. */
const vIndex = (w: Which): 1 | 2 => (w === "side" ? 2 : 1);

export class ProfileEditor {
  private readonly svg: SVGSVGElement;
  private readonly readout: HTMLElement;
  private drag:
    | { kind: "vertex"; index: number }
    | { kind: "ballast"; id: string; offset: [number, number] }
    | null = null;

  constructor(
    host: HTMLElement,
    private readonly store: Store,
    private readonly which: Which,
  ) {
    const b = blockBox();
    const pad = 12e-3;
    const x0 = b.min[0] - pad;
    const x1 = b.max[0] + pad;
    const [v0, v1] = which === "side" ? [-K.wheelRadius.value - 6e-3, b.max[2] + pad] : [-(K.blockWidth.value / 2 + 20e-3), K.blockWidth.value / 2 + 20e-3];
    this.svg = el("svg", {
      viewBox: `${x0 * MM} ${-v1 * MM} ${(x1 - x0) * MM} ${(v1 - v0) * MM}`,
      preserveAspectRatio: "xMidYMid meet",
      class: "profile-svg",
      role: "img",
      "aria-label": which === "side" ? "Side profile editor" : "Top profile editor",
    });
    host.appendChild(this.svg);
    this.readout = document.createElement("div");
    this.readout.className = "readout";
    host.appendChild(this.readout);
    this.installPointer();
  }

  /** Model coordinates (m, horizontal and vertical) of a pointer event. */
  private toModel(e: PointerEvent | MouseEvent): [number, number] {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = pt.matrixTransform(this.svg.getScreenCTM()!.inverse());
    return [m.x / MM, -m.y / MM];
  }

  /** Model millimetres per screen pixel, for handle sizes that stay constant on screen. */
  private mmPerPx(): number {
    const r = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    return r.width > 0 ? Math.max(vb.width / r.width, vb.height / Math.max(r.height, 1)) : 0.3;
  }

  private profile(d: CarDesign): readonly P2[] {
    return (this.which === "side" ? d.side : d.top).points;
  }

  private withProfile(d: CarDesign, pts: readonly P2[]): CarDesign {
    return this.which === "side" ? { ...d, side: { points: pts } } : { ...d, top: { points: pts } };
  }

  render(d: CarDesign, ev: CarEvaluation): void {
    const svg = this.svg;
    while (svg.lastChild) svg.removeChild(svg.lastChild);
    if (!this.drag) this.readout.textContent = "";
    const px = this.mmPerPx();
    const vi = vIndex(this.which);
    const P = (x: number, v: number): string => `${x * MM},${-v * MM}`;
    const units = this.store.view.units;

    // Grid: 5 mm / 25 mm in metric, 1/8 in / 1 in in English.
    const vb = svg.viewBox.baseVal;
    const [minor, major] = units === "metric" ? [5, 25] : [3.175, 25.4];
    const grid = el("g", { class: "grid" }, svg);
    for (let x = Math.ceil(vb.x / minor) * minor; x < vb.x + vb.width; x += minor) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      el("line", { x1: x, y1: vb.y, x2: x, y2: vb.y + vb.height, class: isMajor ? "major" : "minor" }, grid);
    }
    for (let y = Math.ceil(vb.y / minor) * minor; y < vb.y + vb.height; y += minor) {
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      el("line", { x1: vb.x, y1: y, x2: vb.x + vb.width, y2: y, class: isMajor ? "major" : "minor" }, grid);
    }

    // Block and kit parts.
    const b = blockBox();
    el("rect", { x: b.min[0] * MM, y: -b.max[vi] * MM, width: (b.max[0] - b.min[0]) * MM, height: (b.max[vi] - b.min[vi]) * MM, class: "block" }, svg);
    const r = K.wheelRadius.value;
    if (this.which === "side") {
      el("line", { x1: vb.x, y1: r * MM, x2: vb.x + vb.width, y2: r * MM, class: "contact" }, svg);
      const minClear = CCCS_KIT_CAR_2026.limits.find((l) => l.id === "RUL-004")!.si;
      el("line", { x1: vb.x, y1: -(minClear - r) * MM, x2: vb.x + vb.width, y2: -(minClear - r) * MM, class: "limit" }, svg);
      el("text", { x: vb.x + 2, y: -(minClear - r) * MM - 1.2, class: "label limit-label" }, svg).textContent = `min clearance ${formatLength(minClear, units)}`;
      for (const x of [0, K.frontAxleFromRear.value - K.rearAxleFromRear.value]) {
        el("circle", { cx: x * MM, cy: 0, r: r * MM, class: "wheel" }, svg);
        el("circle", { cx: x * MM, cy: 0, r: K.axleRadius.value * MM, class: "axle" }, svg);
      }
    } else {
      const ww = K.wheelWidth.value;
      for (const c of wheelCentres()) el("rect", { x: (c[0] - r) * MM, y: -(c[1] + ww / 2) * MM, width: 2 * r * MM, height: ww * MM, class: "wheel" }, svg);
      const halfW = CCCS_KIT_CAR_2026.limits.find((l) => l.id === "RUL-002")!.si / 2;
      for (const y of [halfW, -halfW]) el("line", { x1: vb.x, y1: -y * MM, x2: vb.x + vb.width, y2: -y * MM, class: "limit" }, svg);
      el("text", { x: vb.x + 2, y: -halfW * MM - 1.2, class: "label limit-label" }, svg).textContent = "max width";
    }

    // Weights: footprint in this view.
    for (const bl of d.ballast) {
      const h = shapeHalfSize(bl.shape);
      const sel = this.store.view.selection;
      const selected = sel?.kind === "ballast" && sel.id === bl.id;
      const isCyl = bl.shape.kind === "cylinder";
      const axisInView = isCyl && ((this.which === "side" && bl.shape.axis === "y") || (this.which === "top" && bl.shape.axis === "z"));
      const attrs = { class: `ballast${selected ? " selected" : ""}${bl.mounting === "cavity" ? " cavity" : ""}`, "data-ballast": bl.id };
      if (axisInView) el("circle", { cx: bl.center[0] * MM, cy: -bl.center[vi] * MM, r: h[0] * MM, ...attrs }, svg);
      else el("rect", { x: (bl.center[0] - h[0]) * MM, y: -(bl.center[vi] + h[vi]) * MM, width: 2 * h[0] * MM, height: 2 * h[vi] * MM, ...attrs }, svg);
    }

    // The editable outline.
    const pts = this.profile(d);
    el("polygon", { points: pts.map((p) => P(p[0], p[1])).join(" "), class: "profile", style: `fill:${d.paint}` }, svg);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      el("line", { x1: p[0] * MM, y1: -p[1] * MM, x2: q[0] * MM, y2: -q[1] * MM, class: "edge-hit", "stroke-width": 10 * px, "data-edge": i }, svg);
    });
    pts.forEach((p, i) => el("circle", { cx: p[0] * MM, cy: -p[1] * MM, r: 5 * px, class: "vertex", "data-vertex": i }, svg));

    // CG (projection into this view).
    const cg = ev.total.centroid;
    const cgG = el("g", { class: "cg" }, svg);
    el("circle", { cx: cg[0] * MM, cy: -cg[vi] * MM, r: 4 * px }, cgG);
    el("line", { x1: (cg[0] - 0.006) * MM, y1: -cg[vi] * MM, x2: (cg[0] + 0.006) * MM, y2: -cg[vi] * MM }, cgG);
    el("line", { x1: cg[0] * MM, y1: -(cg[vi] - 0.006) * MM, x2: cg[0] * MM, y2: -(cg[vi] + 0.006) * MM }, cgG);
  }

  private installPointer(): void {
    const svg = this.svg;
    const snap = (x: number, e: PointerEvent): number => (e.altKey ? x : Math.round(x / SNAP) * SNAP);
    const show = (h: number, v: number, what: string): void => {
      const u = this.store.view.units;
      this.readout.textContent = `${what}  x ${formatLength(h, u)}  ${this.which === "side" ? "z" : "y"} ${formatLength(v, u)}`;
    };

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const t = e.target as Element;
      const [h, v] = this.toModel(e);
      const d = this.store.design;
      if (t.hasAttribute("data-vertex")) {
        this.drag = { kind: "vertex", index: Number(t.getAttribute("data-vertex")) };
      } else if (t.hasAttribute("data-edge")) {
        const i = Number(t.getAttribute("data-edge"));
        const pts = [...this.profile(d)];
        pts.splice(i + 1, 0, [snap(h, e), snap(v, e)]);
        this.store.update(this.withProfile(d, pts), false);
        this.drag = { kind: "vertex", index: i + 1 };
      } else if (t.hasAttribute("data-ballast")) {
        const id = t.getAttribute("data-ballast")!;
        const bl = d.ballast.find((b) => b.id === id)!;
        this.drag = { kind: "ballast", id, offset: [bl.center[0] - h, bl.center[vIndex(this.which)] - v] };
        this.store.setView({ selection: { kind: "ballast", id } });
      } else return;
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    svg.addEventListener("pointermove", (e) => {
      const [h, v] = this.toModel(e);
      if (!this.drag) {
        show(h, v, "");
        return;
      }
      const d = this.store.design;
      if (this.drag.kind === "vertex") {
        const pts = [...this.profile(d)];
        pts[this.drag.index] = [snap(h, e), snap(v, e)];
        this.store.update(this.withProfile(d, pts), false);
        show(pts[this.drag.index]![0], pts[this.drag.index]![1], "vertex");
      } else {
        const { id, offset } = this.drag;
        const vi = vIndex(this.which);
        const nx = snap(h + offset[0], e);
        const nv = snap(v + offset[1], e);
        this.store.update(
          {
            ...d,
            ballast: d.ballast.map((b) => {
              if (b.id !== id) return b;
              const c = [...b.center] as [number, number, number];
              c[0] = nx;
              c[vi] = nv;
              return { ...b, center: c as V3 };
            }),
          },
          false,
        );
        show(nx, nv, "weight");
      }
    });

    const end = (e: PointerEvent): void => {
      if (!this.drag) return;
      this.drag = null;
      svg.releasePointerCapture(e.pointerId);
      this.store.commit();
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    svg.addEventListener("dblclick", (e) => {
      const t = e.target as Element;
      if (!t.hasAttribute("data-vertex")) return;
      const d = this.store.design;
      const pts = [...this.profile(d)];
      if (pts.length <= 3) return;
      pts.splice(Number(t.getAttribute("data-vertex")), 1);
      this.store.update(this.withProfile(d, pts));
    });
  }
}
