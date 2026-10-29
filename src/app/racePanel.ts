// Race mode (spec 13): setup, the replay with its countdown, clock and finish order, and the results.
// Race setup 13.1, presentation 13.2, results 13.3.

import { weakest } from "../core/provenance.js";
import { DEFAULT_ENVIRONMENT } from "../kit/kit.js";
import type { CarSpec } from "../physics/car.js";
import { inputProvenance } from "../physics/car.js";
import { type Fidelity, type LaneResult, MAX_LANES, type Session, finishOrder, poseAt } from "../race/session.js";
import type { ComplianceState } from "../rules/cccs.js";
import { CCCS_KIT_CAR_2026 } from "../rules/cccs.js";
import type { BestTrackLength } from "../track/track.js";
import { bestTrack } from "../track/track.js";
import type { CarDesign } from "../geometry/design.js";
import type { BodySolid } from "../geometry/solid.js";
import type { SessionReply, SessionRequest } from "./race.worker.js";
import { LANE_COLOURS, type LaneCar, type RaceCamera, RaceView } from "./raceView.js";
import type { Store } from "./store.js";

/** What race mode needs from the design pipeline for one car. */
export interface EvaluatedCar {
  readonly spec: CarSpec;
  readonly body: BodySolid;
  readonly compliance: ComplianceState;
}

const COUNTDOWN = 3;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Pick {
  readonly label: string;
  readonly design: CarDesign;
}

export class RacePanel {
  private readonly view: RaceView;
  private choice: string[] = ["current", "", "", ""];
  private length: BestTrackLength = 35;
  private fidelity: Fidelity = "standard";
  private seq = 0;
  private session: Session | null = null;
  private cars: (LaneCar | null)[] = [];
  private t = -COUNTDOWN;
  private speed = 1;
  private paused = false;
  private last = 0;
  private active = false;
  private running = false;

  constructor(
    private readonly els: { setup: HTMLElement; view: HTMLElement; results: HTMLElement; overlay: HTMLElement; bar: HTMLElement },
    private readonly store: Store,
    private readonly evaluate: (d: CarDesign) => EvaluatedCar | null,
    private readonly worker: Worker,
  ) {
    this.view = new RaceView(els.view);
    this.view.setTrack(bestTrack(this.length));
    this.wireBar();
    this.renderResults();
  }

  /** Called with the worker's session reply. */
  onSession(r: SessionReply): void {
    if (r.seq !== this.seq) return;
    this.running = false;
    this.session = r.session;
    this.view.setCars(r.session, this.cars);
    this.restart();
    this.renderSetup();
    this.renderResults();
  }

  setActive(on: boolean): void {
    this.active = on;
    if (on) {
      this.renderSetup();
      this.last = performance.now();
      requestAnimationFrame((n) => this.frame(n));
    }
  }

  private picks(): Map<string, Pick> {
    const m = new Map<string, Pick>();
    m.set("current", { label: `${this.store.design.name} (current)`, design: this.store.design });
    for (const v of this.store.versions) m.set(v.id, { label: v.name, design: v.design });
    return m;
  }

  // --- setup (13.1) ---------------------------------------------------------------------------

  renderSetup(): void {
    const picks = this.picks();
    this.choice = this.choice.map((c) => (picks.has(c) ? c : ""));
    const lanes = this.choice
      .map((c, lane) => {
        const p = picks.get(c);
        const ev = p ? this.evaluate(p.design) : null;
        const ready = ev ? weakest(Object.values(inputProvenance(ev.spec, DEFAULT_ENVIRONMENT))) : null;
        const options = [`<option value="">— empty —</option>`, ...[...picks].map(([id, q]) => `<option value="${id}" ${id === c ? "selected" : ""}>${esc(q.label)}</option>`)];
        return `
          <div class="lane-pick">
            <span class="swatch" style="background:${LANE_COLOURS[lane]}"></span>
            <label>Lane ${lane + 1}<select data-lane="${lane}">${options.join("")}</select></label>
            ${
              ev
                ? `<div class="lane-state"><span class="compliance" data-state="${ev.compliance}"><b>${ev.compliance}</b></span>
                     <span class="prov">model readiness: weakest input <b>${ready}</b></span></div>`
                : p
                  ? `<div class="lane-state notice">The profiles leave no body; this car cannot race.</div>`
                  : ""
            }
          </div>`;
      })
      .join("");
    const versions = this.store.versions.length;
    this.els.setup.innerHTML = `
      <section>
        <h2>Race setup</h2>
        <div class="row"><span>Track</span><select id="race-length">
          ${([35, 42, 49] as const).map((n) => `<option value="${n}" ${n === this.length ? "selected" : ""}>BestTrack ${n} ft</option>`).join("")}
        </select></div>
        <p class="prov">Profile <b>ESTIMATED</b> from the manufacturer drawing. Every lane uses the same profile until lanes are
          calibrated, so the lane does not change a time.</p>
        <div class="row"><span>Ruleset</span><span>${esc(CCCS_KIT_CAR_2026.name)}</span></div>
        <div class="row"><span>Simulation fidelity</span><select id="race-fidelity">
          <option value="standard" ${this.fidelity === "standard" ? "selected" : ""}>Standard (0.5 ms step)</option>
          <option value="fine" ${this.fidelity === "fine" ? "selected" : ""}>Fine (0.1 ms step)</option>
        </select></div>
        ${lanes}
        <p class="hint">${
          versions === 0
            ? "Save versions of your design (Design mode, Save version) to race them against each other as ghosts."
            : "Each car races alone on its lane under identical conditions: same track, air, solver and step."
        }</p>
        <button id="race-go" class="primary" ${this.running ? "disabled" : ""}>${this.running ? "Racing…" : "Race"}</button>
      </section>`;
    for (const s of this.els.setup.querySelectorAll<HTMLSelectElement>("select[data-lane]"))
      s.onchange = () => {
        this.choice[Number(s.dataset.lane)] = s.value;
        this.renderSetup();
      };
    const len = this.els.setup.querySelector<HTMLSelectElement>("#race-length")!;
    len.onchange = () => {
      this.length = Number(len.value) as BestTrackLength;
      this.view.setTrack(bestTrack(this.length));
    };
    const fid = this.els.setup.querySelector<HTMLSelectElement>("#race-fidelity")!;
    fid.onchange = () => (this.fidelity = fid.value === "fine" ? "fine" : "standard");
    this.els.setup.querySelector<HTMLButtonElement>("#race-go")!.onclick = () => this.race();
  }

  private race(): void {
    const picks = this.picks();
    const cars: (LaneCar | null)[] = [];
    const entries: SessionRequest["entries"][number][] = [];
    for (let lane = 0; lane < MAX_LANES; lane++) {
      const p = picks.get(this.choice[lane]!);
      const ev = p ? this.evaluate(p.design) : null;
      cars.push(ev && p ? { design: p.design, body: ev.body } : null);
      entries.push(ev && p ? { label: p.label, spec: ev.spec } : null);
    }
    if (!entries.some((e) => e)) return;
    this.cars = cars;
    this.running = true;
    const req: SessionRequest = { kind: "session", seq: ++this.seq, entries, fidelity: this.fidelity, length: this.length };
    this.worker.postMessage(req);
    this.renderSetup();
  }

  // --- replay (13.2) --------------------------------------------------------------------------

  private wireBar(): void {
    const bar = this.els.bar;
    for (const b of bar.querySelectorAll<HTMLButtonElement>("[data-camera]"))
      b.onclick = () => {
        this.view.setCamera(b.dataset.camera as RaceCamera);
        for (const o of bar.querySelectorAll<HTMLButtonElement>("[data-camera]")) o.setAttribute("aria-pressed", String(o === b));
      };
    for (const b of bar.querySelectorAll<HTMLButtonElement>("[data-speed]"))
      b.onclick = () => {
        this.speed = Number(b.dataset.speed);
        for (const o of bar.querySelectorAll<HTMLButtonElement>("[data-speed]")) o.setAttribute("aria-pressed", String(o === b));
      };
    bar.querySelector<HTMLButtonElement>("#replay-pause")!.onclick = () => {
      this.paused = !this.paused;
      bar.querySelector<HTMLButtonElement>("#replay-pause")!.textContent = this.paused ? "Play" : "Pause";
    };
    bar.querySelector<HTMLButtonElement>("#replay-restart")!.onclick = () => this.restart();
  }

  private restart(): void {
    this.t = this.session ? -COUNTDOWN : 0;
    this.paused = false;
    this.els.bar.querySelector<HTMLButtonElement>("#replay-pause")!.textContent = "Pause";
  }

  private end(): number {
    const times = (this.session?.lanes ?? []).flatMap((l) => (l ? [l.trace.t[l.trace.t.length - 1]!] : []));
    return times.length ? Math.max(...times) + 0.6 : 0;
  }

  private frame(now: number): void {
    if (!this.active) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused && this.session) {
      // The countdown runs in real time; the race at the chosen replay speed.
      let wall = dt;
      if (this.t < 0) {
        const c = Math.min(-this.t, wall);
        this.t += c;
        wall -= c;
      }
      this.t = Math.min(this.t + wall * this.speed, this.end());
    }
    this.view.draw(this.t);
    this.renderOverlay();
    requestAnimationFrame((n) => this.frame(n));
  }

  private renderOverlay(): void {
    const s = this.session;
    const o = this.els.overlay;
    if (!s) {
      o.innerHTML = `<div class="race-idle">Choose cars for the lanes and press Race.</div>`;
      return;
    }
    const t = this.t;
    const count = t < 0 ? `<div class="countdown">${Math.ceil(-t)}</div>` : t < 0.6 ? `<div class="countdown go">GO</div>` : "";
    const lanes = s.lanes.filter((l): l is LaneResult => l !== null);
    const done = (l: LaneResult) => l.time !== null && t >= l.time;
    const allDone = lanes.every((l) => (l.time === null ? t >= l.trace.t[l.trace.t.length - 1]! : done(l)));
    const winner = Math.min(...lanes.map((l) => l.time ?? Infinity));
    const clock = allDone && Number.isFinite(winner) ? winner.toFixed(4) : Math.max(0, t).toFixed(3);
    const order = finishOrder(s.lanes).filter((x) => x.place !== null && done(s.lanes[x.lane]!));
    const strip = lanes
      .map((l) => {
        const p = poseAt(l.trace, t);
        const time = done(l) ? `${l.time!.toFixed(4)} s` : l.time === null && t >= l.trace.t[l.trace.t.length - 1]! ? l.status : `${Math.max(0, Math.min(t, l.time ?? t)).toFixed(3)} s`;
        return `<li><span class="swatch" style="background:${LANE_COLOURS[l.lane]}"></span><span class="lname">${l.lane + 1} · ${esc(l.label)}</span>
          <span class="lval">${time}</span><span class="lval muted">${p.speed.toFixed(2)} m/s</span></li>`;
      })
      .join("");
    o.innerHTML = `${count}
      <div class="clock" aria-live="off">${clock}<span class="unit">s</span></div>
      <ol class="lanes">${strip}</ol>
      ${order.length ? `<ol class="order">${order.map((x) => `<li><b>${x.place}</b> Lane ${x.lane + 1}</li>`).join("")}</ol>` : ""}
      <div class="replay-state">${t >= 0 ? `${this.speed}×${this.paused ? " · paused" : ""}` : ""}</div>`;
  }

  // --- results (13.3) -------------------------------------------------------------------------

  private renderResults(): void {
    const s = this.session;
    const el = this.els.results;
    if (!s) {
      el.innerHTML = "";
      return;
    }
    const metric = this.store.view.units === "metric";
    const v = (x: number | null) => (x === null ? "–" : metric ? `${x.toFixed(3)} m/s` : `${(x / 0.3048).toFixed(2)} ft/s`);
    const places = new Map(finishOrder(s.lanes).map((x) => [x.lane, x.place]));
    const lanes = s.lanes.filter((l): l is LaneResult => l !== null);
    const flags = (l: LaneResult): string => {
      const out: string[] = [];
      if (l.status !== "FINISHED") out.push(`<span class="bad">${l.status}</span> ${esc(l.message)}`);
      if (!l.frictionConsistent) out.push(`<span class="bad">friction inconsistent</span>`);
      out.push(`residual ≤ ${l.maxResidual.toExponential(1)} J`);
      if (l.hops) out.push(`${l.hops} wheel hops`);
      out.push(l.lateral ? "lateral model" : "planar model");
      out.push(`weakest input ${l.weakestInput}`);
      return out.join(" · ");
    };
    const pct = (l: LaneResult, x: number) => `${((100 * x) / l.ledger.released).toFixed(1)} %`;
    const rows: [string, (l: LaneResult) => number][] = [
      ["Kinetic energy at finish", (l) => l.ledger.kineticBody + l.ledger.kineticWheels + l.ledger.kineticLateral],
      ["Axle friction", (l) => l.ledger.axleLoss],
      ["Rolling resistance", (l) => l.ledger.rollingLoss],
      ["Air drag", (l) => l.ledger.aeroLoss],
      ["Thrust faces", (l) => l.ledger.thrustLoss],
      ["Tread scrub", (l) => l.ledger.treadLoss],
      ["Guide rail", (l) => l.ledger.railFrictionLoss + l.ledger.railImpactLoss],
      ["Hubs (axial play)", (l) => l.ledger.stopImpactLoss + l.ledger.boreSlideLoss],
    ];
    // The first two rows always; the rest only where some lane has that loss.
    const ledgerRows = rows
      .filter(([, f], i) => i < 2 || lanes.some((l) => Math.abs(f(l)) > 1e-9 * l.ledger.released))
      .map(([name, f]) => `<tr><th>${name}</th>${lanes.map((l) => `<td>${pct(l, f(l))}</td>`).join("")}</tr>`)
      .join("");
    el.innerHTML = `
      <section>
        <h2>Results</h2>
        <table class="results">
          <thead><tr><th>Place</th><th>Lane</th><th>Car</th><th>Elapsed</th><th>Finish speed</th><th>Max speed</th><th>Validity</th></tr></thead>
          <tbody>${lanes
            .map(
              (l) => `<tr><td>${places.get(l.lane) ?? "–"}</td><td><span class="swatch" style="background:${LANE_COLOURS[l.lane]}"></span>${l.lane + 1}</td>
                <td>${esc(l.label)}</td><td class="num">${l.time === null ? "–" : `${l.time.toFixed(4)} s`}</td>
                <td class="num">${v(l.finishSpeed)}</td><td class="num">${v(l.maxSpeed)}</td><td class="flags">${flags(l)}</td></tr>`,
            )
            .join("")}</tbody>
        </table>
        <p class="prov">${esc(s.track)}: profile <b>${s.profileStatus}</b>. Solver ${s.solverVersion}, step ${(s.dt * 1000).toFixed(1)} ms.
          Kit, friction and drag values are <b>ESTIMATED</b>: compare the cars with each other, not with real race times.</p>
        <div class="charts">
          <figure><figcaption>Speed against distance</figcaption><div class="chart" data-x="distance"></div></figure>
          <figure><figcaption>Speed against time</figcaption><div class="chart" data-x="t"></div></figure>
        </div>
        <h3>Energy ledger, share of energy released</h3>
        <table class="kv ledger"><thead><tr><th></th>${lanes.map((l) => `<th><span class="swatch" style="background:${LANE_COLOURS[l.lane]}"></span>Lane ${l.lane + 1}</th>`).join("")}</tr></thead>
          <tbody>${ledgerRows}
          <tr><th>Ledger residual</th>${lanes.map((l) => `<td>${l.ledger.residual.toExponential(1)} J</td>`).join("")}</tr></tbody></table>
      </section>`;
    for (const c of el.querySelectorAll<HTMLElement>(".chart")) lineChart(c, lanes, c.dataset.x as "distance" | "t", metric);
  }
}

/**
 * Speed against distance or time for every lane: one y axis, 2 px lines in the lane colours, a legend
 * and end labels, and a crosshair whose tooltip reads every lane at the pointer.
 */
function lineChart(host: HTMLElement, lanes: readonly LaneResult[], key: "distance" | "t", metric: boolean): void {
  const W = 520;
  const H = 230;
  const m = { l: 44, r: 92, t: 10, b: 30 };
  const ft = metric ? 1 : 1 / 0.3048;
  const xs = lanes.map((l) => l.trace[key]);
  const xMax = Math.max(...xs.map((a) => a[a.length - 1]!)) * (key === "distance" ? ft : 1);
  const yMax = Math.max(...lanes.map((l) => Math.max(...l.trace.speed))) * ft;
  const nice = (x: number) => {
    const p = 10 ** Math.floor(Math.log10(x));
    return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= x / 5)!;
  };
  const xStep = nice(xMax);
  const yStep = nice(yMax);
  const X = (x: number) => m.l + (x / (Math.ceil(xMax / xStep) * xStep)) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - (y / (Math.ceil(yMax / yStep) * yStep)) * (H - m.t - m.b);
  const grid: string[] = [];
  for (let y = 0; y <= Math.ceil(yMax / yStep) * yStep + 1e-9; y += yStep)
    grid.push(`<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}"/><text class="tick" x="${m.l - 6}" y="${Y(y) + 4}" text-anchor="end">${+y.toFixed(2)}</text>`);
  for (let x = 0; x <= Math.ceil(xMax / xStep) * xStep + 1e-9; x += xStep)
    grid.push(`<text class="tick" x="${X(x)}" y="${H - m.b + 16}" text-anchor="middle">${+x.toFixed(2)}</text>`);
  const lines = lanes.map((l) => {
    const a = l.trace[key];
    const k = key === "distance" ? ft : 1;
    const pts = Array.from(a, (x, i) => `${X(x * k).toFixed(1)},${Y(l.trace.speed[i]! * ft).toFixed(1)}`).join(" ");
    const n = a.length - 1;
    return { l, pts, end: [X(a[n]! * k), Y(l.trace.speed[n]! * ft)] as const };
  });
  // End labels, nudged apart so they never overlap.
  const ends = lines.map((q) => ({ q, y: q.end[1] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 13);
  const xUnit = key === "t" ? "s" : metric ? "m" : "ft";
  const yUnit = metric ? "m/s" : "ft/s";
  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speed against ${key === "t" ? "time" : "distance"} for each lane">
      ${grid.join("")}
      <line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>
      <text class="unit" x="${W - m.r}" y="${H - 2}" text-anchor="end">${key === "t" ? "time" : "distance from gate"}, ${xUnit}</text>
      <text class="unit" x="4" y="${m.t + 4}">${yUnit}</text>
      ${lines.map((q) => `<polyline class="series" style="stroke:${LANE_COLOURS[q.l.lane]}" points="${q.pts}"/>`).join("")}
      ${ends.map((e) => `<text class="end" x="${e.q.end[0] + 6}" y="${e.y + 4}">Lane ${e.q.l.lane + 1}</text>`).join("")}
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg>
    <div class="legend">${lanes.map((l) => `<span><span class="swatch" style="background:${LANE_COLOURS[l.lane]}"></span>Lane ${l.lane + 1} · ${esc(l.label)}</span>`).join("")}</div>
    <div class="tip" hidden></div>`;
  const svg = host.querySelector("svg")!;
  const cross = host.querySelector<SVGLineElement>(".cross")!;
  const tip = host.querySelector<HTMLElement>(".tip")!;
  const hit = host.querySelector<SVGRectElement>(".hit")!;
  hit.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const x = ((sx - m.l) / (W - m.l - m.r)) * Math.ceil(xMax / xStep) * xStep;
    cross.setAttribute("x1", String(sx));
    cross.setAttribute("x2", String(sx));
    cross.setAttribute("visibility", "visible");
    const k = key === "distance" ? ft : 1;
    const read = lanes.map((l) => {
      const a = l.trace[key];
      let i = 0;
      while (i < a.length - 1 && a[i + 1]! * k < x) i++;
      const j = Math.min(i + 1, a.length - 1);
      const u = a[j]! === a[i]! ? 0 : (x / k - a[i]!) / (a[j]! - a[i]!);
      const past = x / k > a[a.length - 1]!;
      const sp = past ? null : (l.trace.speed[i]! + Math.max(0, Math.min(1, u)) * (l.trace.speed[j]! - l.trace.speed[i]!)) * ft;
      return `<div><span class="swatch" style="background:${LANE_COLOURS[l.lane]}"></span>Lane ${l.lane + 1}: <b>${sp === null ? "finished" : `${sp.toFixed(2)} ${yUnit}`}</b></div>`;
    });
    tip.innerHTML = `<div class="tip-head">${x.toFixed(key === "t" ? 3 : 2)} ${xUnit}</div>${read.join("")}`;
    tip.hidden = false;
    const left = ((sx / W) * r.width) + 12;
    tip.style.left = `${Math.min(left, r.width - 170)}px`;
    tip.style.top = "8px";
  };
  hit.onpointerleave = () => {
    cross.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
}
