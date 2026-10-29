// Axial play: each wheel slides along its axle between the body and the axle head (derivation in
// docs/physics-model.md, section 12).
//
// The lateral model's coordinates (Y, psi) gain one for each wheel on an axle with play: xi, the
// wheel's slide outward from the body along its axle, 0 <= xi <= travel. The lane holds the wheel's
// height, so a unit of slide moves it cos(gamma) across the lane, and on a cambered axle raises or
// lowers the body sin(gamma) at that corner instead.
//
// Forces on a slide:
//   faces  the body at xi = 0 and the axle head at xi = travel: unilateral contacts with Newton
//          restitution, the hub striking its face. A wheel bears on a face, and that face's thrust
//          friction acts on the spin (dynamics.ts), only at the end of its travel.
//   tread  each wheel's own Coulomb tread. With play a wheel's sideways load reaches the car only
//          through a face or the bore's friction, so the two treads of an axle act separately.
//   bore   Coulomb friction at the bore opposes the bore surface's slip, whose components are the
//          spin relative to the body, w = |omega - pitch rate| r_axle, and the slide rate. Its axial
//          part is -mu |R| xi' / sqrt(w^2 + xi'^2): while xi' << w, a damper of rate mu |R| / w. The
//          spin keeps the share w / sqrt(w^2 + xi'^2) of the limit. The root is taken at the step's
//          starting slide rate (first order in h) and the damper is implicit. A wheel that is not
//          yet turning (w = 0, at the gate) is held by static friction, a Coulomb element with
//          limit mu |R| h.
//   heave  sliding down a cambered axle would take the wheel into the lane, so the body corner rises
//          sin(gamma) per unit of slide against the axle's load: generalized force sin(gamma) R.n,
//          R the axle's force on the wheel at the start of the step.
//   rail   as in lateral.ts, the face moved across the lane by the slide.
//   gravity across the lane on the wheel.
//
// Mass matrix: a wheel's sideways velocity is Y' + D psi' + s xi', with the lever D and the slide
// factor s = side cos(gamma) cos(toe) frozen at the square pose (psi = 0). The terms this freezes are
// of relative size |psi| ~ 0.04 in the coupling, which is itself m_w / m ~ 0.02 of the motion; the
// matrix is constant, so the discrete energy balance stays exact.
//
// When both wheels of an axle rest on faces in sustained contact with both treads sticking, they move
// with the car as one and their tread forces cannot be told apart (the rigid model's static
// indeterminacy). They are taken equal, as on an axle without play: the limit of equal tread
// compliances.
//
// Each step starts its search from the previous step's stick/slip and open/closed states and corrects
// every violated law at once; if that cycles, it enumerates the combinations as lateral.ts does.

import {
  type Candidate,
  type LateralInput,
  type LateralModel,
  type LateralState,
  type LateralStep,
  type PlanarForce,
  type RailContact,
  type StopContact,
  type WheelAxles,
  type RollForce,
  axles,
  bodyPoint,
  candidates,
  rollLoads,
  solveSmall,
} from "./lateral.js";

const sideOf = (k: number): 1 | -1 => (k % 2 === 0 ? 1 : -1);
const axleOf = (k: number): 0 | 1 => (k < 2 ? 0 : 1);
const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};
const matVec = (A: readonly (readonly number[])[], x: readonly number[]): number[] => A.map((row) => dot(row, x));

/** Each wheel's slide coordinate in the generalized velocity (after Y', psi'), or -1 for a wheel without play. */
export function slideIndex(L: LateralModel): number[] {
  const out = [-1, -1, -1, -1];
  if (!L.play) return out;
  let j = 2;
  for (let k = 0; k < 4; k++) if (L.play.travel[axleOf(k)] > 0) out[k] = j++;
  return out;
}

/** A wheel's mass, its lever D = dy/dpsi at the square pose, and its slide factor s. */
function frozen(L: LateralModel, k: number): { m: number; D: number; s: number } {
  const i = axleOf(k);
  const d = L.toe[i];
  const cg = Math.cos(L.camber[i]);
  const reach = L.spacing / 2 + 0.5 * L.treadWidth * cg;
  const bx = L.wheelbase * i - sideOf(k) * reach * Math.sin(d);
  return { m: L.wheelMass[i] / 2, D: bx - L.xc, s: sideOf(k) * cg * Math.cos(d) };
}

export function massMatrix(L: LateralModel): number[][] {
  const idx = slideIndex(L);
  const n = 2 + idx.filter((j) => j >= 0).length;
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  M[0]![0] = L.m;
  M[1]![1] = L.Iz;
  for (let k = 0; k < 4; k++) {
    const j = idx[k]!;
    if (j < 0) continue;
    const { m, D, s } = frozen(L, k);
    if (!(m > 0)) throw new Error("Axial play needs the wheels' mass");
    M[0]![j] = M[j]![0] = m * s;
    M[1]![j] = M[j]![1] = m * D * s;
    M[j]![j] = m * s * s;
  }
  return M;
}

function velocity(L: LateralModel, s: LateralState): number[] {
  const idx = slideIndex(L);
  const V = [s.dY, s.dPsi];
  for (let k = 0; k < 4; k++) if (idx[k]! >= 0) V[idx[k]!] = s.dXi?.[k] ?? 0;
  return V;
}

/** Sideways, yaw and slide kinetic energy, J. */
export function playKinetic(L: LateralModel, s: LateralState): number {
  const V = velocity(L, s);
  return 0.5 * dot(V, matVec(massMatrix(L), V));
}

/** The wheels' slides at the gate: the given fraction of each axle's play, at rest. */
export function startSlides(L: LateralModel): { xi: number[]; dXi: number[] } {
  const p = L.play!;
  return { xi: [0, 1, 2, 3].map((k) => p.start * p.travel[axleOf(k)]), dXi: [0, 0, 0, 0] };
}

/** The wheels' axles before the first step: a wheel with play bears on no face yet. */
export function restingPlayAxles(L: LateralModel, s: LateralState): WheelAxles {
  return withPlay(L, axles(L, s.Y, s.psi, [0, 0], 0), [0, 0, 0, 0], [1, 1, 1, 1]);
}

function withPlay(L: LateralModel, base: WheelAxles, thrust: readonly number[], spin: readonly number[]): WheelAxles {
  const idx = slideIndex(L);
  const one = (i: 0 | 1, w: 0 | 1) => {
    const k = 2 * i + w;
    return idx[k]! < 0 ? base[i][w] : { ...base[i][w], thrust: thrust[k]!, boreSpin: spin[k]! };
  };
  return [
    [one(0, 0), one(0, 1)],
    [one(1, 0), one(1, 1)],
  ];
}

/** Every rail and face gap at a pose, m, by contact key. */
function gaps(L: LateralModel, Y: number, psi: number, xi: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of candidates(L, Y, psi, xi)) out.set(`r${c.wheel}`, c.gap);
  const idx = slideIndex(L);
  for (let k = 0; k < 4; k++) {
    if (idx[k]! < 0) continue;
    out.set(`b${k}`, xi[k]!);
    out.set(`o${k}`, L.play!.travel[axleOf(k)] - xi[k]!);
  }
  return out;
}

/**
 * The earliest time within h at which an open rail or face gap closes, from the lateral state's own
 * velocity, or null. A gap within a millionth of a step of closing is left to the step itself.
 */
export function playArrival(L: LateralModel, s: LateralState, h: number): number | null {
  const xi = s.xi ?? [0, 0, 0, 0];
  const dXi = s.dXi ?? [0, 0, 0, 0];
  const g0 = gaps(L, s.Y, s.psi, xi);
  const g1 = gaps(L, s.Y + h * s.dY, s.psi + h * s.dPsi, xi.map((x, k) => x + h * dXi[k]!));
  let best: number | null = null;
  for (const [key, a] of g0) {
    const b = g1.get(key)!;
    if (!(a > 0) || !(b < 0)) continue;
    const tau = (h * a) / (a - b);
    if (tau > 1e-6 * h && (best === null || tau < best)) best = tau;
  }
  return best;
}

/** A Coulomb element: a tread, or a wheel held by the bore's static friction. */
interface Box {
  readonly key: string;
  readonly row: number[];
  /** Stick: row . V = target. */
  readonly target: number;
  readonly limit: number;
  readonly scale: number;
  /** Creep (treads only): slip per unit impulse below the limit, and the slip at which it slides. */
  readonly compliance: number;
  readonly sat: number;
  /** Tread elements: the axle, and the wheel (-1 for both wheels of an axle without play). */
  readonly axle: 0 | 1 | -1;
  readonly wheel: number;
}

/** A unilateral contact: a wheel face on the rail, or a hub on its body or head face. */
interface Uni {
  readonly key: string;
  readonly row: number[];
  readonly col: number[];
  readonly gap: number;
  readonly e: number;
  readonly cand?: Candidate;
  readonly wheel: number;
  readonly face?: "body" | "head";
}

interface Trial {
  readonly score: number;
  readonly V: number[];
  readonly box: Map<string, number>;
  readonly uni: Map<string, number>;
  readonly flips: { box: Map<string, number>; open: string[]; close: string[] };
}

export function playStep(L: LateralModel, s: LateralState, inp: LateralInput): LateralStep {
  const play = L.play!;
  const h = inp.h;
  const idx = slideIndex(L);
  const M = massMatrix(L);
  const n = M.length;
  const e = (j: number): number[] => {
    const v = new Array<number>(n).fill(0);
    v[j] = 1;
    return v;
  };
  const xi0 = s.xi ?? [0, 0, 0, 0];
  const dXi0 = s.dXi ?? [0, 0, 0, 0];
  const V0 = velocity(L, s);
  const loads = inp.loads!;
  const prev = inp.prev ?? {};

  // Applied forces: gravity across the lane, and the heave of a cambered axle; the bore dampers.
  const Fg = new Array<number>(n).fill(0);
  const Fh = new Array<number>(n).fill(0);
  const C = new Array<number>(n).fill(0);
  Fg[0] = -L.m * L.gLat;
  const boxes: Box[] = [];
  const spinShare = [1, 1, 1, 1];
  for (let k = 0; k < 4; k++) {
    const j = idx[k]!;
    if (j < 0) continue;
    const f = frozen(L, k);
    Fg[j] = -f.m * L.gLat * f.s;
    Fh[j] = Math.sin(L.camber[axleOf(k)]) * loads[k]!.normal;
    const w = loads[k]!.slip;
    const v = dXi0[k]!;
    if (w === 0 && v === 0) {
      if (loads[k]!.friction > 0) boxes.push({ key: `h${k}`, row: e(j), target: 0, limit: loads[k]!.friction * h, scale: 1e-12, compliance: 0, sat: 0, axle: -1, wheel: k });
    } else {
      const root = Math.hypot(w, v);
      C[j] = loads[k]!.friction / root;
      spinShare[k] = w / root;
    }
  }
  const K = invert(M.map((row, a) => row.map((x, b) => (a === b ? x + h * C[a]! : x))));
  const Vfree = matVec(K, matVec(M, V0).map((x, a) => x + h * (Fg[a]! + Fh[a]!)));

  // Geometry at the step's midpoint, predicted from the starting velocity.
  const Ym = s.Y + 0.5 * h * V0[0]!;
  const pm = s.psi + 0.5 * h * V0[1]!;
  const xim = xi0.map((x, k) => x + 0.5 * h * dXi0[k]!);

  const treadSin = [0, 0];
  const treadCos = [0, 0];
  for (const i of [0, 1] as const) {
    const a = pm + L.toe[i];
    const pt = bodyPoint(L, Ym, pm, L.wheelbase * i, 0);
    const c = Math.cos(a);
    treadSin[i] = Math.sin(a);
    treadCos[i] = c;
    const base = new Array<number>(n).fill(0);
    base[0] = c;
    base[1] = c * pt.dyDpsi;
    const limit = L.muT * Math.max(inp.N[i], 0) * h;
    const target = inp.v1[i]! * treadSin[i]!;
    const scale = 1e-12 * (1 + Math.abs(inp.v1[i]!));
    const sat = L.creep ? L.creep * Math.abs(inp.v1[i]!) : 0;
    const creep = (lim: number) => ({ compliance: sat > 0 && lim > 0 ? sat / lim : 0, sat });
    if (play.travel[i] > 0)
      for (const k of [2 * i, 2 * i + 1]) {
        // The slide moves the tread across its own rolling direction at side cos(gamma). Each tread's
        // limit is its own wheel's load: half the axle's, shifted by roll.
        const row = [...base];
        row[idx[k]!] = sideOf(k) * Math.cos(L.camber[i]);
        const own = L.muT * Math.max(inp.N[i] / 2 + (inp.roll?.[k] ?? 0), 0) * h;
        boxes.push({ key: `t${k}`, row, target, limit: own, scale, ...creep(own), axle: i, wheel: k });
      }
    else boxes.push({ key: `a${i}`, row: base, target, limit, scale, ...creep(limit), axle: i, wheel: -1 });
  }

  const unis: Uni[] = [];
  const restitution = (key: string, e0: number): number => (prev[key] === 1 ? 0 : e0);
  for (const c of candidates(L, Ym, pm, xim)) {
    if (!(c.gap <= 0)) continue;
    const row = new Array<number>(n).fill(0);
    const col = new Array<number>(n).fill(0);
    row[0] = c.G[0];
    row[1] = c.G[1];
    col[0] = c.W[0];
    col[1] = c.W[1];
    const j = idx[c.wheel]!;
    if (j >= 0) {
      row[j] = c.Gxi;
      col[j] = c.Wxi;
    }
    unis.push({ key: `r${c.wheel}`, row, col, gap: c.gap, e: restitution(`r${c.wheel}`, L.e), cand: c, wheel: c.wheel });
  }
  for (let k = 0; k < 4; k++) {
    const j = idx[k]!;
    if (j < 0) continue;
    const toBody = xim[k]!;
    const toHead = play.travel[axleOf(k)] - xim[k]!;
    if (toBody <= 0) unis.push({ key: `b${k}`, row: e(j), col: e(j), gap: toBody, e: restitution(`b${k}`, play.e), wheel: k, face: "body" });
    if (toHead <= 0) {
      const minus = e(j).map((x) => -x);
      unis.push({ key: `o${k}`, row: minus, col: minus, gap: toHead, e: restitution(`o${k}`, play.e), wheel: k, face: "head" });
    }
  }
  const penetration = Math.max(0, ...unis.map((u) => -u.gap));
  const tol = 1e-12;

  const evaluate = (boxMode: Map<string, number>, closed: Set<string>): Trial | null => {
    // A pair of wheels resting on faces in sustained contact, both treads sticking: one shared force.
    const merged = new Set<number>();
    for (const i of [0, 1] as const) {
      if (!(play.travel[i] > 0)) continue;
      const locked = (k: number) => unis.some((u) => u.wheel === k && u.face && closed.has(u.key) && u.e === 0);
      // With creep the two treads' compliances settle the split; rigid treads need the equal-split rule.
      const rigid = !boxes.some((b) => b.axle === i && b.compliance > 0);
      if (rigid && boxMode.get(`t${2 * i}`) === 0 && boxMode.get(`t${2 * i + 1}`) === 0 && locked(2 * i) && locked(2 * i + 1)) merged.add(i);
    }
    let Vb = [...Vfree];
    const imp = new Map<string, number>();
    const cols: number[][] = [];
    const rows: { a: number[]; rhs: number; diag?: number }[] = [];
    const owners: string[][] = [];
    for (const b of boxes) {
      const m = boxMode.get(b.key)!;
      if (b.limit === 0) continue;
      if (m !== 0) {
        imp.set(b.key, -m * b.limit);
        Vb = Vb.map((x, a) => x + dot(K[a]!, b.row) * -m * b.limit);
        continue;
      }
      if (b.axle >= 0 && merged.has(b.axle)) {
        if (b.wheel % 2 === 1) continue;
        const other = boxes.find((o) => o.wheel === b.wheel + 1 && o.axle === b.axle)!;
        cols.push(b.row.map((x, a) => x + other.row[a]!));
        rows.push({ a: b.row.map((x, a) => 0.5 * (x + other.row[a]!)), rhs: b.target });
        owners.push([b.key, other.key]);
        continue;
      }
      cols.push(b.row);
      rows.push({ a: b.row, rhs: b.target, diag: b.compliance });
      owners.push([b.key]);
    }
    for (const u of unis) {
      if (!closed.has(u.key)) continue;
      cols.push(u.col);
      rows.push({ a: u.row, rhs: -u.e * dot(u.row, V0) });
      owners.push([u.key]);
    }
    let x: number[] = [];
    if (cols.length > 0) {
      const Kc = cols.map((c) => matVec(K, c));
      const A = rows.map((r, j) => Kc.map((kc, q) => dot(r.a, kc) + (q === j && r.diag ? r.diag : 0)));
      const sol = solveSmall(A, rows.map((r) => r.rhs - dot(r.a, Vb)));
      if (!sol) return null;
      x = sol;
      Vb = Vb.map((v, a) => v + Kc.reduce((acc, kc, c) => acc + kc[a]! * x[c]!, 0));
    }
    owners.forEach((keys, c) => keys.forEach((key) => imp.set(key, x[c]!)));
    const V = Vb;
    let score = 0;
    const flips = { box: new Map<string, number>(), open: [] as string[], close: [] as string[] };
    for (const b of boxes) {
      if (b.limit === 0) continue;
      const m = boxMode.get(b.key)!;
      const u = dot(b.row, V) - b.target;
      if (m === 0) {
        const lam = imp.get(b.key)!;
        const viol = Math.abs(lam) - b.limit - tol * (1 + b.limit);
        if (viol > 0) flips.box.set(b.key, -Math.sign(lam));
        score = Math.max(score, viol);
      } else {
        const viol = -m * u - b.scale + b.sat;
        if (viol > 0) flips.box.set(b.key, 0);
        score = Math.max(score, viol);
      }
    }
    const P = new Map<string, number>();
    for (const u of unis) {
      if (closed.has(u.key)) {
        const p = imp.get(u.key)!;
        P.set(u.key, p);
        if (-p - tol > 0) flips.open.push(u.key);
        score = Math.max(score, -p - tol);
      } else {
        const ref = dot(u.row, V0);
        const viol = -(dot(u.row, V) + u.e * ref) - tol * (1 + Math.abs(ref));
        if (viol > 0) flips.close.push(u.key);
        score = Math.max(score, viol);
      }
    }
    const boxImp = new Map<string, number>();
    for (const b of boxes) boxImp.set(b.key, imp.get(b.key) ?? 0);
    return { score, V, box: boxImp, uni: P, flips };
  };

  // Active-set search from the previous step's states.
  const boxMode = new Map<string, number>();
  for (const b of boxes) boxMode.set(b.key, b.limit === 0 ? 0 : (prev[b.key] ?? 0));
  const closed = new Set(unis.filter((u) => prev[u.key] === 1).map((u) => u.key));
  const stateKey = () => [...boxMode.values()].join(",") + "|" + [...closed].sort().join(",");
  const seen = new Set<string>();
  const found: { best: (Trial & { modes: Map<string, number> }) | null } = { best: null };
  const consider = (t: Trial | null, bm: Map<string, number>) => {
    if (t && (!found.best || t.score < found.best.score)) found.best = { ...t, modes: new Map(bm) };
  };
  for (let it = 0; it < 30; it++) {
    const key = stateKey();
    if (seen.has(key)) break;
    seen.add(key);
    const t = evaluate(boxMode, closed);
    consider(t, boxMode);
    if (!t || t.score <= 0) break;
    for (const [k, m] of t.flips.box) boxMode.set(k, m);
    for (const k of t.flips.open) closed.delete(k);
    for (const k of t.flips.close) closed.add(k);
  }
  if (!found.best || found.best.score > 0) {
    // Enumerate every combination, open contacts and sticking treads first, as lateral.ts does.
    const free = boxes.filter((b) => b.limit > 0);
    const combos = 3 ** free.length * 2 ** unis.length;
    if (combos <= 200_000)
      search: for (let mask = 0; mask < 2 ** unis.length; mask++) {
        const cl = new Set(unis.filter((_, i) => (mask >> i) & 1).map((u) => u.key));
        for (let code = 0; code < 3 ** free.length; code++) {
          const bm = new Map<string, number>();
          for (const b of boxes) bm.set(b.key, 0);
          let c = code;
          for (const b of free) {
            bm.set(b.key, [0, 1, -1][c % 3]!);
            c = Math.floor(c / 3);
          }
          const t = evaluate(bm, cl);
          consider(t, bm);
          if (t && t.score <= 0) break search;
        }
      }
  }
  const sol = found.best!;
  const V = sol.V;
  const Vmid = V.map((x, a) => 0.5 * (V0[a]! + x));
  const xi = [0, 0, 0, 0];
  const dXi = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const j = idx[k]!;
    if (j < 0) continue;
    xi[k] = xi0[k]! + h * Vmid[j]!;
    dXi[k] = V[j]!;
  }
  const next: LateralState = { Y: s.Y + h * Vmid[0]!, psi: s.psi + h * Vmid[1]!, dY: V[0]!, dPsi: V[1]!, xi, dXi };

  const forces: PlanarForce[] = [];
  const modes: Record<string, number> = {};
  let wTread = 0;
  let wBore = 0;
  for (const b of boxes) {
    const lam = sol.box.get(b.key)!;
    modes[b.key] = sol.modes.get(b.key)!;
    if (lam === 0) continue;
    const w = lam * dot(b.row, Vmid);
    if (b.axle < 0) {
      wBore += w;
      continue;
    }
    const i = b.axle as 0 | 1;
    wTread += w;
    // The tread force at the wheel's tread contact: no torque on the spin; it loads the axle.
    forces.push({
      kind: "tread",
      axle: i,
      onWheel: true,
      side: b.wheel < 0 ? 0 : sideOf(b.wheel),
      at: { t: 0, n: -L.radius[i] },
      f: { t: (-lam * treadSin[i]!) / h, n: 0 },
      y: (lam * treadCos[i]!) / h,
      spin: 0,
    });
  }
  for (let a = 2; a < n; a++) wBore += -h * C[a]! * V[a]! * Vmid[a]!;

  let wNormal = 0;
  let wFric = 0;
  let wStops = 0;
  const contacts: RailContact[] = [];
  const stops: StopContact[] = [];
  const thrust = [0, 0, 0, 0];
  let impact = false;
  for (const u of unis) {
    const p = sol.uni.get(u.key) ?? 0;
    modes[u.key] = p > 0 ? 1 : 0;
    if (p === 0) continue;
    if (p > 0 && prev[u.key] !== 1) impact = true;
    if (u.face) {
      wStops += p * dot(u.row, Vmid);
      stops.push({ wheel: u.wheel, face: u.face, force: p / h });
      thrust[u.wheel] = thrust[u.wheel]! + (u.face === "body" ? p : -p) / h;
      continue;
    }
    const c = u.cand!;
    wNormal += p * dot(u.row, Vmid);
    wFric += p * dot(u.col.map((x, a) => x - u.row[a]!), Vmid);
    const F = p / h;
    contacts.push({ axle: c.axle, side: c.side, force: F });
    const f = c.force;
    forces.push({ kind: "rail", axle: c.axle, onWheel: true, side: c.side, at: c.at, f: { t: f.t * F, n: f.n * F }, y: f.y * F, spin: f.spin * F });
  }

  const rails: RollForce[] = unis.flatMap((u) => {
    const p = sol.uni.get(u.key) ?? 0;
    if (!u.cand || p === 0) return [];
    const F = p / h;
    return [{ y: u.cand.y, z: L.radius[u.cand.axle] + u.cand.at.n, Fy: u.cand.force.y * F, Fz: u.cand.force.n * F }];
  });
  const roll = rollLoads(L, Ym, (V[0]! - V0[0]!) / h, inp.N, rails);

  const slip: [number, number] = [0, 0];
  for (const b of boxes) if (b.axle >= 0 && slip[b.axle as 0 | 1] === 0) slip[b.axle as 0 | 1] = sol.modes.get(b.key)!;
  return {
    next,
    forces,
    contacts,
    stops,
    work: {
      gravity: h * dot(Fg, Vmid),
      tread: wTread,
      railNormal: wNormal,
      railFriction: wFric,
      stops: wStops,
      boreSlide: wBore,
      heave: h * dot(Fh, Vmid),
    },
    wheels: withPlay(L, axles(L, Ym, pm, [V[0]! - V0[0]!, V[1]! - V0[1]!], h, roll), thrust, spinShare),
    slip,
    consistent: sol.score <= 0,
    penetration,
    modes,
    impact,
  };
}

/** Inverse of a small symmetric positive definite matrix, by Gauss-Jordan elimination. */
function invert(A: readonly (readonly number[])[]): number[][] {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const p = M[c]![c]!;
    for (let j = 0; j < 2 * n; j++) M[c]![j] = M[c]![j]! / p;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r]![j] = M[r]![j]! - f * M[c]![j]!;
    }
  }
  return M.map((row) => row.slice(n));
}
