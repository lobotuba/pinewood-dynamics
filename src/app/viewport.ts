// 3D viewport (spec 12.1, 12.2; UI-001/002). Works in the car frame (+X forward, +Y left, +Z up,
// metres). Perspective orbit by default; one-click axis views use an orthographic camera.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { inches } from "../core/units.js";
import type { Ballast, CarDesign, Feature, V3 } from "../geometry/design.js";
import type { BodySolid } from "../geometry/solid.js";
import { wheelCentres } from "../geometry/solid.js";
import { TYPICAL_KIT_ESTIMATE as K } from "../kit/kit.js";
import type { CarEvaluation } from "../mass/carModel.js";
import { CCCS_KIT_CAR_2026 } from "../rules/cccs.js";
import type { Store } from "./store.js";

export type PresetView = "perspective" | "top" | "bottom" | "front" | "rear" | "left" | "right";

const METAL_COLOURS: Record<string, number> = {
  tungsten: 0x6f7378,
  lead: 0x55585e,
  steel: 0xa9aeb5,
  brass: 0xc9a227,
  zinc: 0x9fa7ad,
  tin: 0xc2c6c9,
  copper: 0xb8683a,
  aluminium: 0xd5d8db,
};

const AXIS_VIEWS: Record<Exclude<PresetView, "perspective">, { dir: V3; up: V3 }> = {
  top: { dir: [0, 0, 1], up: [0, 1, 0] },
  bottom: { dir: [0, 0, -1], up: [0, -1, 0] },
  front: { dir: [1, 0, 0], up: [0, 0, 1] },
  rear: { dir: [-1, 0, 0], up: [0, 0, 1] },
  left: { dir: [0, 1, 0], up: [0, 0, 1] },
  right: { dir: [0, -1, 0], up: [0, 0, 1] },
};

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly persp: THREE.PerspectiveCamera;
  private readonly ortho: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private readonly groups = {
    body: new THREE.Group(),
    wheels: new THREE.Group(),
    ballast: new THREE.Group(),
    cg: new THREE.Group(),
    datums: new THREE.Group(),
    envelope: new THREE.Group(),
    /** The selected hole or cut, drawn as a ghost so it can be found even where it removes nothing. */
    selection: new THREE.Group(),
  };
  private readonly target = new THREE.Vector3(inches(2.2), 0, 0);
  private bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc8a46e, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  private dragging: { id: string; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly el: HTMLElement,
    private readonly store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1d2228);

    this.persp = new THREE.PerspectiveCamera(32, 1, 0.002, 20);
    this.persp.up.set(0, 0, 1);
    this.persp.position.set(0.25, 0.32, 0.2);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera = this.persp;
    this.controls = this.makeControls();

    this.scene.add(new THREE.HemisphereLight(0xf2f4ff, 0x40362c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, 0.6, 1);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-0.6, -0.3, 0.2);
    this.scene.add(fill);

    // Wheel contact plane: the track surface under the car.
    const grid = new THREE.GridHelper(0.6, 24, 0x4a5561, 0x323a43);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(inches(2.2), 0, -K.wheelRadius.value - 1e-5);
    this.scene.add(grid);

    for (const g of Object.values(this.groups)) this.scene.add(g);
    this.buildStatic();

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.installDrag();
    const loop = (): void => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private makeControls(): OrbitControls {
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.target.copy(this.target);
    c.update();
    return c;
  }

  private resize(): void {
    const w = this.el.clientWidth;
    const h = Math.max(this.el.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const half = 0.1;
    const a = w / h;
    Object.assign(this.ortho, a >= 1 ? { left: -half * a, right: half * a, top: half, bottom: -half } : { left: -half, right: half, top: half / a, bottom: -half / a });
    this.ortho.updateProjectionMatrix();
  }

  /** One-click views (12.1); Bottom is mandatory for underside inspection. */
  setPreset(v: PresetView): void {
    this.controls.dispose();
    if (v === "perspective") {
      this.camera = this.persp;
      this.persp.up.set(0, 0, 1);
      this.persp.position.set(this.target.x + 0.25, 0.32, 0.2);
    } else {
      const { dir, up } = AXIS_VIEWS[v];
      this.camera = this.ortho;
      this.ortho.up.set(...up);
      this.ortho.position.set(this.target.x + dir[0], dir[1], dir[2]);
      this.ortho.zoom = 1;
      this.ortho.updateProjectionMatrix();
    }
    this.camera.lookAt(this.target);
    this.controls = this.makeControls();
  }

  /** Fit: recentre on the car. */
  fit(): void {
    this.controls.target.copy(this.target);
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
  }

  private buildStatic(): void {
    const r = K.wheelRadius.value;
    const ww = K.wheelWidth.value;
    const wheelGeo = new THREE.CylinderGeometry(r, r, ww, 64, 1);
    const hubGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.42, ww * 1.02, 32, 1);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.55 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5 });
    const axleMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.8, roughness: 0.3 });
    const outer = K.blockWidth.value / 2 + K.wheelBodyGap.value + ww;
    for (const c of wheelCentres()) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(...c);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.set(...c);
      const s = Math.sign(c[1]);
      const L = K.axleShaftLength.value;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(K.axleRadius.value, K.axleRadius.value, L, 16), axleMat);
      shaft.position.set(c[0], s * (outer - L / 2), 0);
      const th = K.axleHeadThickness.value;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(K.axleHeadDiameter.value / 2, K.axleHeadDiameter.value / 2, th, 24), axleMat);
      head.position.set(c[0], s * (outer + th / 2), 0);
      this.groups.wheels.add(wheel, hub, shaft, head);
    }

    // Datums (12.2): axle axes and the wheelbase dimension on the contact plane.
    const datum = new THREE.LineDashedMaterial({ color: 0x5fb3ff, dashSize: 0.004, gapSize: 0.003 });
    const xf = K.frontAxleFromRear.value - K.rearAxleFromRear.value;
    const span = outer + 0.012;
    for (const x of [0, xf]) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -span, 0), new THREE.Vector3(x, span, 0)]);
      const l = new THREE.Line(g, datum);
      l.computeLineDistances();
      this.groups.datums.add(l);
    }
    const z0 = -r + 1e-4;
    const yd = -span;
    const dim = new THREE.LineBasicMaterial({ color: 0x5fb3ff });
    const pts = [
      [0, yd - 0.004, z0],
      [0, yd + 0.004, z0],
      [0, yd, z0],
      [xf, yd, z0],
      [xf, yd - 0.004, z0],
      [xf, yd + 0.004, z0],
    ].map((p) => new THREE.Vector3(...(p as [number, number, number])));
    this.groups.datums.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dim));

    this.groups.cg.add(
      new THREE.Mesh(new THREE.SphereGeometry(0.0032, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffcc33, depthTest: false })),
    );
    const drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineDashedMaterial({ color: 0xffcc33, dashSize: 0.003, gapSize: 0.002, depthTest: false }),
    );
    drop.name = "cg-drop";
    this.groups.cg.add(drop);
    this.groups.cg.renderOrder = 10;
    for (const ch of this.groups.cg.children) ch.renderOrder = 10;
  }

  /** Rebuild the parts that depend on the design. */
  setModel(design: CarDesign, body: BodySolid, ev: CarEvaluation): void {
    const g = this.groups.body;
    for (const ch of g.children) (ch as THREE.Mesh).geometry.dispose();
    g.clear();
    if (!body.empty) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(body.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(body.indices, 1));
      const flat = geo.toNonIndexed();
      geo.dispose();
      flat.computeVertexNormals();
      this.bodyMaterial.color.set(design.paint);
      g.add(new THREE.Mesh(flat, this.bodyMaterial));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(flat, 25), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
      g.add(edges);
    }

    const bg = this.groups.ballast;
    for (const ch of bg.children) (ch as THREE.Mesh).geometry.dispose();
    bg.clear();
    for (const b of design.ballast) bg.add(this.ballastMesh(b));

    const sg = this.groups.selection;
    // Arrow helpers are groups: dispose whatever geometry sits anywhere below.
    sg.traverse((o) => (o as Partial<THREE.Mesh>).geometry?.dispose());
    sg.clear();
    const sel = this.store.view.selection;
    const f = sel?.kind === "feature" ? design.features.find((x) => x.id === sel.id) : undefined;
    if (f) for (const m of this.featureGhost(f)) sg.add(m);

    // CG marker with a drop line to the contact plane.
    const [cx, cy, cz] = ev.total.centroid;
    this.groups.cg.position.set(cx, cy, cz);
    const drop = this.groups.cg.getObjectByName("cg-drop") as THREE.Line;
    drop.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -K.wheelRadius.value - cz)]);
    drop.computeLineDistances();

    // Rules envelope (12.2): the length x width x height box, from the car's rear and the contact plane.
    const eg = this.groups.envelope;
    for (const ch of eg.children) (ch as THREE.LineSegments).geometry.dispose();
    eg.clear();
    const lim = (id: string): number => CCCS_KIT_CAR_2026.limits.find((l) => l.id === id)!.si;
    const box = new THREE.BoxGeometry(lim("RUL-001"), lim("RUL-002"), lim("RUL-003"));
    const env = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xff7a59 }));
    box.dispose();
    env.position.set(ev.extents.min[0] + lim("RUL-001") / 2, 0, -K.wheelRadius.value + lim("RUL-003") / 2);
    eg.add(env);
    const clear = new THREE.PlaneGeometry(lim("RUL-001"), K.blockWidth.value);
    const sheet = new THREE.Mesh(clear, new THREE.MeshBasicMaterial({ color: 0xff7a59, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    sheet.position.set(ev.extents.min[0] + lim("RUL-001") / 2, 0, -K.wheelRadius.value + lim("RUL-004"));
    eg.add(sheet);

    this.applyView();
  }

  private ballastMesh(b: Ballast): THREE.Mesh {
    const sel = this.store.view.selection;
    const selected = sel?.kind === "ballast" && sel.id === b.id;
    const mat = new THREE.MeshStandardMaterial({
      color: METAL_COLOURS[b.material] ?? 0x888888,
      metalness: 0.85,
      roughness: 0.35,
      emissive: selected ? 0x1f5fa8 : 0x000000,
      emissiveIntensity: selected ? 0.8 : 0,
    });
    let geo: THREE.BufferGeometry;
    if (b.shape.kind === "cylinder") {
      const r = b.shape.diameter / 2;
      geo = new THREE.CylinderGeometry(r, r, b.shape.length, 48);
      // Three's cylinder runs along its Y; turn it onto the design axis.
      if (b.shape.axis === "x") geo.rotateZ(Math.PI / 2);
      if (b.shape.axis === "z") geo.rotateX(Math.PI / 2);
    } else geo = new THREE.BoxGeometry(...b.shape.size);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...b.center);
    m.userData.ballastId = b.id;
    // Cavity weights show through the body in solid mode.
    m.renderOrder = b.mounting === "cavity" ? 2 : 0;
    return m;
  }

  private featureGhost(f: Feature): THREE.Object3D[] {
    const mat = new THREE.MeshBasicMaterial({ color: 0x5fb3ff, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const line = new THREE.LineBasicMaterial({ color: 0x5fb3ff, depthTest: false });
    const out: THREE.Object3D[] = [];
    if (f.kind === "cut") {
      for (const p of f.planes) {
        const n = new THREE.Vector3(...p.normal).normalize();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), mat);
        quad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        quad.position.set(...p.point);
        out.push(quad);
        // An arrow toward the side the cut removes.
        out.push(new THREE.ArrowHelper(n, new THREE.Vector3(...p.point), 0.012, 0x5fb3ff, 0.004, 0.003));
      }
    } else {
      let geo: THREE.BufferGeometry;
      if (f.kind === "bore") {
        geo = new THREE.CylinderGeometry(f.diameter / 2, f.diameter / 2, f.depth, 48);
        if (f.axis === "x") geo.rotateZ(Math.PI / 2);
        if (f.axis === "z") geo.rotateX(Math.PI / 2);
      } else geo = new THREE.BoxGeometry(...f.size);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...f.center);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), line);
      e.position.set(...f.center);
      out.push(m, e);
    }
    for (const o of out) o.renderOrder = 20;
    return out;
  }

  /** Display modes and group visibility (12.2). */
  applyView(): void {
    const v = this.store.view;
    this.groups.body.visible = v.show.body;
    this.groups.wheels.visible = v.show.wheels;
    this.groups.ballast.visible = v.show.ballast;
    this.groups.cg.visible = v.show.cg;
    this.groups.datums.visible = v.show.datums;
    this.groups.envelope.visible = v.show.envelope;
    const m = this.bodyMaterial;
    m.wireframe = v.display === "wireframe";
    m.transparent = v.display === "xray";
    m.opacity = v.display === "xray" ? 0.28 : 1;
    m.depthWrite = v.display !== "xray";
    m.needsUpdate = true;
  }

  private installDrag(): void {
    const dom = this.renderer.domElement;
    const ndc = (e: PointerEvent): THREE.Vector2 => {
      const r = dom.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    dom.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.store.view.show.ballast) return;
      this.raycaster.setFromCamera(ndc(e), this.camera);
      const hit = this.raycaster.intersectObjects(this.groups.ballast.children, false)[0];
      if (!hit) {
        if (this.store.view.selection) this.store.setView({ selection: null });
        return;
      }
      const id = hit.object.userData.ballastId as string;
      this.store.setView({ selection: { kind: "ballast", id } });
      // Drag in the car-frame plane most nearly facing the camera.
      const look = new THREE.Vector3();
      this.camera.getWorldDirection(look);
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
      const normal = axes.reduce((a, b) => (Math.abs(b.dot(look)) > Math.abs(a.dot(look)) ? b : a));
      const centre = hit.object.position.clone();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre);
      const p = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, p);
      this.dragging = { id, plane, offset: centre.sub(p) };
      this.controls.enabled = false;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.raycaster.setFromCamera(ndc(e), this.camera);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.dragging.plane, p)) return;
      p.add(this.dragging.offset);
      const id = this.dragging.id;
      const d = this.store.design;
      const snap = (x: number): number => Math.round(x / 2.5e-4) * 2.5e-4; // 0.25 mm
      this.store.update(
        { ...d, ballast: d.ballast.map((b) => (b.id === id ? { ...b, center: [snap(p.x), snap(p.y), snap(p.z)] as V3 } : b)) },
        false,
      );
    });
    const end = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = null;
      this.controls.enabled = true;
      dom.releasePointerCapture(e.pointerId);
      this.store.commit();
    };
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
  }
}
