// Reads the two things the pipeline needs from FlightGear model XML: which
// objects are the landing gear, and where the lights are.
//
// Everything else in these files (liveries via `texture-path`, effects,
// animations) is ignored by design — the output has no textures and no
// animation.

import { XMLParser } from 'fast-xml-parser';
import { fgToGltf, type Vec3 } from './frame';

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => ['animation', 'object-name', 'model'].includes(name),
  parseTagValue: false,
  trimValues: true,
});

type Node = Record<string, unknown>;

function asNodes(v: unknown): Node[] {
  return Array.isArray(v) ? (v as Node[]) : [];
}

/**
 * Object names hidden by a `select` animation keyed on airspeed or gear
 * position — FlightGear's AI models all retract their gear this way. Other
 * animation types are ignored: a `rotate` on airspeed pitches the whole model.
 */
export function gearObjectNames(xml: string): Set<string> {
  const root = (parser.parse(xml) as Node).PropertyList as Node | undefined;
  const out = new Set<string>();
  for (const anim of asNodes(root?.animation)) {
    if (String(anim.type ?? '').trim() !== 'select') continue;
    if (!/airspeed|velocities|gear/i.test(JSON.stringify(anim.condition ?? ''))) continue;
    for (const n of asNodes(anim['object-name'])) out.add(String(n).trim());
  }
  return out;
}

export type LightKind =
  | 'nav-left'
  | 'nav-right'
  | 'nav-tail'
  | 'strobe-left'
  | 'strobe-right'
  | 'strobe-tail'
  | 'beacon-top'
  | 'beacon-bottom';

export interface Light {
  kind: LightKind;
  /** glTF frame, metres, before the model is recentred. */
  pos: Vec3;
}

const kinds: LightKind[] = [
  'nav-left',
  'nav-right',
  'nav-tail',
  'strobe-left',
  'strobe-right',
  'strobe-tail',
  'beacon-top',
  'beacon-bottom',
];

/** Light positions from a `*-NavLights.xml` (procedural ALS lights). */
export function lightPositions(xml: string): Light[] {
  const root = (parser.parse(xml) as Node).PropertyList as Node | undefined;
  const out: Light[] = [];
  for (const model of asNodes(root?.model)) {
    const name = String(model.name ?? '').trim();
    const kind = kinds.find((k) => name === k);
    const offsets = model.offsets as Node | undefined;
    if (!kind || !offsets) continue;
    const num = (key: string) => Number.parseFloat(String(offsets[key] ?? '0'));
    out.push({ kind, pos: fgToGltf([num('x-m'), num('y-m'), num('z-m')]) });
  }
  return out;
}
