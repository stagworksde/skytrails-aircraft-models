// Turns one FlightGear AI model into the parts the emitter writes: painted,
// simplified surfaces (body/accent/glass, textured with the model's neutral
// default paint where it has one), light positions and prop discs — all in
// the glTF frame, recentred the way the app's hand-built GLBs are (X/Z
// centred, bottom at Y = 0).

import { existsSync } from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { ModelSpec } from '../models';
import { parseAc3d } from './ac3d';
import { classify, finName, removedClasses, type PartClass } from './classify';
import { gearObjectNames, lightPositions, type Light, type LightKind } from './fgxml';
import {
  acToGltf,
  add,
  bounds,
  cross,
  dot,
  length,
  normalize,
  sub,
  type Box,
  type Vec3,
} from './frame';

export type Surface = 'body' | 'accent' | 'glass';
export const surfaces: Surface[] = ['body', 'accent', 'glass'];

export interface Mesh {
  /** xyz per vertex. */
  positions: Float32Array<ArrayBuffer>;
  /** Unit normal per vertex. */
  normals: Float32Array<ArrayBuffer>;
  /** uv per vertex, glTF convention (v = 0 at the top); null when untextured. */
  uvs: Float32Array<ArrayBuffer> | null;
  indices: Uint32Array<ArrayBuffer>;
}

/** One primitive of the airframe: a surface tone, optionally textured. */
export interface Part {
  surface: Surface;
  /** Source texture file (under the model's `textureDir`), if any. */
  texture?: string;
  mesh: Mesh;
}

export interface PropDisc {
  center: Vec3;
  radius: number;
}

export interface ObjectReport {
  name: string;
  path: string[];
  cls: PartClass;
  tris: number;
  /** True when no rule matched the name and it fell through to `body`. */
  defaulted: boolean;
}

export interface ProcessedModel {
  spec: ModelSpec;
  parts: Part[];
  lights: Light[];
  /** Where each light position came from, for the build report. */
  lightSource: 'xml' | 'named' | 'geometry' | 'mixed';
  lightRadius: number;
  props: PropDisc[];
  /** Overall dimensions of the kept airframe, metres. */
  size: { length: number; span: number; height: number };
  trisBefore: number;
  trisAfter: number;
  finFound: 'named' | 'geometry' | 'none';
  objects: ObjectReport[];
}

type UV = [number, number];

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  /** Per-corner texture coordinates, present only on textured triangles. */
  uv?: [UV, UV, UV];
  texture?: string;
  cls: PartClass;
  object: number;
}

const readText = (path: string) => Bun.file(path).text();

export async function processModel(spec: ModelSpec, sourceDir: string): Promise<ProcessedModel> {
  const dir = `${sourceDir}/${spec.folder}`;
  const ac = parseAc3d(await readText(`${dir}/${spec.ac}`));
  const gear = spec.mainXml ? gearObjectNames(await readText(`${dir}/${spec.mainXml}`)) : new Set<string>();
  const hints = { gear, overrides: spec.classes ?? {} };
  const textureExists = (name: string) =>
    spec.textureDir !== undefined && existsSync(`${dir}/${spec.textureDir}/${name}`);

  // 1. Classify objects and triangulate (fan; AC3D polygons are convex in practice).
  const tris: Tri[] = [];
  const objects: ObjectReport[] = [];
  ac.objects.forEach((o, index) => {
    const cls = classify(o.path, o.name, hints);
    const verts = o.verts.map(acToGltf);
    // Glass stays a flat tone: the windows are its whole point.
    const texture = cls !== 'glass' && o.texture && textureExists(o.texture) ? o.texture : undefined;
    let count = 0;
    for (const s of o.surfaces) {
      for (let i = 1; i < s.refs.length - 1; i++) {
        const corners = [0, i, i + 1];
        const [a, b, c] = corners.map((k) => verts[s.refs[k]!]);
        if (!a || !b || !c) continue;
        // AC3D puts v = 0 at the bottom of the image, glTF at the top.
        const uv = texture
          ? (corners.map((k) => {
              const [u, v] = s.uvs[k] ?? [0, 0];
              return [u, 1 - v];
            }) as [UV, UV, UV])
          : undefined;
        tris.push({ a, b, c, cls, object: index, ...(uv ? { uv, texture } : {}) });
        count++;
      }
    }
    const defaulted = cls === 'body' && !hints.overrides[o.name];
    objects.push({ name: o.name, path: o.path, cls, tris: count, defaulted });
  });

  const kept = tris.filter((t) => !removedClasses.has(t.cls));
  if (kept.length === 0) throw new Error(`${spec.id}: nothing left after removing parts`);
  const box = bounds(kept.flatMap((t) => [t.a, t.b, t.c]));
  const size = {
    length: box.max[2] - box.min[2],
    span: box.max[0] - box.min[0],
    height: box.max[1] - box.min[1],
  };

  // 2. Paint: the fin by name, else by shape.
  let finFound: ProcessedModel['finFound'] = 'none';
  if (objects.some((o) => o.cls === 'accent' && finName.test(o.name))) {
    finFound = 'named';
  } else if (paintFinGeometrically(kept, box)) {
    finFound = 'geometry';
  }

  // 3. Props become discs; their blades are already out of `kept`.
  const candidates: (PropDisc & { aspect: number })[] = [];
  ac.objects.forEach((_, index) => {
    if (objects[index]!.cls !== 'prop') return;
    const pts = tris.filter((t) => t.object === index).flatMap((t) => [t.a, t.b, t.c]);
    if (pts.length === 0) return;
    const b = bounds(pts);
    candidates.push({
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
      radius: Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2,
      aspect:
        Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) /
        Math.max(Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]), 1e-3),
    });
  });
  const props = mergeProps(candidates);

  // 4. Lights. Wingtip lights always sit on the tip itself: the procedural
  //    light XML places them for FlightGear's own light rendering, and on
  //    these models that is often a metre ahead of or above the tip. Tail and
  //    beacons come from the XML, then named light objects, then geometry.
  const lightRadius = Math.min(0.6, Math.max(0.12, 0.008 * size.span));
  const fromXml = spec.lightsXml ? lightPositions(await readText(`${dir}/${spec.lightsXml}`)) : [];
  const fromNames = namedLights(ac.objects.map((o) => o.name), tris, objects);
  const { lights, source } = mergeLights(
    fromXml.filter((l) => !isWingtip(l.kind)),
    fromNames.filter((l) => !isWingtip(l.kind)),
    geometricLights(kept, box, lightRadius),
  );

  // 5. Recentre like the app's GLBs: X/Z centred on the airframe, bottom at Y = 0.
  const offset: Vec3 = [
    -(box.min[0] + box.max[0]) / 2,
    -box.min[1],
    -(box.min[2] + box.max[2]) / 2,
  ];
  const shift = (v: Vec3) => add(v, offset);
  for (const t of kept) {
    t.a = shift(t.a);
    t.b = shift(t.b);
    t.c = shift(t.c);
  }
  for (const l of lights) l.pos = shift(l.pos);
  for (const p of props) p.center = shift(p.center);

  // 6. Simplify each part (surface × texture) to its share of the budget,
  //    then shade.
  await MeshoptSimplifier.ready;
  const groups = new Map<string, { surface: Surface; texture?: string; tris: Tri[] }>();
  for (const t of kept) {
    const surface = surfaceOf(t.cls);
    const key = `${surface}|${t.texture ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { surface, ...(t.texture ? { texture: t.texture } : {}), tris: [] };
      groups.set(key, g);
    }
    g.tris.push(t);
  }
  const trisBefore = kept.length;
  const ordered = surfaces.flatMap((s) => [...groups.values()].filter((g) => g.surface === s));
  const welded = ordered.map((g) => weld(g.tris));
  let targets = ordered.map((g) =>
    Math.max(
      Math.floor((spec.budget * g.tris.length) / Math.max(trisBefore, spec.budget)),
      Math.min(g.tris.length, 12),
    ),
  );
  let simplified = welded.map((w, i) => simplify(w, targets[i]!));
  // Small parts keep a floor of 12 triangles, which can push the total a
  // few over budget: take the overshoot out of the largest part.
  const total = () => simplified.reduce((n, w) => n + w.indices.length / 3, 0);
  for (let attempt = 0; attempt < 4 && total() > spec.budget; attempt++) {
    const largest = simplified.reduce((best, w, i) => (w.indices.length > simplified[best]!.indices.length ? i : best), 0);
    targets = targets.map((t, i) => (i === largest ? simplified[i]!.indices.length / 3 - (total() - spec.budget) : t));
    simplified = simplified.map((w, i) => (i === largest ? simplify(welded[i]!, targets[i]!) : w));
  }
  const parts: Part[] = [];
  simplified.forEach((w, i) => {
    const g = ordered[i]!;
    const mesh = shade(w);
    if (mesh.indices.length === 0) return;
    parts.push({ surface: g.surface, ...(g.texture ? { texture: g.texture } : {}), mesh });
  });
  const trisAfter = parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);

  return {
    spec,
    parts,
    lights,
    lightSource: source,
    lightRadius,
    props,
    size,
    trisBefore,
    trisAfter,
    finFound,
    objects,
  };
}

/**
 * One disc per propeller. A model often draws each prop two or three times
 * (still blades, a slow blur, a fast disc) — those overlap and become one
 * disc of the largest radius. Anything under 25 cm is a hub or a lever, not
 * a propeller.
 */
function mergeProps(candidates: (PropDisc & { aspect: number })[]): PropDisc[] {
  const out: PropDisc[] = [];
  // A disc seen head-on is round. One object holding both propellers of a
  // twin (the Dash 8's `Blur`) is twice as wide as tall, and would become a
  // single giant disc across the fuselage; the per-engine objects cover it.
  const round = (c: PropDisc & { aspect: number }) => c.aspect < 1.5;
  for (const c of candidates.filter((c) => c.radius >= 0.25 && round(c)).sort((a, b) => b.radius - a.radius)) {
    const same = out.find((d) => length(sub(d.center, c.center)) < Math.max(d.radius, c.radius) * 0.6);
    if (!same) out.push({ center: [...c.center], radius: c.radius });
  }
  return out;
}

function surfaceOf(cls: PartClass): Surface {
  return cls === 'accent' ? 'accent' : cls === 'glass' ? 'glass' : 'body';
}

const isWingtip = (kind: LightKind) => /-(left|right)$/.test(kind);

const centroid = (t: Tri): Vec3 => [
  (t.a[0] + t.b[0] + t.c[0]) / 3,
  (t.a[1] + t.b[1] + t.c[1]) / 3,
  (t.a[2] + t.b[2] + t.c[2]) / 3,
];

/**
 * Newer AI models merge the whole airframe into one mesh, so there is no fin
 * object to paint. The fin is what rises above the fuselage roof over the aft
 * part of the aircraft, close to the centreline — a horizontal tail at
 * fuselage height stays body-coloured.
 */
function paintFinGeometrically(kept: Tri[], box: Box): boolean {
  const len = box.max[2] - box.min[2];
  const span = box.max[0] - box.min[0];
  const midZ = (box.min[2] + box.max[2]) / 2;
  const cx = (box.min[0] + box.max[0]) / 2;

  // Fuselage roof: where a vertical line on the centreline around mid-length
  // leaves the airframe. Cast, not sampled from vertices: a fuselage is often
  // a few long quads with no vertex anywhere near mid-length.
  const hits: number[] = [];
  for (const dz of [-0.06, -0.03, 0, 0.03, 0.06]) {
    const top = topAt(kept, cx, midZ + dz * len);
    if (top !== undefined) hits.push(top);
  }
  if (hits.length === 0) return false;
  hits.sort((a, b) => a - b);
  const roof = hits[Math.floor(hits.length / 2)]!;

  let painted = 0;
  for (const t of kept) {
    if (t.cls !== 'body') continue;
    const c = centroid(t);
    if (c[1] > roof + 0.02 * len && c[2] > midZ + 0.15 * len && Math.abs(c[0] - cx) < 0.03 * span) {
      t.cls = 'accent';
      painted++;
    }
  }
  return painted > 0;
}

/** Highest point where the vertical line at (x, z) crosses any triangle. */
function topAt(tris: Tri[], x: number, z: number): number | undefined {
  let top: number | undefined;
  for (const t of tris) {
    // Barycentric coordinates of (x, z) in the triangle's XZ projection.
    const [a, b, c] = [t.a, t.b, t.c];
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const w = 1 - u - v;
    if (u < 0 || v < 0 || w < 0) continue;
    const y = u * a[1] + v * b[1] + w * c[1];
    if (top === undefined || y > top) top = y;
  }
  return top;
}

/** Light positions from light objects the modeller named (`LeftNavLightOn`, `lhnavlite`). */
function namedLights(names: string[], tris: Tri[], objects: ObjectReport[]): Light[] {
  const out: Light[] = [];
  const kindOf = (n: string): LightKind | undefined => {
    if (/beacon|becon/i.test(n)) return /lower|bottom/i.test(n) ? 'beacon-bottom' : 'beacon-top';
    if (/strobe/i.test(n)) {
      return /left|^lh/i.test(n) ? 'strobe-left' : /right|^rh/i.test(n) ? 'strobe-right' : 'strobe-tail';
    }
    if (/nav/i.test(n)) {
      return /left|^lh/i.test(n) ? 'nav-left' : /right|^rh/i.test(n) ? 'nav-right' : 'nav-tail';
    }
    return undefined;
  };
  names.forEach((name, index) => {
    if (objects[index]!.cls !== 'light') return;
    const kind = kindOf(name);
    if (!kind || out.some((l) => l.kind === kind)) return;
    const pts = tris.filter((t) => t.object === index).flatMap((t) => [t.a, t.b, t.c]);
    if (pts.length === 0) return;
    const b = bounds(pts);
    out.push({
      kind,
      pos: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    });
  });
  return out;
}

/**
 * The tip section of one wing: everything within a few centimetres (or 1.5 %
 * of the span) of its outermost point. Nav lights sit at the middle of that
 * section's thickness, a little ahead of mid-chord; strobes a little behind.
 * Both are nudged outward by part of [radius] so the light sits *on* the tip
 * rather than half inside it.
 */
function wingtipLights(pts: Vec3[], box: Box, side: 'left' | 'right', radius: number): [Vec3, Vec3] {
  const span = box.max[0] - box.min[0];
  const band = Math.max(0.015 * span, 0.15);
  const edge = side === 'right' ? box.max[0] : box.min[0];
  const tip = pts.filter((p) => Math.abs(p[0] - edge) < band);
  const b = bounds(tip);
  const y = (b.min[1] + b.max[1]) / 2;
  const chord = b.max[2] - b.min[2];
  const midZ = (b.min[2] + b.max[2]) / 2;
  const x = edge + (side === 'right' ? 0.4 : -0.4) * radius;
  return [
    [x, y, midZ - 0.15 * chord],
    [x, y, midZ + 0.2 * chord],
  ];
}

/** Wingtips, tail and fuselage roof/belly from the airframe itself. */
function geometricLights(kept: Tri[], box: Box, radius: number): Light[] {
  const pts = kept.flatMap((t) => [t.a, t.b, t.c]);
  const len = box.max[2] - box.min[2];
  const span = box.max[0] - box.min[0];
  const cx = (box.min[0] + box.max[0]) / 2;
  const midZ = (box.min[2] + box.max[2]) / 2;
  const mean = (ps: Vec3[]): Vec3 => {
    const s = ps.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]);
    return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length];
  };
  const [navLeft, strobeLeft] = wingtipLights(pts, box, 'left', radius);
  const [navRight, strobeRight] = wingtipLights(pts, box, 'right', radius);
  const tail = mean(pts.filter((p) => p[2] > box.max[2] - 0.01 * len));
  const centre = pts.filter((p) => Math.abs(p[2] - midZ) < 0.1 * len && Math.abs(p[0] - cx) < 0.02 * span);
  const top = centre.reduce((a, p) => (p[1] > a[1] ? p : a), centre[0] ?? [cx, box.max[1], midZ]);
  const bottom = centre.reduce((a, p) => (p[1] < a[1] ? p : a), centre[0] ?? [cx, box.min[1], midZ]);
  return [
    { kind: 'nav-left', pos: navLeft },
    { kind: 'nav-right', pos: navRight },
    { kind: 'nav-tail', pos: tail },
    { kind: 'strobe-left', pos: strobeLeft },
    { kind: 'strobe-right', pos: strobeRight },
    { kind: 'strobe-tail', pos: tail },
    { kind: 'beacon-top', pos: top },
    { kind: 'beacon-bottom', pos: bottom },
  ];
}

function mergeLights(
  xml: Light[],
  named: Light[],
  geometric: Light[],
): { lights: Light[]; source: ProcessedModel['lightSource'] } {
  type Source = 'xml' | 'named' | 'geometry';
  const used = new Set<Source>();
  const lights: Light[] = [];
  for (const g of geometric) {
    const x = xml.find((l) => l.kind === g.kind);
    const n = named.find((l) => l.kind === g.kind);
    const [source, light]: [Source, Light] = x ? ['xml', x] : n ? ['named', n] : ['geometry', g];
    used.add(source);
    lights.push({ kind: g.kind, pos: [...light.pos] });
  }
  return { lights, source: used.size === 1 ? [...used][0]! : 'mixed' };
}

interface Welded {
  positions: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer> | null;
  indices: Uint32Array<ArrayBuffer>;
}

/**
 * Merges coincident vertices so the simplifier sees a connected surface.
 * Textured corners also key on their uv, so a texture seam keeps two
 * vertices at one position — which meshoptimizer recognises as a seam and
 * collapses without tearing.
 */
function weld(tris: Tri[]): Welded {
  const q = (n: number) => Math.round(n * 1e4);
  const textured = tris.length > 0 && tris[0]!.uv !== undefined;
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const t of tris) {
    const corner = [t.a, t.b, t.c].map((v, k) => {
      const uv = t.uv?.[k];
      const key = `${q(v[0])},${q(v[1])},${q(v[2])}${uv ? `|${q(uv[0])},${q(uv[1])}` : ''}`;
      let i = lookup.get(key);
      if (i === undefined) {
        i = positions.length / 3;
        lookup.set(key, i);
        positions.push(v[0], v[1], v[2]);
        if (textured) uvs.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
      }
      return i;
    });
    // Degenerate after welding (two corners on one vertex): nothing to draw.
    if (corner[0] === corner[1] || corner[1] === corner[2] || corner[0] === corner[2]) continue;
    indices.push(...corner);
  }
  return {
    positions: new Float32Array(positions),
    uvs: textured ? new Float32Array(uvs) : null,
    indices: new Uint32Array(indices),
  };
}

/**
 * Reduces to at most [targetTris]. Relaxes the error bound until the target is
 * met, so a budget is a guarantee rather than a hope. Textured meshes weigh
 * their uvs in, so windows and engine details don't smear across the hull.
 */
function simplify(mesh: Welded, targetTris: number): Welded {
  if (mesh.indices.length / 3 <= targetTris) return mesh;
  const run = (error: number): Uint32Array =>
    mesh.uvs
      ? MeshoptSimplifier.simplifyWithAttributes(
          mesh.indices,
          mesh.positions,
          3,
          mesh.uvs,
          2,
          [0.5, 0.5],
          null,
          targetTris * 3,
          error,
          [],
        )[0]
      : MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, targetTris * 3, error, [])[0];
  let indices: Uint32Array = mesh.indices;
  for (const error of [0.01, 0.03, 0.08, 0.2, 1]) {
    indices = run(error);
    if (indices.length / 3 <= targetTris) break;
  }
  if (indices.length / 3 > targetTris) {
    // Last resort for meshes of disconnected slivers the collapse can't touch.
    [indices] = MeshoptSimplifier.simplifySloppy(mesh.indices, mesh.positions, 3, null, targetTris * 3, 1);
  }
  return { positions: mesh.positions, uvs: mesh.uvs, indices: new Uint32Array(indices) };
}

const CREASE_COS = Math.cos((40 * Math.PI) / 180);

/**
 * Crease-angle normals: faces meeting at less than 40° share a smoothed
 * normal, sharper edges stay hard. Neighbours are found by position, not by
 * vertex, so a texture seam doesn't show up as a shading seam. Faces with
 * flipped winding (common in these files) meet at ~180° and so never average
 * each other away — the material is double-sided, so each still lights
 * correctly on its own.
 */
function shade(mesh: Welded): Mesh {
  const p = mesh.positions;
  const vert = (i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  const posKey = (i: number) => `${Math.round(p[i * 3]! * 1e4)},${Math.round(p[i * 3 + 1]! * 1e4)},${Math.round(p[i * 3 + 2]! * 1e4)}`;
  const faceCount = mesh.indices.length / 3;
  const faceNormals: Vec3[] = [];
  const faceAreaNormals: Vec3[] = [];
  const facesAt = new Map<string, number[]>();
  for (let f = 0; f < faceCount; f++) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[f * 3 + k]!);
    const n = cross(sub(vert(b!), vert(a!)), sub(vert(c!), vert(a!)));
    faceAreaNormals.push(n);
    faceNormals.push(normalize(n));
    for (const v of [a!, b!, c!]) {
      const key = posKey(v);
      const list = facesAt.get(key);
      if (list) list.push(f);
      else facesAt.set(key, [f]);
    }
  }

  const outPos: number[] = [];
  const outNorm: number[] = [];
  const outUv: number[] = [];
  const outIdx: number[] = [];
  const lookup = new Map<string, number>();
  for (let f = 0; f < faceCount; f++) {
    const fn = faceNormals[f]!;
    if (length(fn) === 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[f * 3 + k]!;
      let n: Vec3 = [0, 0, 0];
      for (const g of facesAt.get(posKey(v)) ?? []) {
        if (dot(faceNormals[g]!, fn) >= CREASE_COS) n = add(n, faceAreaNormals[g]!);
      }
      n = normalize(n);
      const key = `${v}|${n[0].toFixed(3)},${n[1].toFixed(3)},${n[2].toFixed(3)}`;
      let i = lookup.get(key);
      if (i === undefined) {
        i = outPos.length / 3;
        lookup.set(key, i);
        const pos = vert(v);
        outPos.push(pos[0], pos[1], pos[2]);
        outNorm.push(n[0], n[1], n[2]);
        if (mesh.uvs) outUv.push(mesh.uvs[v * 2]!, mesh.uvs[v * 2 + 1]!);
      }
      outIdx.push(i);
    }
  }
  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNorm),
    uvs: mesh.uvs ? new Float32Array(outUv) : null,
    indices: new Uint32Array(outIdx),
  };
}
