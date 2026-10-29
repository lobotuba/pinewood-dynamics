// Car meshes shared by the design viewport and the race view, in the car frame (+X forward, +Y left,
// +Z up, metres, origin on the rear axle axis: the solver's body frame).

import * as THREE from "three";
import type { BodySolid } from "../geometry/solid.js";
import { wheelCentres } from "../geometry/solid.js";
import { TYPICAL_KIT_ESTIMATE as K } from "../kit/kit.js";

/** The body solid as a flat-shaded mesh with its feature edges. */
export function bodyMeshes(body: BodySolid, material: THREE.Material): THREE.Object3D[] {
  if (body.empty) return [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(body.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(body.indices, 1));
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(flat, 25), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  return [new THREE.Mesh(flat, material), edges];
}

export interface WheelSet {
  readonly group: THREE.Group;
  /** The parts that turn with each wheel, rear left, rear right, front left, front right: rotate about +Y to roll forward. */
  readonly wheels: readonly THREE.Group[];
}

/** Wheels, hubs, axle shanks and heads at the kit's axle positions. `marked` adds a stripe so the roll shows. */
export function wheelSet(marked = false): WheelSet {
  const r = K.wheelRadius.value;
  const ww = K.wheelWidth.value;
  const wheelGeo = new THREE.CylinderGeometry(r, r, ww, 64, 1);
  const hubGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.42, ww * 1.02, 32, 1);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.55 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5 });
  const axleMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.8, roughness: 0.3 });
  const markMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.6 });
  const outer = K.blockWidth.value / 2 + K.wheelBodyGap.value + ww;
  const group = new THREE.Group();
  const wheels: THREE.Group[] = [];
  for (const c of wheelCentres()) {
    const s = Math.sign(c[1]);
    const w = new THREE.Group();
    w.position.set(...c);
    w.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(hubGeo, hubMat));
    if (marked) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(r * 0.55, 3e-4, r * 0.14), markMat);
      mark.position.set(r * 0.68, s * (ww / 2 + 1.5e-4), 0);
      w.add(mark);
    }
    wheels.push(w);
    const L = K.axleShaftLength.value;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(K.axleRadius.value, K.axleRadius.value, L, 16), axleMat);
    shaft.position.set(c[0], s * (outer - L / 2), 0);
    const th = K.axleHeadThickness.value;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(K.axleHeadDiameter.value / 2, K.axleHeadDiameter.value / 2, th, 24), axleMat);
    head.position.set(c[0], s * (outer + th / 2), 0);
    group.add(w, shaft, head);
  }
  return { group, wheels };
}
