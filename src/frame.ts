// Coordinate frames.
//
// - AC3D file (as FlightGear writes them): x = aft, y = up, z = left.
// - FlightGear model XML offsets: x = aft, y = right, z = up.
// - glTF output, matching the app's `tool/glb.dart`: X = right, Y = up,
//   Z = aft, so the nose points along -Z and the map only has to yaw the
//   model by the aircraft's heading.
//
// Verified on c172p.ac (`RightNavLightOn` sits at z = -4.8) and on the A380's
// `nav-right` offset (y = +38.2 against a ±39.8 m span).

export type Vec3 = [number, number, number];

export const acToGltf = (v: Vec3): Vec3 => [-v[2], v[1], v[0]];

export const fgToGltf = (v: Vec3): Vec3 => [v[1], v[2], v[0]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

export interface Box {
  min: Vec3;
  max: Vec3;
}

export function bounds(points: Iterable<Vec3>): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]!;
      if (p[i]! > max[i]!) max[i] = p[i]!;
    }
  }
  return { min, max };
}
