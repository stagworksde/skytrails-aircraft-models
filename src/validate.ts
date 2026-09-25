// Hard checks on the written GLBs, read back from bytes — what ships is what
// gets checked. Any error fails the build.

import { NodeIO } from '@gltf-transform/core';
import type { ModelSpec } from '../models';
import type { ProcessedModel } from './process';

const io = new NodeIO();

const airframeMaterials = new Set(['body', 'accent', 'glass']);

export interface Validation {
  errors: string[];
  warnings: string[];
}

export async function validate(
  spec: ModelSpec,
  model: ProcessedModel,
  main: Uint8Array,
  strobe: Uint8Array,
): Promise<Validation> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let airframeTris = 0;
  for (const [label, bytes] of [
    ['main', main],
    ['strobe', strobe],
  ] as const) {
    const doc = await io.readBinary(bytes);
    const root = doc.getRoot();
    // Only the neutral default paint, and never on the flashing lights.
    const textures = root.listTextures().length;
    if (label === 'strobe' && textures > 0) errors.push('strobe: has textures');
    if (textures > 4) errors.push(`${label}: ${textures} textures (max 4)`);
    if (root.listAnimations().length > 0) errors.push(`${label}: has animations`);
    if (root.listSkins().length > 0) errors.push(`${label}: has skins`);
    if (root.listCameras().length > 0) errors.push(`${label}: has cameras`);
    let prims = 0;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        prims++;
        const name = prim.getMaterial()?.getName() ?? '?';
        const indices = prim.getIndices();
        // Mapbox's native model loader segfaults on a primitive without indices.
        if (!indices) errors.push(`${label}/${name}: primitive without indices`);
        const vertices = prim.getAttribute('POSITION')?.getCount() ?? 0;
        if (vertices > 0xffff) errors.push(`${label}/${name}: ${vertices} vertices exceed uint16`);
        if (label === 'main' && airframeMaterials.has(name)) airframeTris += (indices?.getCount() ?? 0) / 3;
      }
    }
    if (prims === 0) errors.push(`${label}: no primitives`);
  }

  if (airframeTris > spec.budget) errors.push(`${airframeTris} triangles exceed budget ${spec.budget}`);

  const off = model.size.length / spec.lengthM - 1;
  if (Math.abs(off) > 0.1) {
    errors.push(`length ${model.size.length.toFixed(2)} m is ${(off * 100).toFixed(0)} % off ${spec.lengthM} m`);
  }

  // Orientation: nose along -Z, right wing along +X. The light positions come
  // from the source's own frame, so they catch an axis mix-up.
  const at = (kind: string) => model.lights.find((l) => l.kind === kind)?.pos;
  const left = at('nav-left');
  const right = at('nav-right');
  const tail = at('nav-tail');
  if (!left || !right || !tail) errors.push('missing nav lights');
  else {
    if (!(left[0] < 0 && right[0] > 0)) errors.push('wingtips on the wrong sides (X mirrored)');
    if (!(tail[2] > 0)) errors.push('tail light not aft (nose not along -Z)');
  }

  if (!model.objects.some((o) => o.cls === 'gear')) warnings.push('no gear objects found');
  if (model.finFound === 'none') warnings.push('fin not found: no accent on the tail');

  return { errors, warnings };
}
