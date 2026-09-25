// Contact sheet: every model from above, the side and the front, painted by
// surface. This is the QA step — gear gone, lights on the tips, fin painted,
// prop discs in place — before a release.

import type { Vec3 } from './frame';
import type { Mesh, ProcessedModel } from './process';

const CELL = 260;
const PAD = 16;
const LABEL = 44;

const fill: Record<string, string> = {
  body: '#e8eff8',
  accent: '#2f9bff',
  glass: '#22d3ee',
  prop: '#b8c2cf',
  'nav-left': '#ff3b30',
  'nav-right': '#34c759',
  'nav-tail': '#ffffff',
  strobe: '#ffffff',
  beacon: '#ff2d2d',
};

interface View {
  name: string;
  /** Screen x/y (y down) and depth (larger = nearer the viewer). */
  project: (v: Vec3) => [number, number, number];
  /** Direction towards the viewer, for shading. */
  eye: Vec3;
}

const views: View[] = [
  { name: 'top', project: (v) => [v[0], v[2], v[1]], eye: [0, 1, 0] },
  { name: 'side', project: (v) => [v[2], -v[1], -v[0]], eye: [-1, 0, 0] },
  { name: 'front', project: (v) => [v[0], -v[1], -v[2]], eye: [0, 0, -1] },
];

interface Poly {
  pts: [number, number][];
  depth: number;
  color: string;
  shade: number;
  stroke?: string;
}

function trianglesOf(mesh: Mesh): [Vec3, Vec3, Vec3, Vec3][] {
  const out: [Vec3, Vec3, Vec3, Vec3][] = [];
  const p = mesh.positions;
  const n = mesh.normals;
  const v = (i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  const nn = (i: number): Vec3 => [n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const na = nn(a);
    out.push([v(a), v(b), v(c), na]);
  }
  return out;
}

function hex(color: string, shade: number): string {
  const c = Number.parseInt(color.slice(1), 16);
  const ch = (s: number) =>
    Math.round(((c >> s) & 0xff) * shade)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function renderModel(model: ProcessedModel, ox: number, oy: number): string {
  const out: string[] = [];
  const allPts = model.parts.flatMap((p) => trianglesOf(p.mesh).flatMap((t) => [t[0], t[1], t[2]]));
  const extent = Math.max(model.size.length, model.size.span, model.size.height);
  const scale = (CELL - 2 * PAD) / extent;

  views.forEach((view, col) => {
    const polys: Poly[] = [];
    for (const part of model.parts) {
      const s = part.surface;
      for (const [a, b, c, n] of trianglesOf(part.mesh)) {
        const pa = view.project(a);
        const pb = view.project(b);
        const pc = view.project(c);
        const light = Math.abs(n[0] * view.eye[0] + n[1] * view.eye[1] + n[2] * view.eye[2]);
        polys.push({
          pts: [pa, pb, pc].map((q) => [q[0], q[1]] as [number, number]),
          depth: (pa[2] + pb[2] + pc[2]) / 3,
          color: fill[s]!,
          shade: 0.45 + 0.55 * light,
        });
      }
    }
    for (const d of model.props) {
      const c = view.project(d.center);
      const r = d.radius;
      // Discs face along Z: a circle from the front, a line from above/side.
      const pts: [number, number][] =
        view.name === 'front'
          ? Array.from({ length: 20 }, (_, i) => {
              const a = (i / 20) * Math.PI * 2;
              return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
            })
          : view.name === 'top'
            ? [
                [c[0] - r, c[1]],
                [c[0] + r, c[1]],
              ]
            : [
                [c[0], c[1] - r],
                [c[0], c[1] + r],
              ];
      polys.push({ pts, depth: c[2] + 1e6, color: fill.prop!, shade: 1, stroke: '#7f8a99' });
    }
    polys.sort((p, q) => p.depth - q.depth);

    // Fit: centre the projected airframe in the cell.
    const proj = allPts.map((v) => view.project(v));
    const minX = Math.min(...proj.map((q) => q[0]));
    const maxX = Math.max(...proj.map((q) => q[0]));
    const minY = Math.min(...proj.map((q) => q[1]));
    const maxY = Math.max(...proj.map((q) => q[1]));
    const cx = ox + col * CELL + CELL / 2 - ((minX + maxX) / 2) * scale;
    const cy = oy + LABEL + (CELL - LABEL) / 2 - ((minY + maxY) / 2) * scale;
    const xy = ([x, y]: [number, number]) => `${(cx + x * scale).toFixed(1)},${(cy + y * scale).toFixed(1)}`;

    out.push(`<rect x="${ox + col * CELL}" y="${oy}" width="${CELL}" height="${CELL}" fill="#16202c"/>`);
    for (const p of polys) {
      if (p.pts.length === 2) {
        out.push(`<polyline points="${p.pts.map(xy).join(' ')}" stroke="${p.stroke}" stroke-width="2"/>`);
      } else {
        const colour = hex(p.color, p.shade);
        out.push(
          `<polygon points="${p.pts.map(xy).join(' ')}" fill="${colour}" stroke="${colour}" stroke-width="0.4"${p.stroke ? ` fill-opacity="0.5"` : ''}/>`,
        );
      }
    }
    for (const l of model.lights) {
      const [x, y] = view.project(l.pos);
      const color = l.kind.startsWith('nav') ? fill[l.kind]! : l.kind.startsWith('beacon') ? fill.beacon! : fill.strobe!;
      const ring = l.kind.startsWith('nav') ? '' : ' stroke="#ffcc00" stroke-width="1.5"';
      out.push(`<circle cx="${(cx + x * scale).toFixed(1)}" cy="${(cy + y * scale).toFixed(1)}" r="3.5" fill="${color}"${ring}/>`);
    }
    out.push(
      `<text x="${ox + col * CELL + 8}" y="${oy + CELL - 8}" fill="#7f8a99" font-size="11" font-family="sans-serif">${view.name}</text>`,
    );
  });

  const s = model.size;
  out.push(
    `<text x="${ox + 8}" y="${oy + 18}" fill="#ffffff" font-size="14" font-weight="bold" font-family="sans-serif">${model.spec.id}</text>`,
    `<text x="${ox + 8}" y="${oy + 34}" fill="#b8c2cf" font-size="11" font-family="sans-serif">` +
      `${model.trisBefore}→${model.trisAfter} tris · ${s.length.toFixed(1)}×${s.span.toFixed(1)}×${s.height.toFixed(1)} m · ` +
      `lights: ${model.lightSource} · fin: ${model.finFound} · props: ${model.props.length}</text>`,
  );
  return out.join('\n');
}

export function contactSheet(models: ProcessedModel[]): string {
  const width = CELL * views.length;
  const height = CELL * models.length;
  const body = models.map((m, i) => renderModel(m, 0, i * CELL)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>\n`;
}
