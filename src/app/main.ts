// Design workspace entry point (M2). One evaluation pipeline drives every view:
//   design -> body solid (manifold-3d) -> mass, CG, extents -> inspection -> 3D, profiles, panels
// and, debounced, the solver in a worker.

import wasmUrl from "manifold-3d/manifold.wasm?url";
import { type CarDesign, uncutDesign, wedgeDesign } from "../geometry/design.js";
import { evaluateBody, loadManifold, seatBallast } from "../geometry/solid.js";
import { evaluateCar } from "../mass/carModel.js";
import { inspect } from "../rules/cccs.js";
import { Panels } from "./panels.js";
import { ProfileEditor } from "./profileEditor.js";
import type { RaceReply, RaceRequest } from "./race.worker.js";
import { type DisplayMode, Store, designFromFile, designToFile } from "./store.js";
import { type PresetView, Viewport } from "./viewport.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function start(): Promise<void> {
  const w = await loadManifold(wasmUrl);
  const store = new Store();
  const viewport = new Viewport($("viewport"), store);
  const side = new ProfileEditor($("side-editor"), store, "side");
  const top = new ProfileEditor($("top-editor"), store, "top");
  const panels = new Panels($("panels"), store, (b) => seatBallast(w, store.design, b));
  const worker = new Worker(new URL("./race.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<RaceReply>) => panels.renderRace(e.data);

  let raced = "";
  let raceTimer = 0;
  let frame = 0;
  const refresh = (): void => {
    frame = 0;
    const d = store.design;
    const body = evaluateBody(w, d);
    const status = $("status");
    if (body.empty) {
      status.textContent = "The profiles leave no body: the side and top outlines do not overlap the block.";
      status.hidden = false;
      return;
    }
    status.hidden = true;
    const ev = evaluateCar(d, body);
    const ins = inspect(ev);
    viewport.setModel(d, body, ev);
    side.render(d, ev);
    top.render(d, ev);
    panels.render(d, ev, ins);
    ($("undo") as HTMLButtonElement).disabled = !store.canUndo;
    ($("redo") as HTMLButtonElement).disabled = !store.canRedo;
    const name = $<HTMLInputElement>("design-name");
    if (document.activeElement !== name) name.value = d.name;
    const key = JSON.stringify(ev.spec);
    if (key !== raced) {
      raced = key;
      clearTimeout(raceTimer);
      raceTimer = window.setTimeout(() => {
        const req: RaceRequest = { seq: panels.raceStarted(), spec: ev.spec };
        worker.postMessage(req);
      }, 120);
    }
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  store.on(schedule);
  window.addEventListener("resize", schedule);

  // Toolbar.
  $("undo").onclick = () => store.undo();
  $("redo").onclick = () => store.redo();
  const units = $<HTMLSelectElement>("units");
  units.value = store.view.units;
  units.onchange = () => store.setView({ units: units.value === "english" ? "english" : "metric" });
  $<HTMLInputElement>("design-name").onchange = (e) => store.update({ ...store.design, name: (e.target as HTMLInputElement).value || "Untitled" });
  $<HTMLSelectElement>("new-design").onchange = (e) => {
    const s = e.target as HTMLSelectElement;
    if (s.value === "wedge") store.update(wedgeDesign());
    if (s.value === "uncut") store.update(uncutDesign());
    s.value = "";
  };
  $("save").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(designToFile(store.design));
    a.download = `${store.design.name.replace(/[^\w.-]+/g, "_") || "design"}.pdesign.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const open = $<HTMLInputElement>("open-file");
  $("open").onclick = () => open.click();
  open.onchange = async () => {
    const f = open.files?.[0];
    if (!f) return;
    try {
      store.update(designFromFile(await f.text()) as CarDesign);
    } catch (err) {
      alert((err as Error).message);
    }
    open.value = "";
  };

  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.onclick = () => viewport.setPreset(b.dataset.view as PresetView);
  $("fit").onclick = () => viewport.fit();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]"))
    b.onclick = () => {
      store.setView({ display: b.dataset.display as DisplayMode });
      for (const o of document.querySelectorAll<HTMLButtonElement>("[data-display]")) o.setAttribute("aria-pressed", String(o === b));
    };
  for (const c of document.querySelectorAll<HTMLInputElement>("[data-show]")) {
    const k = c.dataset.show as keyof Store["view"]["show"];
    c.checked = store.view.show[k];
    c.onchange = () => store.setView({ show: { ...store.view.show, [k]: c.checked } });
  }

  window.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      store.redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
      const sel = store.view.selection;
      if (sel?.kind === "ballast") {
        store.update({ ...store.design, ballast: store.design.ballast.filter((b) => b.id !== sel.id) });
        store.setView({ selection: null });
      }
    }
  });

  refresh();
  document.body.classList.add("ready");
}

start().catch((err: unknown) => {
  const s = document.getElementById("status");
  if (s) {
    s.textContent = `Could not start the workspace: ${(err as Error).message}. It needs a WebGL2 and WebAssembly capable browser.`;
    s.hidden = false;
  }
  console.error(err);
});
