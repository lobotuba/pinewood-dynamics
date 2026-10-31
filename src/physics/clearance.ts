// Body clearance over the lane and the guide rail during a race: a validity monitor (PHY-009). The
// solver keeps both axles on the lane and nothing else in contact. The lane's curves bring the body
// closer to it: where the lane is concave (the transition) it rises ahead of the front axle and
// behind the rear, toward the overhangs; over a crest it rises between the axles. A body point that
// reaches the lane, or the rail's top within the rail's reach, would carry load the model does not
// have, so the race ends there as OUTSIDE_MODEL_VALIDITY.

import { type Vec2, add, dot, rotate, sub, v2 } from "../core/vec2.js";
import type { Track } from "../track/track.js";
import type { UnderbodyPoint } from "./car.js";
import type { Pose } from "./kinematics.js";

/** A body point to watch: body frame (x along, z up), and whether it can be over the rail. */
interface Watched {
  readonly x: number;
  readonly z: number;
  readonly rail: boolean;
  /** Surface arc length of the nearest lane point last time, for the next search. */
  s: number;
}

export interface Clearance {
  /** Least clearance of a watched point above the lane, m. */
  readonly lane: number;
  /** Least clearance of a watched point above the rail's top, m (Infinity without a rail). */
  readonly rail: number;
  /** Body-frame x of the point with the least clearance, m, and what it nears. */
  readonly x: number;
  readonly kind: "lane" | "rail";
}

export class ClearanceMonitor {
  private readonly watched: Watched[];
  private readonly railHeight: number;

  /**
   * points: the underbody. radii: rear and front wheel radii; wheelbase. railBand: the band across
   * the body, |y| from inner to outer, m, that can be over the rail's top (its raised edges, widened by
   * how far the car can move across); omitted when the lane has no rail.
   */
  constructor(
    points: readonly UnderbodyPoint[],
    private readonly track: Track,
    radii: readonly [number, number],
    wheelbase: number,
    railBand: { readonly inner: number; readonly outer: number } | undefined,
  ) {
    this.railHeight = track.lateral?.guideRail.height.value ?? 0;
    // Per station: the lowest point anywhere (it can meet the lane) and within the rail band.
    const stations = new Map<number, { lane: number; rail: number }>();
    for (const p of points) {
      const st = stations.get(p.x) ?? { lane: Infinity, rail: Infinity };
      st.lane = Math.min(st.lane, p.z);
      if (railBand !== undefined && Math.abs(p.y) <= railBand.outer && Math.abs(p.y) >= railBand.inner) st.rail = Math.min(st.rail, p.z);
      stations.set(p.x, st);
    }
    // A point need only be watched if the lane's curvature could bring it to contact. On an arc of
    // curvature kappa through both axles' contacts, the lane under body x departs from the line between
    // them by kappa |x| |x - WB| / 2: away from the body between the axles in a valley, toward it
    // beyond them (and the reverse over a crest).
    const surf = track.surface;
    let kappa = 0;
    for (let s = 0; s <= surf.length; s += 0.01) kappa = Math.max(kappa, Math.abs(surf.at(s).kappa));
    const laneLine = (x: number) => -(radii[0] + ((radii[1] - radii[0]) * x) / wheelbase);
    const all: (Watched & { margin: number })[] = [];
    for (const [x, st] of stations) {
      const reach = (kappa * Math.abs(x) * Math.abs(x - wheelbase)) / 2 + 5e-4;
      for (const rail of [false, true]) {
        const z = rail ? st.rail : st.lane;
        if (!Number.isFinite(z)) continue;
        const margin = z - laneLine(x) - (rail ? this.railHeight : 0);
        all.push({ x, z, rail, s: NaN, margin: margin - reach });
      }
    }
    // Watch every point within reach, and always the least-clear of each kind so the result reports it.
    const least = (rail: boolean) => all.filter((w) => w.rail === rail).sort((a, b) => a.margin - b.margin)[0];
    this.watched = all.filter((w) => w.margin <= 0 || w === least(false) || w === least(true));
  }

  /** Clearance at a pose; rearSurface is the lane arc length under the rear axle, a starting guess. */
  check(pose: Pose, rearSurface: number): Clearance {
    let lane = Infinity;
    let rail = Infinity;
    let worst = { x: 0, kind: "lane" as "lane" | "rail", c: Infinity };
    for (const w of this.watched) {
      const P = add(pose.rear.pt.p, rotate(v2(w.x, w.z), pose.theta));
      const c = this.height(P, Number.isFinite(w.s) ? w.s : rearSurface + w.x, w) - (w.rail ? this.railHeight : 0);
      if (w.rail) rail = Math.min(rail, c);
      else lane = Math.min(lane, c);
      if (c < worst.c) worst = { x: w.x, kind: w.rail ? "rail" : "lane", c };
    }
    return { lane, rail, x: worst.x, kind: worst.kind };
  }

  /** Height of P above the lane, along the lane's normal at its nearest point (Newton on the arc length). */
  private height(P: Vec2, guess: number, w: Watched): number {
    const surf = this.track.surface;
    let s = guess;
    for (let i = 0; i < 20; i++) {
      const q = surf.at(s);
      const r = sub(P, q.p);
      const f = dot(r, q.t);
      const step = f / (1 - q.kappa * dot(r, q.n));
      s += step;
      if (Math.abs(step) < 1e-12) break;
    }
    w.s = s;
    const q = surf.at(s);
    return dot(sub(P, q.p), q.n);
  }
}
