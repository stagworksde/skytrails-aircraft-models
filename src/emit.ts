// Writes a processed model as two GLBs:
//
// - `ac_<id>.glb`: the airframe (body/accent/glass, textured with the model's
//   neutral default paint where it has one — windows, cockpit, engine fans),
//   steady nav lights and prop discs.
// - `ac_<id>_strobe.glb`: only the flashing lights (wingtip/tail strobes and
//   beacons). Mapbox's ModelLayer plays no glTF animation, so the app blinks
//   these by toggling a second layer that shares the plane source.
//
// Container rules shared with the app's `tool/glb.dart`: every primitive is
// indexed with uint16 (Mapbox's native loader segfaults on a primitive without
// indices), materials are double-sided (winding in the sources is
// inconsistent), colours are the app's sRGB palette converted to linear.
// Material names are the surface names (`body`, `accent`, `glass`): the app's
// preview finds the materials to paint a livery onto by name.

import { Document, NodeIO, type Material, type Texture } from '@gltf-transform/core';
import type { LightKind } from './fgxml';
import type { Vec3 } from './frame';
import type { Mesh, ProcessedModel, Surface } from './process';
import type { PreparedTexture } from './textures';

/** The app's `cockpit` palette, as baked into `assets/models/ac_*.glb`. */
const surfaceColor: Record<Surface, number> = {
  body: 0xffe8eff8,
  accent: 0xff2f9bff,
  glass: 0xff22d3ee,
};
const PROP_DISC = 0x59b8c2cf;
const NAV_RED = 0xffff3b30;
const NAV_GREEN = 0xff34c759;
const WHITE = 0xffffffff;
const BEACON_RED = 0xffff2d2d;

const steady: Partial<Record<LightKind, number>> = {
  'nav-left': NAV_RED,
  'nav-right': NAV_GREEN,
  'nav-tail': WHITE,
};
const flashing: Partial<Record<LightKind, number>> = {
  'strobe-left': WHITE,
  'strobe-right': WHITE,
  'strobe-tail': WHITE,
  'beacon-top': BEACON_RED,
  'beacon-bottom': BEACON_RED,
};

function linear(argb: number): [number, number, number, number] {
  const ch = (shift: number) => {
    const s = ((argb >>> shift) & 0xff) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [ch(16), ch(8), ch(0), ((argb >>> 24) & 0xff) / 255];
}

interface EmitPart {
  mesh: Mesh;
  material: Material;
  name: string;
}

function addParts(doc: Document, parts: EmitPart[], nodeName: string): void {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const mesh = doc.createMesh(nodeName);
  for (const part of parts) {
    if (part.mesh.indices.length === 0) continue;
    const vertexCount = part.mesh.positions.length / 3;
    if (vertexCount > 0xffff) throw new Error(`${part.name}: ${vertexCount} vertices exceed uint16 indices`);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(part.mesh.positions).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(part.mesh.normals).setBuffer(buffer));
    if (part.mesh.uvs) {
      prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(part.mesh.uvs).setBuffer(buffer));
    }
    prim
      .setIndices(
        doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(part.mesh.indices)).setBuffer(buffer),
      )
      .setMaterial(part.material);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(nodeName).setMesh(mesh);
  doc.createScene().addChild(node);
}

function material(
  doc: Document,
  name: string,
  argb: number,
  opts: { emissive?: boolean; glossy?: boolean; texture?: Texture } = {},
) {
  const [r, g, b, a] = linear(argb);
  const m = doc
    .createMaterial(name)
    .setBaseColorFactor([r, g, b, a])
    .setMetallicFactor(opts.glossy ? 0.4 : 0.1)
    .setRoughnessFactor(opts.glossy ? 0.15 : 0.55)
    .setDoubleSided(true);
  if (a < 1) m.setAlphaMode('BLEND');
  if (opts.emissive) m.setEmissiveFactor([r, g, b]);
  // The tone multiplies the texture: white paint takes the tone, windows and
  // engine fans stay dark.
  if (opts.texture) m.setBaseColorTexture(opts.texture);
  return m;
}

/** A small octahedron: reads as a point of light from any angle, 8 triangles. */
function octahedron(center: Vec3, r: number): Mesh {
  const [x, y, z] = center;
  const v: Vec3[] = [
    [x + r, y, z],
    [x - r, y, z],
    [x, y + r, z],
    [x, y - r, z],
    [x, y, z + r],
    [x, y, z - r],
  ];
  const faces = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  return flatMesh(faces.map((f) => f.map((i) => v[i]!) as [Vec3, Vec3, Vec3]));
}

/** A thin disc facing along Z (the flight axis), 20 segments, both faces. */
function disc(center: Vec3, radius: number): Mesh {
  const tris: [Vec3, Vec3, Vec3][] = [];
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p0: Vec3 = [center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius, center[2]];
    const p1: Vec3 = [center[0] + Math.cos(a1) * radius, center[1] + Math.sin(a1) * radius, center[2]];
    tris.push([center, p0, p1]);
  }
  return flatMesh(tris);
}

function flatMesh(tris: [Vec3, Vec3, Vec3][]): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (const p of [a, b, c]) {
      positions.push(...p);
      normals.push(n[0]! / l, n[1]! / l, n[2]! / l);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: null,
    indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
  };
}

function merge(meshes: Mesh[]): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    normals.push(...m.normals);
    indices.push(...Array.from(m.indices, (i) => i + base));
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: null,
    indices: new Uint32Array(indices),
  };
}

export interface Provenance {
  /** `asset.copyright`: who made the original, under which licence. */
  copyright: string;
  /** `asset.extras`: what was changed, from what, when (GPL v2 §2(a)). */
  extras: Record<string, unknown>;
}

function newDocument(p: Provenance): Document {
  const doc = new Document();
  doc.createBuffer();
  const asset = doc.getRoot().getAsset();
  asset.generator = 'skytrails-aircraft-models';
  asset.copyright = p.copyright;
  asset.extras = p.extras;
  return doc;
}

const io = new NodeIO();

export async function emitMain(
  model: ProcessedModel,
  p: Provenance,
  textures: ReadonlyMap<string, PreparedTexture>,
): Promise<Uint8Array> {
  const doc = newDocument(p);
  const gltfTextures = new Map<string, Texture>();
  const textureFor = (name: string | undefined): Texture | undefined => {
    if (!name) return undefined;
    const prepared = textures.get(name);
    if (!prepared) return undefined;
    let t = gltfTextures.get(name);
    if (!t) {
      t = doc
        .createTexture(name.replace(/\.[^.]+$/, ''))
        .setImage(prepared.bytes)
        .setMimeType(prepared.mimeType);
      gltfTextures.set(name, t);
    }
    return t;
  };
  const parts: EmitPart[] = model.parts.map((part) => {
    const texture = part.mesh.uvs ? textureFor(part.texture) : undefined;
    return {
      name: part.surface,
      // A textured part without its texture would sample nothing: drop the uvs.
      mesh: texture ? part.mesh : { ...part.mesh, uvs: null },
      material: material(doc, part.surface, surfaceColor[part.surface], {
        glossy: part.surface === 'glass',
        ...(texture ? { texture } : {}),
      }),
    };
  });
  for (const [kind, color] of Object.entries(steady) as [LightKind, number][]) {
    const light = model.lights.find((l) => l.kind === kind);
    if (!light) continue;
    parts.push({
      name: kind,
      mesh: octahedron(light.pos, model.lightRadius),
      material: material(doc, kind, color, { emissive: true }),
    });
  }
  if (model.props.length > 0) {
    parts.push({
      name: 'prop-disc',
      mesh: merge(model.props.map((d) => disc(d.center, d.radius))),
      material: material(doc, 'prop-disc', PROP_DISC),
    });
  }
  addParts(doc, parts, model.spec.id);
  return io.writeBinary(doc);
}

export async function emitStrobe(model: ProcessedModel, p: Provenance): Promise<Uint8Array> {
  const doc = newDocument(p);
  const byColor = new Map<number, Mesh[]>();
  for (const [kind, color] of Object.entries(flashing) as [LightKind, number][]) {
    const light = model.lights.find((l) => l.kind === kind);
    if (!light) continue;
    // Strobes a touch larger than the steady lights: they are meant to pop.
    const list = byColor.get(color) ?? [];
    list.push(octahedron(light.pos, model.lightRadius * 1.1));
    byColor.set(color, list);
  }
  const parts: EmitPart[] = [...byColor].map(([color, meshes]) => {
    const name = color === WHITE ? 'strobe' : 'beacon';
    return { name, mesh: merge(meshes), material: material(doc, name, color, { emissive: true }) };
  });
  addParts(doc, parts, `${model.spec.id}_strobe`);
  return io.writeBinary(doc);
}
