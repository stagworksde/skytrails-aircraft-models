// Dumps an AC3D file's objects — path, triangle count, bounding box — so a new
// model's part names can be reviewed before writing its config.
//
//   bun run inspect <file.ac>

import { parseAc3d } from '../src/ac3d';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun run inspect <file.ac>');
  process.exit(1);
}

const ac = parseAc3d(await Bun.file(file).text());
let total = 0;
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const o of ac.objects) {
  const tris = o.surfaces.reduce((s, f) => s + f.refs.length - 2, 0);
  total += tris;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of o.verts) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, v[i]!);
      hi[i] = Math.max(hi[i]!, v[i]!);
      min[i] = Math.min(min[i]!, v[i]!);
      max[i] = Math.max(max[i]!, v[i]!);
    }
  }
  const f = (a: number[]) => a.map((n) => n.toFixed(2).padStart(7)).join(' ');
  console.log(
    `${String(tris).padStart(5)}  ${f(lo)} | ${f(hi)}  ${[...o.path, o.name || '(unnamed)'].join('/')}`,
  );
}
console.log(`\n${ac.objects.length} objects, ${total} triangles, ${ac.materials.length} materials`);
console.log(`bbox min ${min.map((n) => n.toFixed(2))}  max ${max.map((n) => n.toFixed(2))}`);
