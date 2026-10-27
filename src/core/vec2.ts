// 2D vectors in the track's vertical plane: x horizontal (direction of travel), z up.

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const norm = (a: Vec2): number => Math.hypot(a.x, a.z);
export const unit = (a: Vec2): Vec2 => scale(a, 1 / norm(a));

/** z-component of a x b with the plane's normal taken as +y-into-page: counterclockwise positive. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.z - a.z * b.x;

/** Rotate counterclockwise by angle (rad). */
export const rotate = (a: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * a.x - s * a.z, z: s * a.x + c * a.z };
};

/** Left-hand normal of a unit tangent: for a tangent pointing along travel, this points up off the surface. */
export const leftNormal = (t: Vec2): Vec2 => ({ x: -t.z, z: t.x });
