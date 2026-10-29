// Workspace state: the design with undo/redo (spec 12.3), named versions (DAT-003), display
// preferences, and local persistence (PLT-004: browser storage and user-initiated files only, no
// network).

import type { UnitSystem } from "../core/display.js";
import { type CarDesign, wedgeDesign } from "../geometry/design.js";

export type DisplayMode = "solid" | "xray" | "wireframe";
export type Selection = { kind: "ballast" | "feature"; id: string } | null;

export interface View {
  readonly units: UnitSystem;
  readonly display: DisplayMode;
  readonly show: { body: boolean; wheels: boolean; ballast: boolean; cg: boolean; datums: boolean; envelope: boolean };
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

  constructor() {
    const saved = load();
    this.design = saved?.design ?? wedgeDesign();
    this.versions = saved?.versions ?? [];
    this.committed = this.design;
    this.view = {
      units: saved?.units ?? "metric",
      display: "solid",
      show: { body: true, wheels: true, ballast: true, cg: true, datums: true, envelope: false },
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

  setView(patch: Partial<View>): void {
    this.view = { ...this.view, ...patch };
    if (patch.units) this.save();
    this.emit("view");
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ design: this.committed, units: this.view.units, versions: this.versions }));
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the session still works.
    }
  }
}

function load(): { design: CarDesign; units: UnitSystem; versions: SavedVersion[] } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as { design?: CarDesign; units?: UnitSystem; versions?: SavedVersion[] };
    if (x.design?.schema !== 1) return null;
    const versions = Array.isArray(x.versions) ? x.versions.filter((v) => v?.design?.schema === 1) : [];
    return { design: x.design, units: x.units === "english" ? "english" : "metric", versions };
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
  return d as CarDesign;
}
