// Minimal AC3D (.ac) reader: enough of the format to pull geometry and the
// object hierarchy out of FlightGear's AI traffic models.
//
// Keeps each object's texture name and the per-corner texture coordinates
// (with `texrep`/`texoff` applied), so the build can draw the neutral default
// paint's windows and details. Creases and URLs are parsed past and dropped.
// Line surfaces are skipped; only polygon surfaces become geometry.

import type { Vec3 } from './frame';
export type { Vec3 };

export interface AcMaterial {
  name: string;
  rgb: Vec3;
  transparency: number;
}

export interface AcSurface {
  /** Index into [AcFile.materials]. */
  mat: number;
  /** Vertex indices into the owning object's [AcObject.verts]. */
  refs: number[];
  /** Texture coordinate per ref, AC3D convention (v = 0 at the bottom). */
  uvs: [number, number][];
}

export interface AcObject {
  /** The object's own name; group objects without one get "". */
  name: string;
  /** Ancestor names, outermost first (excluding the synthetic world root). */
  path: string[];
  /** Vertices already transformed into the file's world space. */
  verts: Vec3[];
  surfaces: AcSurface[];
  /** File name of the object's texture, if it has one. */
  texture?: string;
}

export interface AcFile {
  materials: AcMaterial[];
  /** Every object in the file, flattened in file order. */
  objects: AcObject[];
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

interface Frame {
  rot: Mat3;
  loc: Vec3;
}

function apply(frame: Frame, v: Vec3): Vec3 {
  const [a, b, c, d, e, f, g, h, i] = frame.rot;
  return [
    a * v[0] + b * v[1] + c * v[2] + frame.loc[0],
    d * v[0] + e * v[1] + f * v[2] + frame.loc[1],
    g * v[0] + h * v[1] + i * v[2] + frame.loc[2],
  ];
}

/// parent ∘ child: a point in child space → parent's parent space.
function compose(parent: Frame, child: Frame): Frame {
  const p = parent.rot;
  const c = child.rot;
  const rot: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += p[r * 3 + k]! * c[k * 3 + col]!;
      rot[r * 3 + col] = s;
    }
  }
  return { rot, loc: apply(parent, child.loc) };
}

/** Splits a line into tokens, keeping double-quoted strings together. */
function tokens(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2]!);
  return out;
}

export function parseAc3d(text: string): AcFile {
  const lines = text.split(/\r?\n/);
  let pos = 0;
  const next = (): string | undefined => lines[pos++];

  const header = next();
  if (!header?.startsWith('AC3D')) throw new Error('not an AC3D file');

  const materials: AcMaterial[] = [];
  const objects: AcObject[] = [];

  const readObject = (parentFrame: Frame, path: string[]): void => {
    let name = '';
    const local: Frame = { rot: [...identity] as Mat3, loc: [0, 0, 0] };
    let rawVerts: Vec3[] = [];
    const surfaces: AcSurface[] = [];
    let texture: string | undefined;
    let texrep: [number, number] = [1, 1];
    let texoff: [number, number] = [0, 0];
    let kids = 0;

    for (;;) {
      const line = next();
      if (line === undefined) throw new Error('unexpected end of file inside OBJECT');
      const t = tokens(line.trim());
      const key = t[0];
      if (key === undefined) continue;
      switch (key) {
        case 'name':
          name = t[1] ?? '';
          break;
        case 'data': {
          // `data <len>` is followed by <len> characters of free text, which
          // may span lines.
          const len = Number(t[1]);
          let read = 0;
          while (read < len) {
            const l = next();
            if (l === undefined) break;
            read += l.length + 1;
          }
          break;
        }
        case 'texture':
          // Only the first texture counts (AC3D allows one per object). Just
          // the file name: FlightGear resolves it against the model's texture
          // path, and some files carry the modeller's absolute path
          // (`F:/My FlightGear/…/223-tex.png`).
          if (t[1]) texture ??= t[1].split(/[\\/]/).pop();
          break;
        case 'texrep':
          texrep = [Number(t[1]), Number(t[2])];
          break;
        case 'texoff':
          texoff = [Number(t[1]), Number(t[2])];
          break;
        case 'rot':
          local.rot = t.slice(1, 10).map(Number) as Mat3;
          break;
        case 'loc':
          local.loc = [Number(t[1]), Number(t[2]), Number(t[3])];
          break;
        case 'numvert': {
          const n = Number(t[1]);
          rawVerts = new Array(n);
          for (let i = 0; i < n; i++) {
            const v = tokens(next()!.trim());
            rawVerts[i] = [Number(v[0]), Number(v[1]), Number(v[2])];
          }
          break;
        }
        case 'numsurf': {
          const n = Number(t[1]);
          for (let s = 0; s < n; s++) {
            let flags = 0;
            let mat = 0;
            const refs: number[] = [];
            const uvs: [number, number][] = [];
            for (;;) {
              const st = tokens(next()!.trim());
              if (st[0] === 'SURF') {
                flags = Number(st[1]);
              } else if (st[0] === 'mat') {
                mat = Number(st[1]);
              } else if (st[0] === 'refs') {
                const k = Number(st[1]);
                for (let r = 0; r < k; r++) {
                  const ref = tokens(next()!.trim());
                  refs.push(Number(ref[0]));
                  uvs.push([Number(ref[1] ?? 0), Number(ref[2] ?? 0)]);
                }
                break;
              }
            }
            // Low nibble is the surface type: 0 = polygon, 1/2 = lines.
            if ((flags & 0x0f) === 0 && refs.length >= 3) {
              surfaces.push({
                mat,
                refs,
                uvs: uvs.map(([u, v]) => [u * texrep[0] + texoff[0], v * texrep[1] + texoff[1]]),
              });
            }
          }
          break;
        }
        case 'kids':
          kids = Number(t[1]);
          break;
        default:
          // texture, texrep, texoff, crease, url, subdiv, hidden, locked, folded…
          break;
      }
      if (key === 'kids') break;
    }

    const frame = compose(parentFrame, local);
    if (rawVerts.length > 0 || surfaces.length > 0) {
      objects.push({
        name,
        path,
        verts: rawVerts.map((v) => apply(frame, v)),
        surfaces,
        ...(texture ? { texture } : {}),
      });
    }
    const childPath = name ? [...path, name] : path;
    for (let k = 0; k < kids; k++) {
      // Real files overstate `kids` (c172p.ac's world claims 71, has 69), so
      // running out of objects ends the list instead of failing.
      let header = next();
      while (header !== undefined && !header.trim().startsWith('OBJECT')) header = next();
      if (header === undefined) break;
      readObject(frame, childPath);
    }
  };

  const root: Frame = { rot: [...identity] as Mat3, loc: [0, 0, 0] };
  for (;;) {
    const line = next();
    if (line === undefined) break;
    const t = tokens(line.trim());
    if (t[0] === 'MATERIAL') {
      const get = (key: string, n: number): number[] => {
        const i = t.indexOf(key);
        return i < 0 ? new Array(n).fill(0) : t.slice(i + 1, i + 1 + n).map(Number);
      };
      const rgb = get('rgb', 3) as Vec3;
      materials.push({ name: t[1] ?? '', rgb, transparency: get('trans', 1)[0] ?? 0 });
    } else if (t[0] === 'OBJECT') {
      // The top-level `world` object: its own name is not part of any path.
      readObject(root, []);
    }
  }

  return { materials, objects };
}
