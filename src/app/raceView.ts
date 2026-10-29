// 3D race view (spec 13.2): the cars on the track model, replayed from the solver's traces. World
// frame: x along the track's vertical plane, y across the lanes, z up, metres. The camera and the
// playback only change what is drawn, never a result.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { inches } from "../core/units.js";
import type { CarDesign } from "../geometry/design.js";
import type { BodySolid } from "../geometry/solid.js";
import { type Session, poseAt } from "../race/session.js";
import { type Track, TYPICAL_LANE_LATERAL, finishS } from "../track/track.js";
import { bodyMeshes, wheelSet } from "./carMesh.js";

export type RaceCamera = "track" | "chase" | "finish";

/** Lane colours, lane 1 first: categorical slots 1-4 for the dark surface (validated, see styles.css). */
export const LANE_COLOURS = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;

/**
 * Lane pitch, m. Display only: each lane is raced alone, so it has no effect on a result. BestTrack's
 * pitch is not yet sourced; 4 in is an estimate.
 */
const LANE_PITCH = inches(4);
const LANES = 4;
const BOARD = 0.019; // track board thickness, display only

export interface LaneCar {
  readonly design: CarDesign;
  readonly body: BodySolid;
}

interface CarObject {
  readonly root: THREE.Group;
  readonly wheels: readonly THREE.Group[];
}

export const laneY = (lane: number): number => (lane - (LANES - 1) / 2) * LANE_PITCH;

export class RaceView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
  private readonly controls: OrbitControls;
  private readonly trackGroup = new THREE.Group();
  private readonly carGroup = new THREE.Group();
  private cars: (CarObject | null)[] = [];
  private session: Session | null = null;
  private track: Track | null = null;
  private gate: THREE.Group | null = null;
  private mode: RaceCamera = "track";
  private chaseLane = 0;
  private readonly chasePos = new THREE.Vector3();
  private readonly chaseLook = new THREE.Vector3();
  private chaseFresh = true;

  constructor(private readonly el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1d2228);
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight(0xf2f4ff, 0x40362c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(2, -3, 6);
    this.scene.add(sun);
    this.scene.add(this.trackGroup, this.carGroup);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }

  private resize(): void {
    const w = this.el.clientWidth;
    const h = Math.max(this.el.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Build the track model: the lane profile swept across four lanes, guide rails, gate and finish. */
  setTrack(track: Track): void {
    this.track = track;
    const g = this.trackGroup;
    g.traverse((o) => (o as Partial<THREE.Mesh>).geometry?.dispose());
    g.clear();
    const surf = track.surface;
    const n = Math.ceil(surf.length / 0.01);
    const pts = Array.from({ length: n + 1 }, (_, i) => surf.at((i / n) * surf.length));
    const half = (LANES / 2) * LANE_PITCH + 0.01;

    // A section swept along the profile: corners given as (across y, along the normal), closed.
    const sweep = (corners: readonly [number, number][], colour: number, from = 0, to = n): THREE.Mesh => {
      const pos: number[] = [];
      const idx: number[] = [];
      const m = corners.length;
      for (let i = from; i <= to; i++) {
        const { p, n: nv } = pts[i]!;
        for (const [y, d] of corners) pos.push(p.x + d * nv.x, y, p.z + d * nv.z);
      }
      for (let i = 0; i < to - from; i++)
        for (let k = 0; k < m; k++) {
          const a = i * m + k;
          const b = i * m + ((k + 1) % m);
          idx.push(a, b, b + m, a, b + m, a + m);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const flat = geo.toNonIndexed();
      geo.dispose();
      flat.computeVertexNormals();
      return new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }));
    };
    g.add(sweep([[-half, 0], [half, 0], [half, -BOARD], [-half, -BOARD]], 0x8d939a));
    const rw = TYPICAL_LANE_LATERAL.guideRail.width.value / 2;
    const rh = TYPICAL_LANE_LATERAL.guideRail.height.value;
    for (let lane = 0; lane < LANES; lane++) {
      const y = laneY(lane);
      g.add(sweep([[y - rw, 0], [y + rw, 0], [y + rw, rh], [y - rw, rh]], 0xb7bcc2));
      // Lane colour at the start, so each car can be found.
      const iPin = Math.round((track.pinS / surf.length) * n);
      const tile = sweep([[y + rw + 0.004, 1e-4], [y + LANE_PITCH / 2 - 0.004, 1e-4], [y + LANE_PITCH / 2 - 0.004, 2e-4], [y + rw + 0.004, 2e-4]], 0xffffff, Math.max(0, iPin - 30), iPin - 2);
      (tile.material as THREE.MeshStandardMaterial).color.set(LANE_COLOURS[lane]!);
      g.add(tile);
    }

    // Finish line across the lanes: a checker strip on the surface.
    const fin = surf.at(finishS(track));
    const checks = 16;
    for (let i = 0; i < checks; i++)
      for (let j = 0; j < 2; j++) {
        const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.0125, (2 * half) / checks), new THREE.MeshBasicMaterial({ color: (i + j) % 2 ? 0x111111 : 0xf2f2f2 }));
        sq.position.set(fin.p.x + (j - 0.5) * 0.0125, -half + ((i + 0.5) * 2 * half) / checks, fin.p.z + 3e-4);
        g.add(sq);
      }
    // A finish gantry.
    const post = new THREE.MeshStandardMaterial({ color: 0x4a5561 });
    for (const y of [-half - 0.02, half + 0.02]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), post);
      m.position.set(fin.p.x, y, fin.p.z + 0.15);
      g.add(m);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2 * half + 0.06, 0.03), post);
    bar.position.set(fin.p.x, 0, fin.p.z + 0.3);
    g.add(bar);

    // The start gate: a bar across the lanes at the pin, which drops at release.
    const pin = surf.at(track.pinS);
    this.gate = new THREE.Group();
    this.gate.position.set(pin.p.x, 0, pin.p.z);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.004, 2 * half, 0.05), new THREE.MeshStandardMaterial({ color: 0xc23b2e }));
    plate.position.set(0, 0, 0.025);
    this.gate.add(plate);
    this.gate.rotation.y = -Math.atan2(pin.t.z, pin.t.x);
    g.add(this.gate);

    // Floor, and posts under the sloped section.
    const lo = Math.min(...pts.map((q) => q.p.z)) - BOARD;
    const xs = pts.map((q) => q.p.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 4, 3), new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.95 }));
    floor.position.set((x0 + x1) / 2, 0, lo - 0.002);
    g.add(floor);
    for (const s of [0.4, 1.2, 2.0]) {
      const q = surf.at(s);
      const height = q.p.z - BOARD - lo;
      if (height <= 0.05) continue;
      for (const y of [-half + 0.02, half - 0.02]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, height), post);
        leg.position.set(q.p.x, y, lo + height / 2);
        g.add(leg);
      }
    }
    this.setCamera(this.mode);
  }

  /** The cars of a session, each with its own body. */
  setCars(session: Session, cars: readonly (LaneCar | null)[]): void {
    this.session = session;
    const g = this.carGroup;
    g.traverse((o) => (o as Partial<THREE.Mesh>).geometry?.dispose());
    g.clear();
    this.cars = cars.map((c, lane) => {
      if (!c || !session.lanes[lane]) return null;
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: c.design.paint, roughness: 0.75, side: THREE.DoubleSide });
      for (const m of bodyMeshes(c.body, mat)) root.add(m);
      const ws = wheelSet(true);
      root.add(ws.group);
      g.add(root);
      return { root, wheels: ws.wheels };
    });
    this.chaseLane = Math.max(0, session.lanes.findIndex((l) => l !== null));
    this.chaseFresh = true;
  }

  setCamera(c: RaceCamera): void {
    this.mode = c;
    this.chaseFresh = true;
    if (!this.track) return;
    const surf = this.track.surface;
    const fin = surf.at(finishS(this.track));
    const top = surf.at(0);
    this.controls.enabled = c === "track";
    if (c === "track") {
      const mid = new THREE.Vector3((top.p.x + fin.p.x) / 2, 0, (top.p.z + fin.p.z) / 2);
      const span = fin.p.x - top.p.x;
      this.camera.position.set(mid.x, -span * 0.95, mid.z + span * 0.18);
      this.controls.target.copy(mid);
      this.camera.lookAt(mid);
      this.controls.update();
    } else if (c === "finish") {
      this.camera.position.set(fin.p.x + 0.1, -0.6, fin.p.z + 0.12);
      this.camera.lookAt(fin.p.x - 0.06, 0, fin.p.z + 0.02);
    }
  }

  /** Follow this lane's car with the chase camera. */
  chase(lane: number): void {
    this.chaseLane = lane;
  }

  /** Draw the race at replay time t, s from release (negative before). */
  draw(t: number): void {
    const s = this.session;
    if (s) {
      this.cars.forEach((c, lane) => {
        const l = s.lanes[lane];
        if (!c || !l) return;
        const p = poseAt(l.trace, t);
        c.root.position.set(p.x, laneY(lane), p.z);
        c.root.rotation.set(0, -p.theta, 0);
        c.wheels.forEach((w, k) => {
          w.rotation.y = p.distance / l.wheelRadius[k < 2 ? 0 : 1];
        });
      });
    }
    if (this.gate) {
      // The gate's plate swings down over the first tenth of a second after release.
      const drop = Math.min(1, Math.max(0, t / 0.1));
      this.gate.children[0]!.rotation.y = drop * 1.4;
    }
    // Only the full-track view orbits; the others place the camera themselves.
    if (this.mode === "chase") this.updateChase();
    else if (this.mode === "track") this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private updateChase(): void {
    const c = this.cars[this.chaseLane];
    if (!c) return;
    const r = c.root;
    const fwd = new THREE.Vector3(Math.cos(-r.rotation.y), 0, Math.sin(-r.rotation.y));
    const pos = r.position.clone().addScaledVector(fwd, -0.45).add(new THREE.Vector3(0, -0.12, 0.13));
    const look = r.position.clone().addScaledVector(fwd, 0.25).add(new THREE.Vector3(0, 0, 0.02));
    if (this.chaseFresh) {
      this.chasePos.copy(pos);
      this.chaseLook.copy(look);
      this.chaseFresh = false;
    } else {
      this.chasePos.lerp(pos, 0.2);
      this.chaseLook.lerp(look, 0.2);
    }
    this.camera.position.copy(this.chasePos);
    this.camera.lookAt(this.chaseLook);
  }
}
