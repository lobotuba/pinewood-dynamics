// Race mode (spec 13): setup, the replay with its countdown, clock and finish order, and the results.
// Race setup 13.1, presentation 13.2, results 13.3.

import { weakest } from "../core/provenance.js";
import { DEFAULT_ENVIRONMENT } from "../kit/kit.js";
import type { CarSpec } from "../physics/car.js";
import { inputProvenance } from "../physics/car.js";
import { SOLVER_VERSION } from "../physics/race.js";
import { type Fidelity, type LaneResult, MAX_LANES, type Session, type TrackChoice, buildTrack, finishOrder, poseAt } from "../race/session.js";
import type { ComplianceState } from "../rules/cccs.js";
import { CCCS_KIT_CAR_2026 } from "../rules/cccs.js";
import type { CarDesign } from "../geometry/design.js";
import type { BodySolid } from "../geometry/solid.js";
import type { SessionReply, SessionRequest } from "./race.worker.js";
import { LANE_COLOURS, type LaneCar, type RaceCamera, RaceView } from "./raceView.js";
import type { SavedRace, Store } from "./store.js";

/** What race mode needs from the design pipeline for one car. */
export interface EvaluatedCar {
  readonly spec: CarSpec;
  readonly body: BodySolid;
  readonly compliance: ComplianceState;
}

const COUNTDOWN = 3;

const TRACKS: readonly { readonly key: string; readonly label: string; readonly choice: TrackChoice }[] = [
  { key: "bt35", label: "BestTrack 35 ft", choice: { kind: "besttrack", length: 35 } },
  { key: "bt42", label: "BestTrack 42 ft", choice: { kind: "besttrack", length: 42 } },
  { key: "bt49", label: "BestTrack 49 ft", choice: { kind: "besttrack", length: 49 } },
  { key: "ramp", label: "Idealized test ramp", choice: { kind: "ramp" } },
];

/** What a session raced, kept to save it as a result. */
interface Run {
  readonly lanes: readonly ({ readonly label: string; readonly design: CarDesign; readonly compliance: string } | null)[];
  readonly track: TrackChoice;
  readonly fidelity: Fidelity;
  readonly rerunOf?: SavedRace;
}
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Pick {
  readonly label: string;
  readonly design: CarDesign;
}

export class RacePanel {
  private readonly view: RaceView;
  private choice: string[] = ["current", "", "", ""];
  private trackKey = "bt35";
  /** A survey loaded this session (CHAR-005): its name, CSV, and profile status once fitted. */
  private survey: { name: string; csv: string; status: string } | null = null;
  private trackError = "";
  private fidelity: Fidelity = "standard";
  private run: Run | null = null;
  private savedThis = false;
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
    this.view.setTrack(buildTrack(this.trackChoice()));
    this.wireBar();
    this.renderResults();
  }

  /** Called with the worker's session reply. */
  onSession(r: SessionReply): void {
    if (r.seq !== this.seq) return;
    this.running = false;
    this.session = r.session;
    this.savedThis = false;
    this.view.setCars(r.session, this.cars);
    const follow = this.els.bar.querySelector<HTMLSelectElement>("#chase-lane")!;
    follow.innerHTML = r.session.lanes
      .flatMap((l) => (l ? [`<option value="${l.lane}">Follow lane ${l.lane + 1}</option>`] : []))
      .join("");
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

  private trackChoice(): TrackChoice {
    if (this.trackKey === "survey" && this.survey) return { kind: "survey", csv: this.survey.csv };
    return (TRACKS.find((t) => t.key === this.trackKey) ?? TRACKS[0]!).choice;
  }

  private setTrack(key: string): void {
    this.trackKey = key;
    this.trackError = "";
    try {
      this.view.setTrack(buildTrack(this.trackChoice()));
    } catch (err) {
      this.trackError = (err as Error).message;
      this.trackKey = "bt35";
      this.view.setTrack(buildTrack(this.trackChoice()));
    }
    this.renderSetup();
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
        <div class="row"><span>Track</span><select id="race-track">
          ${TRACKS.map((t) => `<option value="${t.key}" ${t.key === this.trackKey ? "selected" : ""}>${t.label}</option>`).join("")}
          ${this.survey ? `<option value="survey" ${this.trackKey === "survey" ? "selected" : ""}>Survey: ${esc(this.survey.name)}</option>` : ""}
        </select></div>
        <div class="row"><span></span><button id="race-survey" class="icon-btn" title="A CSV of x, z stations along the lane (docs/track-survey.md)">Load survey…</button>
          <input id="race-survey-file" type="file" accept=".csv,text/csv" hidden /></div>
        ${this.trackError ? `<p class="notice">Survey not loaded: ${esc(this.trackError)}</p>` : ""}
        <p class="prov">${this.trackNote()} Every lane uses the same profile until lanes are calibrated, so the lane does not
          change a time.</p>
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
      </section>
      ${this.renderVersions()}
      ${this.renderSaved()}`;
    for (const s of this.els.setup.querySelectorAll<HTMLSelectElement>("select[data-lane]"))
      s.onchange = () => {
        this.choice[Number(s.dataset.lane)] = s.value;
        this.renderSetup();
      };
    const tr = this.els.setup.querySelector<HTMLSelectElement>("#race-track")!;
    tr.onchange = () => this.setTrack(tr.value);
    const file = this.els.setup.querySelector<HTMLInputElement>("#race-survey-file")!;
    this.els.setup.querySelector<HTMLButtonElement>("#race-survey")!.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      const csv = await f.text();
      try {
        const t = buildTrack({ kind: "survey", csv });
        this.survey = { name: t.name, csv, status: t.profileStatus };
        this.setTrack("survey");
      } catch (err) {
        this.trackError = (err as Error).message;
        this.renderSetup();
      }
    };
    for (const i of this.els.setup.querySelectorAll<HTMLInputElement>("input[data-rename]"))
      i.onchange = () => this.store.renameVersion(i.dataset.rename!, i.value.trim() || "Untitled");
    for (const b of this.els.setup.querySelectorAll<HTMLButtonElement>("button[data-delete-version]"))
      b.onclick = () => this.store.deleteVersion(b.dataset.deleteVersion!);
    for (const b of this.els.setup.querySelectorAll<HTMLButtonElement>("button[data-rerun]"))
      b.onclick = () => this.rerun(this.store.results.find((r) => r.id === b.dataset.rerun)!);
    for (const b of this.els.setup.querySelectorAll<HTMLButtonElement>("button[data-delete-result]"))
      b.onclick = () => this.store.deleteResult(b.dataset.deleteResult!);
    const fid = this.els.setup.querySelector<HTMLSelectElement>("#race-fidelity")!;
    fid.onchange = () => (this.fidelity = fid.value === "fine" ? "fine" : "standard");
    this.els.setup.querySelector<HTMLButtonElement>("#race-go")!.onclick = () => this.race();
  }

  private trackNote(): string {
    if (this.trackKey === "ramp") return "Profile <b>IDEALIZED</b>: an exact verification ramp, not a real track.";
    if (this.trackKey === "survey" && this.survey)
      return `Profile <b>${this.survey.status}</b> from the survey, fitted with a smoothing spline (docs/track-survey.md).`;
    return "Profile <b>ESTIMATED</b> from the manufacturer drawing.";
  }

  private renderVersions(): string {
    const vs = this.store.versions;
    if (!vs.length) return "";
    return `<section><h2>Saved versions</h2><ul class="versions">${vs
      .map(
        (v) => `<li><input data-rename="${v.id}" value="${esc(v.name)}" aria-label="Version name" />
          <span class="prov">${v.savedAt.slice(0, 16).replace("T", " ")}</span>
          <button class="icon-btn" data-delete-version="${v.id}" title="Delete this version">×</button></li>`,
      )
      .join("")}</ul></section>`;
  }

  private renderSaved(): string {
    const rs = this.store.results;
    if (!rs.length) return "";
    return `<section><h2>Saved results</h2><ul class="saved">${[...rs]
      .reverse()
      .map((r) => {
        const old = r.solverVersion !== SOLVER_VERSION;
        const times = r.lanes.flatMap((l, i) => (l ? [`${i + 1}: ${esc(l.label)} ${l.time === null ? l.status : `${l.time.toFixed(4)} s`}`] : []));
        return `<li><div><b>${r.savedAt.slice(0, 16).replace("T", " ")}</b> · ${esc(r.trackName)} · ${r.fidelity}
            ${r.rerunOf ? " · re-run" : ""} <span class="tag ${old ? "" : "same"}">${esc(r.solverVersion)}${old ? ", older solver" : ""}</span></div>
          <div class="prov">${times.join("<br>")}</div>
          <div class="row"><button data-rerun="${r.id}">${old ? `Re-run with ${SOLVER_VERSION}` : "Race again"}</button>
            <button class="icon-btn" data-delete-result="${r.id}" title="Delete this saved result">×</button></div></li>`;
      })
      .join("")}</ul>
      <p class="hint">A saved result is never changed. Racing it again makes a new result, compared lane by lane.</p></section>`;
  }

  private race(): void {
    const picks = this.picks();
    const lanes: Run["lanes"][number][] = [];
    for (let lane = 0; lane < MAX_LANES; lane++) {
      const p = picks.get(this.choice[lane]!);
      lanes.push(p ? { label: p.label, design: p.design, compliance: "" } : null);
    }
    this.start({ lanes, track: this.trackChoice(), fidelity: this.fidelity });
  }

  /** Race a saved result's cars again, on its track and fidelity, with today's solver (DAT-002). */
  private rerun(r: SavedRace): void {
    this.start({ lanes: r.lanes.map((l) => (l ? { label: l.label, design: l.design, compliance: "" } : null)), track: r.track, fidelity: r.fidelity, rerunOf: r });
    try {
      this.view.setTrack(buildTrack(r.track));
    } catch {
      // A saved survey that no longer parses still races as saved; the view keeps its track.
    }
  }

  private start(run: Run): void {
    const cars: (LaneCar | null)[] = [];
    const entries: SessionRequest["entries"][number][] = [];
    const lanes = run.lanes.map((l) => {
      const ev = l ? this.evaluate(l.design) : null;
      cars.push(ev && l ? { design: l.design, body: ev.body } : null);
      entries.push(ev && l ? { label: l.label, spec: ev.spec } : null);
      return ev && l ? { ...l, compliance: ev.compliance } : null;
    });
    if (!entries.some((e) => e)) return;
    this.cars = cars;
    this.run = { ...run, lanes };
    this.running = true;
    const req: SessionRequest = { kind: "session", seq: ++this.seq, entries, fidelity: run.fidelity, track: run.track };
    this.worker.postMessage(req);
    this.renderSetup();
  }

  private saveResult(): void {
    const s = this.session;
    const run = this.run;
    if (!s || !run || this.savedThis) return;
    this.store.saveResult({
      solverVersion: s.solverVersion,
      fidelity: s.fidelity,
      dt: s.dt,
      track: run.track,
      trackName: s.track,
      profileStatus: s.profileStatus,
      context: "SANDBOX",
      ruleset: CCCS_KIT_CAR_2026.name,
      seed: null,
      lanes: s.lanes.map((l, i) => {
        const r = run.lanes[i];
        return l && r
          ? { label: r.label, design: r.design, compliance: r.compliance, status: l.status, message: l.message, time: l.time, finishSpeed: l.finishSpeed, maxSpeed: l.maxSpeed }
          : null;
      }),
      ...(run.rerunOf ? { rerunOf: run.rerunOf.id } : {}),
    });
    this.savedThis = true;
    this.renderSetup();
    this.renderResults();
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
    const follow = bar.querySelector<HTMLSelectElement>("#chase-lane")!;
    follow.onchange = () => this.view.chase(Number(follow.value));
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
      if (l.clearance) {
        const rail = Number.isFinite(l.clearance.rail) ? `the rail by ≥ ${(1000 * l.clearance.rail).toFixed(1)} mm, ` : "";
        out.push(`underside clears ${rail}the lane by ≥ ${(1000 * l.clearance.lane).toFixed(1)} mm`);
      }
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
    const prev = this.run?.rerunOf;
    const compare = prev
      ? `<p class="notice">Re-run of the result saved ${prev.savedAt.slice(0, 16).replace("T", " ")} with solver ${esc(prev.solverVersion)}; this run used ${esc(s.solverVersion)}.
          ${lanes
            .map((l) => {
              const was = prev.lanes[l.lane];
              if (!was || was.time === null || l.time === null) return `Lane ${l.lane + 1}: ${was?.status ?? "–"} then ${l.status}.`;
              const d = l.time - was.time;
              return `Lane ${l.lane + 1}: ${d === 0 ? "identical" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(4)} s`}.`;
            })
            .join(" ")}</p>`
      : "";
    el.innerHTML = `
      <section>
        <div class="row"><h2>Results</h2><button id="race-save" ${this.savedThis ? "disabled" : ""}>${this.savedThis ? "Saved" : "Save result"}</button></div>
        ${compare}
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
    el.querySelector<HTMLButtonElement>("#race-save")!.onclick = () => this.saveResult();
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
