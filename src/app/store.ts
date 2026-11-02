// Workspace state: the design with undo/redo (spec 12.3), named versions (DAT-003), display
// preferences, and local persistence (PLT-004: browser storage and user-initiated files only, no
// network).

import type { UnitSystem } from "../core/display.js";
import { type CarDesign, upgradeDesign, wedgeDesign } from "../geometry/design.js";
import { type BlockKit, type KitChoice, type WheelSet, catalogueKit, kitChoice } from "../kit/kit.js";
import type { Fidelity, TrackChoice } from "../race/session.js";
import type { Ruleset } from "../rules/cccs.js";
import type { RaceStatus } from "../physics/race.js";

export type DisplayMode = "solid" | "xray" | "wireframe";
export type Selection = { kind: "ballast" | "feature"; id: string } | null;

/**
 * Experience level (MODE-001): presentation only. It picks the panels, words and design modalities
 * shown and never enters the design, the physics or the compliance result.
 */
export type Level = "KID" | "BUILDER";

export interface View {
  readonly units: UnitSystem;
  readonly level: Level;
  /** KID level shows numbers only when asked (spec 16). */
  readonly kidNumbers: boolean;
  readonly display: DisplayMode;
  readonly show: { body: boolean; wheels: boolean; ballast: boolean; cg: boolean; datums: boolean; envelope: boolean; zones: boolean };
  readonly selection: Selection;
}

/** A saved snapshot of a design (DAT-003), for comparing and ghost-racing (13.1). */
export interface SavedVersion {
  readonly id: string;
  readonly name: string;
  /** ISO 8601. */
  readonly savedAt: string;
  readonly design: CarDesign;
}

/**
 * A saved race result (DAT-001, MODE-004): what was raced and what came out, with its compliance
 * context, fidelity, ruleset and track, solver version and seed. Never rewritten (DAT-002): a re-run
 * with a newer solver is a new result that names the one it repeats.
 */
export interface SavedRace {
  readonly id: string;
  readonly savedAt: string;
  readonly solverVersion: string;
  readonly fidelity: Fidelity;
  readonly dt: number;
  readonly track: TrackChoice;
  readonly trackName: string;
  readonly profileStatus: string;
  /** CERTIFIED only if every lane's design was. */
  readonly context: "CERTIFIED" | "SANDBOX";
  readonly ruleset: string;
  /** The solver is deterministic: no random seed. */
  readonly seed: null;
  readonly lanes: readonly ({
    readonly label: string;
    readonly design: CarDesign;
    readonly context: "CERTIFIED" | "SANDBOX";
    readonly compliance: string;
    readonly status: RaceStatus;
    readonly message: string;
    readonly time: number | null;
    readonly finishSpeed: number | null;
    readonly maxSpeed: number;
  } | null)[];
  /** The saved result this one re-ran. */
  readonly rerunOf?: string;
}

const KEY = "pinewood-dynamics.workspace.v1";

type Listener = (why: "design" | "view") => void;

export class Store {
  private past: CarDesign[] = [];
  private future: CarDesign[] = [];
  private listeners: Listener[] = [];
  /** The design as of the last committed edit; live drags change `design` without touching history. */
  private committed: CarDesign;
  design: CarDesign;
  view: View;
  versions: SavedVersion[];
  results: SavedRace[];
  /** Local rulesets entered for races (9.1 local overrides); the shipped rulesets are in the code. */
  rulesets: Ruleset[];
  /**
   * The player's own kit records (CHAR-001..003): blocks and wheel sets they measured or turned, by id.
   * Their next car on that kit starts from them.
   */
  kits: { blocks: BlockKit[]; wheels: WheelSet[] };

  /** True when nothing was saved before: the first launch, when the player is asked for their kit. */
  readonly firstRun: boolean;

  constructor() {
    const saved = load();
    this.firstRun = saved === null;
    this.design = saved?.design ?? wedgeDesign();
    this.versions = saved?.versions ?? [];
    this.results = saved?.results ?? [];
    this.rulesets = saved?.rulesets ?? [];
    this.kits = saved?.kits ?? { blocks: [], wheels: [] };
    this.committed = this.design;
    this.view = {
      units: saved?.units ?? "metric",
      level: saved?.level ?? "BUILDER",
      kidNumbers: false,
      display: "solid",
      show: { body: true, wheels: true, ballast: true, cg: true, datums: true, envelope: false, zones: false },
      selection: null,
    };
  }

  on(f: Listener): void {
    this.listeners.push(f);
  }

  private emit(why: "design" | "view"): void {
    for (const f of this.listeners) f(why);
  }

  /** Change the design. `commit: false` for intermediate drag states; commit once on release. */
  update(next: CarDesign, commit = true): void {
    this.design = next;
    if (commit) {
      if (next !== this.committed) {
        this.past.push(this.committed);
        if (this.past.length > 200) this.past.shift();
        this.future = [];
        this.committed = next;
        this.save();
      }
    }
    this.emit("design");
  }

  /**
   * Refuse the design shown now and go back to `valid`, the last one that passed (CERTIFIED context,
   * MODE-002). A refused committed edit leaves no trace in the history; a refused drag position just
   * holds the design where it last passed.
   */
  refuse(valid: CarDesign): void {
    if (this.committed !== valid) {
      if (this.past[this.past.length - 1] === valid) this.past.pop();
      this.committed = valid;
      this.save();
    }
    this.design = valid;
    this.emit("design");
  }

  /** Commit whatever the live design is now (end of a drag). Nothing happens if nothing changed. */
  commit(): void {
    if (this.design !== this.committed) this.update(this.design, true);
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.committed);
    this.committed = this.design = prev;
    this.save();
    this.emit("design");
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.committed);
    this.committed = this.design = next;
    this.save();
    this.emit("design");
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Save the committed design as a named version: its name with the next free V number. */
  saveVersion(): SavedVersion {
    const base = this.committed.name;
    let n = 1;
    while (this.versions.some((v) => v.name === `${base} V${n}`)) n++;
    const v: SavedVersion = { id: `v${Date.now().toString(36)}${n}`, name: `${base} V${n}`, savedAt: new Date().toISOString(), design: this.committed };
    this.versions = [...this.versions, v];
    this.save();
    this.emit("design");
    return v;
  }

  deleteVersion(id: string): void {
    this.versions = this.versions.filter((v) => v.id !== id);
    this.save();
    this.emit("design");
  }

  renameVersion(id: string, name: string): void {
    this.versions = this.versions.map((v) => (v.id === id ? { ...v, name } : v));
    this.save();
    this.emit("design");
  }

  /** Add a local ruleset, or replace the one with its id. */
  saveRuleset(r: Ruleset): void {
    this.rulesets = this.rulesets.some((x) => x.id === r.id) ? this.rulesets.map((x) => (x.id === r.id ? r : x)) : [...this.rulesets, r];
    this.save();
  }

  /** A block and wheels as the player has them: their own record where there is one, else the library's. */
  kitFor(block: BlockKit, wheels: WheelSet = block.wheels): KitChoice {
    return kitChoice(this.kits.blocks.find((b) => b.id === block.id) ?? block, this.kits.wheels.find((w) => w.id === wheels.id) ?? wheels);
  }

  /** Keep the player's record of this kit, or forget it where it is back to the library's values. */
  rememberKit(k: KitChoice): void {
    const lib = catalogueKit(k);
    const keep = <T extends { id: string }>(all: T[], x: T, same: boolean): T[] => [...all.filter((y) => y.id !== x.id), ...(same ? [] : [x])];
    this.kits = {
      blocks: keep(this.kits.blocks, k.block, JSON.stringify(k.block) === JSON.stringify(lib.block)),
      wheels: keep(this.kits.wheels, k.wheels, JSON.stringify(k.wheels) === JSON.stringify(lib.wheels)),
    };
    this.save();
  }

  deleteRuleset(id: string): void {
    this.rulesets = this.rulesets.filter((r) => r.id !== id);
    this.save();
    this.emit("design");
  }

  saveResult(r: Omit<SavedRace, "id" | "savedAt">): SavedRace {
    const saved: SavedRace = { ...r, id: `r${Date.now().toString(36)}${this.results.length}`, savedAt: new Date().toISOString() };
    this.results = [...this.results, saved];
    this.save();
    this.emit("view");
    return saved;
  }

  deleteResult(id: string): void {
    this.results = this.results.filter((r) => r.id !== id);
    this.save();
    this.emit("view");
  }

  setView(patch: Partial<View>): void {
    this.view = { ...this.view, ...patch };
    if (patch.units || patch.level) this.save();
    this.emit("view");
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ design: this.committed, units: this.view.units, level: this.view.level, versions: this.versions, results: this.results, rulesets: this.rulesets, kits: this.kits }));
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the session still works.
    }
  }
}

function load(): {
  design: CarDesign;
  units: UnitSystem;
  level: Level;
  versions: SavedVersion[];
  results: SavedRace[];
  rulesets: Ruleset[];
  kits: { blocks: BlockKit[]; wheels: WheelSet[] };
} | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as {
      design?: CarDesign;
      units?: UnitSystem;
      level?: Level;
      versions?: SavedVersion[];
      results?: SavedRace[];
      rulesets?: Ruleset[];
      kits?: { blocks?: BlockKit[]; wheels?: WheelSet[] };
    };
    if (x.design?.schema !== 1) return null;
    // Designs saved before kits were chosen keep their place on the wood (upgradeDesign).
    const versions = Array.isArray(x.versions) ? x.versions.filter((v) => v?.design?.schema === 1).map((v) => ({ ...v, design: upgradeDesign(v.design) })) : [];
    const results = Array.isArray(x.results)
      ? x.results
          .filter((r) => typeof r?.solverVersion === "string" && Array.isArray(r.lanes))
          .map((r) => ({ ...r, lanes: r.lanes.map((l) => (l ? { ...l, design: upgradeDesign(l.design) } : l)) }))
      : [];
    const rulesets = Array.isArray(x.rulesets) ? x.rulesets.filter((r) => Array.isArray(r?.limits) && r.event) : [];
    const own = <T extends { id: string; length?: unknown; diameter?: unknown }>(a: T[] | undefined, key: "length" | "diameter"): T[] =>
      Array.isArray(a) ? a.filter((y) => typeof y?.id === "string" && y[key]) : [];
    const kits = { blocks: own(x.kits?.blocks, "length"), wheels: own(x.kits?.wheels, "diameter") };
    return { design: upgradeDesign(x.design), units: x.units === "english" ? "english" : "metric", level: x.level === "KID" ? "KID" : "BUILDER", versions, results, rulesets, kits };
  } catch {
    return null;
  }
}

/** Project file (spec 15): the design as JSON, saved and opened by the user. */
export function designToFile(d: CarDesign): Blob {
  return new Blob([JSON.stringify({ format: "pinewood-dynamics-design", ...d }, null, 2)], { type: "application/json" });
}

export function designFromFile(text: string): CarDesign {
  const x = JSON.parse(text) as Partial<CarDesign> & { format?: string };
  if (x.format !== "pinewood-dynamics-design" || x.schema !== 1) throw new Error("Not a Pinewood Dynamics design file (schema 1).");
  const { format: _f, ...d } = x;
  return upgradeDesign(d as CarDesign);
}
