// Side and top profile editors (spec 12.3): 2D panels beside the 3D view; edits update the solid
// live. Drawn in model millimetres. Side view: x right, z up. Top view: x right, car's left (+Y) up.
//
// Outline: drag a vertex to move it; click an edge to add a vertex; double-click a vertex to delete
// it; right-click a vertex (or hover and press S) to switch it between corner and smooth; hover a
// corner and press R to round it off with a tangent arc. Drag an edge's middle handle to bend the
// edge into an arc; double-click that handle to straighten it.
// Weights, bores and pockets drag here too; a saw cut seen edge-on shows its removed region, with a
// handle to move it and one per plane to turn it. Hold Alt to turn off the 0.25 mm snap.

import { formatLength } from "../core/display.js";
import type { CarDesign, Cut, P2, Profile, V3 } from "../geometry/design.js";
import { blockBox, kitValuesOf } from "../geometry/design.js";
import {
  bendEdge,
  deleteVertex,
  edgeMidpoint,
  edgePoints,
  filletVertex,
  insertVertex,
  isSmooth,
  moveVertex,
  outline,
  straightenEdge,
  toggleSmooth,
} from "../geometry/profile.js";
import { featureShape, wheelCentres } from "../geometry/solid.js";
import { type KitValues, TYPICAL_KIT_ESTIMATE } from "../kit/kit.js";
import { type CarEvaluation, shapeHalfSize } from "../mass/carModel.js";
import { limitOf, rulesOf } from "../rules/cccs.js";
import type { Store } from "./store.js";

const NS = "http://www.w3.org/2000/svg";
const MM = 1000;
const SNAP = 0.25e-3;
/** Distance of a cut's turning handle from its point, m. */
const TURN_HANDLE = 0.012;
/** Radius R rounds a corner with: 1/4 in, a common sanding-block or coping-saw curve. */
const FILLET_RADIUS = 0.00635;
/** Two presses on the same handle within this long are a double-click, ms. */
const DOUBLE_CLICK = 400;

type Which = "side" | "top";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** Index of the vertical coordinate in a 3D point for this view. */
const vIndex = (w: Which): 1 | 2 => (w === "side" ? 2 : 1);
/** Index of the axis this view looks along (the profile's sweep direction). */
const sweepIndex = (w: Which): 1 | 2 => (w === "side" ? 1 : 2);

/** A saw cut is seen edge-on in a view when every plane contains the view direction. */
export function cutInView(c: Cut, which: Which): boolean {
  const si = sweepIndex(which);
  return c.planes.every((p) => Math.abs(p.normal[si]) <= 1e-9 * Math.hypot(...p.normal));
}

/** Convex polygon clipped to the half-plane (q - p) . n >= 0. */
function clipHalf(poly: P2[], p: P2, n: P2): P2[] {
  const f = (q: P2): number => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (f(a) >= 0) out.push(a);
    if (f(a) >= 0 !== f(b) >= 0) {
      const t = f(a) / (f(a) - f(b));
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

type Drag =
  | { kind: "vertex"; index: number }
  | { kind: "bend"; index: number }
  | { kind: "ballast"; id: string; offset: [number, number] }
  | { kind: "feature"; id: string; offset: [number, number] }
  | { kind: "turn"; id: string; plane: number };

export class ProfileEditor {
  private readonly svg: SVGSVGElement;
  private readonly readout: HTMLElement;
  private drag: Drag | null = null;
  /** Where the pointer went down; a drag starts only once it has moved a few pixels. */
  private downAt: { x: number; y: number; moved: boolean } | null = null;
  /**
   * The last press on a vertex or edge handle. Pointer capture sends the browser's own dblclick to
   * the SVG rather than the handle, so double-clicks are recognised here.
   */
  private lastPress: { key: string; t: number } | null = null;
  private hoverVertex: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly store: Store,
    private readonly which: Which,
  ) {
    this.svg = el("svg", {
      preserveAspectRatio: "xMidYMid meet",
      class: "profile-svg",
      role: "img",
      "aria-label": which === "side" ? "Side profile editor" : "Top profile editor",
    });
    this.fit(TYPICAL_KIT_ESTIMATE);
    host.appendChild(this.svg);
    this.readout = document.createElement("div");
    this.readout.className = "readout";
    host.appendChild(this.readout);
    this.installPointer();
  }

  /** The kit the view is framed for. */
  private framed = "";

  /** Frame the view on the kit's block and wheels. */
  private fit(K: KitValues): void {
    this.framed = JSON.stringify(K);
    const b = blockBox(K);
    const pad = 12e-3;
    const x0 = b.min[0] - pad;
    const x1 = b.max[0] + pad;
    const [v0, v1] = this.which === "side" ? [-K.wheelRadius.value - 6e-3, b.max[2] + pad] : [-(K.blockWidth.value / 2 + 20e-3), K.blockWidth.value / 2 + 20e-3];
    this.svg.setAttribute("viewBox", `${x0 * MM} ${-v1 * MM} ${(x1 - x0) * MM} ${(v1 - v0) * MM}`);
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

  private profile(d: CarDesign): Profile {
    return this.which === "side" ? d.side : d.top;
  }

  private withProfile(d: CarDesign, p: Profile): CarDesign {
    return this.which === "side" ? { ...d, side: p } : { ...d, top: p };
  }

  render(d: CarDesign, ev: CarEvaluation): void {
    const K = kitValuesOf(d);
    if (JSON.stringify(K) !== this.framed) this.fit(K);
    const svg = this.svg;
    while (svg.lastChild) svg.removeChild(svg.lastChild);
    if (!this.drag) this.readout.textContent = "";
    const px = this.mmPerPx();
    const vi = vIndex(this.which);
    const P = (p: P2): string => `${p[0] * MM},${-p[1] * MM}`;
    const units = this.store.view.units;
    const sel = this.store.view.selection;

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
    const b = blockBox(K);
    el("rect", { x: b.min[0] * MM, y: -b.max[vi] * MM, width: (b.max[0] - b.min[0]) * MM, height: (b.max[vi] - b.min[vi]) * MM, class: "block" }, svg);
    const r = K.wheelRadius.value;
    if (this.which === "side") {
      el("line", { x1: vb.x, y1: r * MM, x2: vb.x + vb.width, y2: r * MM, class: "contact" }, svg);
      // The design's own rules: a limit the event does not set is not drawn.
      const minClear = limitOf(rulesOf(d), "RUL-004")?.si;
      if (minClear !== undefined) {
        el("line", { x1: vb.x, y1: -(minClear - r) * MM, x2: vb.x + vb.width, y2: -(minClear - r) * MM, class: "limit" }, svg);
        el("text", { x: vb.x + 2, y: -(minClear - r) * MM - 1.2, class: "label limit-label" }, svg).textContent = `min clearance ${formatLength(minClear, units)}`;
      }
      for (const x of [0, K.frontAxleFromRear.value - K.rearAxleFromRear.value]) {
        el("circle", { cx: x * MM, cy: 0, r: r * MM, class: "wheel" }, svg);
        el("circle", { cx: x * MM, cy: 0, r: K.axleRadius.value * MM, class: "axle" }, svg);
      }
    } else {
      const ww = K.wheelWidth.value;
      for (const c of wheelCentres(K)) el("rect", { x: (c[0] - r) * MM, y: -(c[1] + ww / 2) * MM, width: 2 * r * MM, height: ww * MM, class: "wheel" }, svg);
      const width = limitOf(rulesOf(d), "RUL-002")?.si;
      if (width !== undefined) {
        const halfW = width / 2;
        for (const y of [halfW, -halfW]) el("line", { x1: vb.x, y1: -y * MM, x2: vb.x + vb.width, y2: -y * MM, class: "limit" }, svg);
        el("text", { x: vb.x + 2, y: -halfW * MM - 1.2, class: "label limit-label" }, svg).textContent = "max width";
      }
    }

    // The editable outline: fill, then per-edge hit paths, edge-bending handles and vertices.
    const prof = this.profile(d);
    const pts = prof.points;
    el("polygon", { points: outline(prof).map(P).join(" "), class: "profile", style: `fill:${d.paint}` }, svg);
    pts.forEach((_, i) => {
      el("polyline", { points: edgePoints(prof, i).map(P).join(" "), class: "edge-hit", "stroke-width": 10 * px, "data-edge": i }, svg);
    });

    // Saw cuts seen edge-on: the region they remove from the block, hatched.
    for (const f of d.features) if (f.kind === "cut") this.drawCutRegion(f, b, sel?.kind === "feature" && sel.id === f.id);

    // Weights, bores and pockets: footprint in this view.
    const sweep = this.which === "side" ? "y" : "z";
    for (const bl of d.ballast) {
      const h = shapeHalfSize(bl.shape);
      const selected = sel?.kind === "ballast" && sel.id === bl.id;
      const axisInView = bl.shape.kind === "cylinder" && bl.shape.axis === sweep;
      const attrs = { class: `ballast${selected ? " selected" : ""}${bl.mounting === "cavity" ? " cavity" : ""}`, "data-ballast": bl.id };
      if (axisInView) el("circle", { cx: bl.center[0] * MM, cy: -bl.center[vi] * MM, r: h[0] * MM, ...attrs }, svg);
      else el("rect", { x: (bl.center[0] - h[0]) * MM, y: -(bl.center[vi] + h[vi]) * MM, width: 2 * h[0] * MM, height: 2 * h[vi] * MM, ...attrs }, svg);
    }
    for (const f of d.features) {
      if (f.kind === "cut") continue;
      const shape = featureShape(f);
      const h = shapeHalfSize(shape);
      const selected = sel?.kind === "feature" && sel.id === f.id;
      const attrs = { class: `feature${selected ? " selected" : ""}`, "data-feature": f.id };
      if (shape.kind === "cylinder" && shape.axis === sweep) el("circle", { cx: f.center[0] * MM, cy: -f.center[vi] * MM, r: h[0] * MM, ...attrs }, svg);
      else el("rect", { x: (f.center[0] - h[0]) * MM, y: -(f.center[vi] + h[vi]) * MM, width: 2 * h[0] * MM, height: 2 * h[vi] * MM, ...attrs }, svg);
    }
    for (const f of d.features) if (f.kind === "cut") this.drawCutHandles(f, px, sel?.kind === "feature" && sel.id === f.id);

    pts.forEach((_, i) => {
      const m = edgeMidpoint(prof, i);
      el("circle", { cx: m[0] * MM, cy: -m[1] * MM, r: 3.2 * px, class: "mid", "data-mid": i }, svg);
    });
    pts.forEach((p, i) => {
      const s = 5 * px;
      if (isSmooth(prof, i)) el("circle", { cx: p[0] * MM, cy: -p[1] * MM, r: s, class: "vertex smooth", "data-vertex": i }, svg);
      else el("rect", { x: p[0] * MM - s, y: -p[1] * MM - s, width: 2 * s, height: 2 * s, class: "vertex", "data-vertex": i }, svg);
    });

    // CG (projection into this view).
    const cg = ev.total.centroid;
    const cgG = el("g", { class: "cg" }, svg);
    el("circle", { cx: cg[0] * MM, cy: -cg[vi] * MM, r: 4 * px }, cgG);
    el("line", { x1: (cg[0] - 0.006) * MM, y1: -cg[vi] * MM, x2: (cg[0] + 0.006) * MM, y2: -cg[vi] * MM }, cgG);
    el("line", { x1: cg[0] * MM, y1: -(cg[vi] - 0.006) * MM, x2: cg[0] * MM, y2: -(cg[vi] + 0.006) * MM }, cgG);
  }

  private drawCutRegion(c: Cut, b: { min: V3; max: V3 }, selected: boolean): void {
    if (!cutInView(c, this.which)) return;
    const vi = vIndex(this.which);
    let poly: P2[] = [
      [b.min[0], b.min[vi]],
      [b.max[0], b.min[vi]],
      [b.max[0], b.max[vi]],
      [b.min[0], b.max[vi]],
    ];
    for (const pl of c.planes) poly = clipHalf(poly, [pl.point[0], pl.point[vi]], [pl.normal[0], pl.normal[vi]]);
    if (poly.length < 3) return;
    el("polygon", { points: poly.map((p) => `${p[0] * MM},${-p[1] * MM}`).join(" "), class: `cut-region${selected ? " selected" : ""}`, "data-feature": c.id }, this.svg);
  }

  private drawCutHandles(c: Cut, px: number, selected: boolean): void {
    const vi = vIndex(this.which);
    const p0 = c.planes[0].point;
    const inView = cutInView(c, this.which);
    if (inView)
      c.planes.forEach((pl, k) => {
        const n: P2 = [pl.normal[0], pl.normal[vi]];
        const l = Math.hypot(...n);
        const t: P2 = [-n[1] / l, n[0] / l];
        const q: P2 = [pl.point[0], pl.point[vi]];
        const far = 0.3;
        el("line", { x1: (q[0] - t[0] * far) * MM, y1: -(q[1] - t[1] * far) * MM, x2: (q[0] + t[0] * far) * MM, y2: -(q[1] + t[1] * far) * MM, class: "cut-line" }, this.svg);
        // On a wedge, put each plane's turning handle on the side of the notch it bounds.
        const side = c.planes.length === 2 ? Math.sign(t[0] * (c.planes[1 - k]!.normal[0]) + t[1] * c.planes[1 - k]!.normal[vi]) || 1 : 1;
        const h: P2 = [q[0] + side * t[0] * TURN_HANDLE, q[1] + side * t[1] * TURN_HANDLE];
        el("circle", { cx: h[0] * MM, cy: -h[1] * MM, r: 4 * px, class: "cut-turn", "data-feature": c.id, "data-turn": k }, this.svg);
      });
    el("circle", { cx: p0[0] * MM, cy: -p0[vi] * MM, r: 5 * px, class: `cut-point${selected ? " selected" : ""}${inView ? "" : " off-view"}`, "data-feature": c.id }, this.svg);
  }

  private installPointer(): void {
    const svg = this.svg;
    const snap = (x: number, e: PointerEvent): number => (e.altKey ? x : Math.round(x / SNAP) * SNAP);
    const show = (h: number, v: number, what: string): void => {
      const u = this.store.view.units;
      this.readout.textContent = `${what}  x ${formatLength(h, u)}  ${this.which === "side" ? "z" : "y"} ${formatLength(v, u)}`;
    };
    const vi = vIndex(this.which);
    const featureAnchor = (d: CarDesign, id: string): [number, number] | null => {
      const f = d.features.find((x) => x.id === id);
      if (!f) return null;
      const c = f.kind === "cut" ? f.planes[0].point : f.center;
      return [c[0], c[vi]];
    };

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const t = e.target as Element;
      const [h, v] = this.toModel(e);
      const d = this.store.design;
      const handle = t.hasAttribute("data-vertex") ? `v${t.getAttribute("data-vertex")}` : t.hasAttribute("data-mid") ? `m${t.getAttribute("data-mid")}` : null;
      if (handle && this.lastPress?.key === handle && e.timeStamp - this.lastPress.t < DOUBLE_CLICK) {
        this.lastPress = null;
        const i = Number(handle.slice(1));
        const p = this.profile(d);
        this.store.update(this.withProfile(d, handle[0] === "v" ? deleteVertex(p, i) : straightenEdge(p, i)));
        e.preventDefault();
        return;
      }
      this.lastPress = handle ? { key: handle, t: e.timeStamp } : null;
      if (t.hasAttribute("data-vertex")) {
        this.drag = { kind: "vertex", index: Number(t.getAttribute("data-vertex")) };
      } else if (t.hasAttribute("data-mid")) {
        this.drag = { kind: "bend", index: Number(t.getAttribute("data-mid")) };
      } else if (t.hasAttribute("data-edge")) {
        const i = Number(t.getAttribute("data-edge"));
        this.store.update(this.withProfile(d, insertVertex(this.profile(d), i, [snap(h, e), snap(v, e)])), false);
        this.drag = { kind: "vertex", index: i + 1 };
      } else if (t.hasAttribute("data-ballast")) {
        const id = t.getAttribute("data-ballast")!;
        const bl = d.ballast.find((b) => b.id === id)!;
        this.drag = { kind: "ballast", id, offset: [bl.center[0] - h, bl.center[vi] - v] };
        this.store.setView({ selection: { kind: "ballast", id } });
      } else if (t.hasAttribute("data-feature")) {
        const id = t.getAttribute("data-feature")!;
        this.store.setView({ selection: { kind: "feature", id } });
        if (t.hasAttribute("data-turn")) this.drag = { kind: "turn", id, plane: Number(t.getAttribute("data-turn")) };
        else {
          const a = featureAnchor(d, id);
          if (!a) return;
          this.drag = { kind: "feature", id, offset: [a[0] - h, a[1] - v] };
        }
      } else return;
      this.downAt = { x: e.clientX, y: e.clientY, moved: t.hasAttribute("data-edge") };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    svg.addEventListener("pointermove", (e) => {
      const [h, v] = this.toModel(e);
      if (!this.drag) {
        show(h, v, "");
        return;
      }
      // Ignore the jitter of a click, so a double-click lands on the same handle it started on.
      if (this.downAt && !this.downAt.moved) {
        if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 3) return;
        this.downAt.moved = true;
      }
      const d = this.store.design;
      const drag = this.drag;
      if (drag.kind === "vertex") {
        const p: P2 = [snap(h, e), snap(v, e)];
        this.store.update(this.withProfile(d, moveVertex(this.profile(d), drag.index, p)), false);
        show(p[0], p[1], "vertex");
      } else if (drag.kind === "bend") {
        this.store.update(this.withProfile(d, bendEdge(this.profile(d), drag.index, [h, v])), false);
        show(h, v, "arc through");
      } else if (drag.kind === "ballast") {
        const nx = snap(h + drag.offset[0], e);
        const nv = snap(v + drag.offset[1], e);
        this.store.update(
          {
            ...d,
            ballast: d.ballast.map((b) => {
              if (b.id !== drag.id) return b;
              const c = [...b.center] as [number, number, number];
              c[0] = nx;
              c[vi] = nv;
              return { ...b, center: c as V3 };
            }),
          },
          false,
        );
        show(nx, nv, "weight");
      } else if (drag.kind === "feature") {
        const nx = snap(h + drag.offset[0], e);
        const nv = snap(v + drag.offset[1], e);
        const a = featureAnchor(d, drag.id);
        if (!a) return;
        const dx = nx - a[0];
        const dv = nv - a[1];
        const move = (c: V3): V3 => {
          const m = [...c] as [number, number, number];
          m[0] += dx;
          m[vi] += dv;
          return m as V3;
        };
        this.store.update(
          {
            ...d,
            features: d.features.map((f) => {
              if (f.id !== drag.id) return f;
              if (f.kind !== "cut") return { ...f, center: move(f.center) };
              return { ...f, planes: f.planes.map((p) => ({ ...p, point: move(p.point) })) as unknown as Cut["planes"] };
            }),
          },
          false,
        );
        show(nx, nv, d.features.find((f) => f.id === drag.id)?.kind ?? "");
      } else {
        // Turn one plane of a cut: its line follows the handle, its removed side stays continuous.
        this.store.update(
          {
            ...d,
            features: d.features.map((f) => {
              if (f.id !== drag.id || f.kind !== "cut") return f;
              const planes = f.planes.map((pl, k) => {
                if (k !== drag.plane) return pl;
                const t: P2 = [h - pl.point[0], v - pl.point[vi]];
                if (Math.hypot(...t) < 1e-4) return pl;
                let n: P2 = [t[1], -t[0]];
                if (n[0] * pl.normal[0] + n[1] * pl.normal[vi] < 0) n = [-n[0], -n[1]];
                const l = Math.hypot(...n);
                const normal = [0, 0, 0] as [number, number, number];
                normal[0] = n[0] / l;
                normal[vi] = n[1] / l;
                return { ...pl, normal: normal as V3 };
              });
              return { ...f, planes: planes as unknown as Cut["planes"] };
            }),
          },
          false,
        );
        const f = this.store.design.features.find((x) => x.id === drag.id);
        if (f?.kind === "cut") {
          const n = f.planes[drag.plane]!.normal;
          this.readout.textContent = `plane at ${((Math.atan2(n[vi], n[0]) * 180) / Math.PI).toFixed(1)}° from +x`;
        }
      }
    });

    const end = (e: PointerEvent): void => {
      if (!this.drag) return;
      this.drag = null;
      this.downAt = null;
      svg.releasePointerCapture(e.pointerId);
      this.store.commit();
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    const smooth = (i: number): void => {
      const d = this.store.design;
      this.store.update(this.withProfile(d, toggleSmooth(this.profile(d), i)));
    };
    svg.addEventListener("contextmenu", (e) => {
      const t = e.target as Element;
      if (!t.hasAttribute("data-vertex")) return;
      e.preventDefault();
      smooth(Number(t.getAttribute("data-vertex")));
    });
    svg.addEventListener("pointerover", (e) => {
      const t = e.target as Element;
      this.hoverVertex = t.hasAttribute("data-vertex") ? Number(t.getAttribute("data-vertex")) : null;
    });
    svg.addEventListener("pointerleave", () => {
      this.hoverVertex = null;
    });
    window.addEventListener("keydown", (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (this.hoverVertex === null || typing || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "s") smooth(this.hoverVertex);
      if (key === "r") {
        const d = this.store.design;
        this.store.update(this.withProfile(d, filletVertex(this.profile(d), this.hoverVertex, FILLET_RADIUS)));
        this.hoverVertex = null;
      }
    });
  }
}
