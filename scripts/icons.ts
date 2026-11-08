// Renders one small side-view picture per built model, for places that
// cannot draw 3D: the app's Live Activity (an iOS widget extension) and its
// Android flight notification.
//
//   bun run build && bun run icons                    # → out/models/ac_<id>_icon-<hash>.png, named in the manifest
//   bun run icons --shapes ../skylog/assets/models --out <dir>
//                                                      # → <dir>/plane_<shape>.png from the app's own ac_<shape>.glb
//
// The first form's pictures are renders of GPL models, so they are release
// assets the app downloads, like the GLBs, and never part of the app
// bundle. The second form renders the app's own hand-built shapes, which
// are the app's to bundle.
//
// Same renderer as `snapshot` (three.js in headless Chromium, software GL),
// on a transparent background, a few models per Chromium run (its time
// budget), then cut apart and trimmed with ImageMagick.

import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const port = 8792;
const cellW = 640;
const cellH = 320;
/// Final size: fits inside this box, aspect kept. About 3× the largest
/// place it is shown (22 pt high on the Lock Screen).
const outW = 240;
const outH = 96;
const perRun = 4;

interface Job {
  id: string;
  /// Paths under `/files/`.
  files: string[];
  target: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const shapesDir = flag('--shapes');
const outDir = flag('--out');

const tmp = resolve('out/.icons');
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });

let roots: Record<string, string>;
let jobs: Job[];
type Manifest = { models: Record<string, Record<string, unknown> & { file: string; strobeFile: string }> };
let manifest: Manifest | null = null;

if (shapesDir != null) {
  if (outDir == null) throw new Error('--shapes needs --out <dir>');
  await mkdir(outDir, { recursive: true });
  roots = { shapes: resolve(shapesDir) };
  jobs = (await readdir(shapesDir))
    .filter((f) => /^ac_[a-z0-9]+\.glb$/.test(f))
    .sort()
    .map((f) => {
      const id = basename(f, '.glb').slice(3);
      return { id, files: [`shapes/${f}`], target: resolve(outDir, `plane_${id}.png`) };
    });
} else {
  manifest = (await Bun.file('out/manifest.json').json()) as Manifest;
  roots = { models: resolve('out/models') };
  for (const f of await readdir('out/models')) if (/_icon-[0-9a-f]+\.png$/.test(f)) await rm(`out/models/${f}`);
  jobs = Object.entries(manifest.models).map(([id, m]) => ({
    id,
    // No strobes: lights switched on read as specks at this size.
    files: [`models/${m.file}`],
    target: resolve(tmp, `${id}.png`),
  }));
}

const pageFor = (batch: Job[]) => `<!doctype html>
<html><head><style>html,body{margin:0;background:transparent}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const models = ${JSON.stringify(batch.map((j) => ({ files: j.files })))};
const W = ${cellW}, H = ${cellH};
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setSize(W, H * models.length);
renderer.setScissorTest(true);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader();
const load = (f) => new Promise((ok, err) => loader.load('/files/' + f, (g) => ok(g.scene), undefined, err));
for (let row = 0; row < models.length; row++) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-3, 5, -2);
  scene.add(sun);
  for (const f of models[row].files) scene.add(await load(f));
  const box = new THREE.Box3().setFromObject(scene);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  // From the side, a little above and a little ahead: the fuselage reads as
  // a profile, and the far wing still shows.
  const dir = new THREE.Vector3(-1, 0.16, -0.22).normalize();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 6);
  cam.position.copy(centre).addScaledVector(dir, radius * 3);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  // Fit the box's corners as the camera sees them, at the cell's aspect.
  let halfW = 0, halfH = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    halfW = Math.max(halfW, Math.abs(p.x));
    halfH = Math.max(halfH, Math.abs(p.y));
  }
  const half = Math.max(halfW, halfH * (W / H)) * 1.04;
  cam.left = -half; cam.right = half; cam.top = half * (H / W); cam.bottom = -half * (H / W);
  cam.updateProjectionMatrix();
  const y = (models.length - 1 - row) * H;
  renderer.setViewport(0, y, W, H);
  renderer.setScissor(0, y, W, H);
  renderer.render(scene, cam);
}
document.title = 'done';
</script></body></html>`;

let page = '';
const server = Bun.serve({
  port,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === '/') return new Response(page, { headers: { 'content-type': 'text/html' } });
    if (path.startsWith('/three/')) return new Response(Bun.file(`node_modules/three/${path.slice(7)}`));
    if (path.startsWith('/files/')) {
      const [root, ...rest] = path.slice(7).split('/');
      const dir = roots[root ?? ''];
      const name = rest.join('/');
      if (dir != null && !name.includes('..')) return new Response(Bun.file(`${dir}/${name}`));
    }
    return new Response('not found', { status: 404 });
  },
});

const chromium = Bun.which('chromium') ?? Bun.which('chromium-browser') ?? Bun.which('google-chrome');
if (!chromium) throw new Error('needs Chromium for the headless render');

async function run(...cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} failed: ${err.trim()}`);
  return err;
}

/// Renders [batch] and cuts it into its targets. Returns the jobs whose
/// picture came back empty: Chromium's time budget ran out before a heavy
/// model had loaded.
async function render(batch: Job[], tag: string): Promise<Job[]> {
  page = pageFor(batch);
  // The snap-packaged Chromium can only write under $HOME.
  const sheet = resolve(tmp, `sheet-${tag}.png`);
  const log = await run(
    chromium!,
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--default-background-color=00000000',
    '--enable-logging=stderr',
    '--v=0',
    `--window-size=${cellW},${cellH * batch.length}`,
    '--virtual-time-budget=60000',
    `--screenshot=${sheet}`,
    `http://localhost:${port}/`,
  );
  for (const line of log.split('\n')) if (/CONSOLE|Uncaught/.test(line)) console.error(line);
  const blank: Job[] = [];
  for (const [row, job] of batch.entries()) {
    await run(
      'magick', sheet,
      '-crop', `${cellW}x${cellH}+0+${row * cellH}`, '+repage',
      '-trim', '+repage',
      '-resize', `${outW}x${outH}`,
      '-strip',
      `PNG32:${job.target}`,
    );
    // A fully transparent cell trims down to a single pixel.
    if (Bun.file(job.target).size < 400) blank.push(job);
  }
  return blank;
}

try {
  const blank: Job[] = [];
  for (let start = 0; start < jobs.length; start += perRun) {
    blank.push(...(await render(jobs.slice(start, start + perRun), `${start}`)));
  }
  // Alone, a model has the whole budget.
  for (const job of blank) {
    if ((await render([job], `retry-${job.id}`)).length > 0) {
      throw new Error(`${job.id}: the render came back empty`);
    }
  }
} finally {
  server.stop(true);
}

if (manifest != null) {
  for (const job of jobs) {
    const bytes = await Bun.file(job.target).bytes();
    const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const file = `ac_${job.id}_icon-${sha.slice(0, 8)}.png`;
    await Bun.write(`out/models/${file}`, bytes);
    Object.assign(manifest.models[job.id]!, { iconFile: file, iconSha256: sha, iconBytes: bytes.length });
  }
  await Bun.write('out/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
}
await rm(tmp, { recursive: true, force: true });
console.log(`${jobs.length} icons → ${shapesDir != null ? outDir : 'out/models, named in out/manifest.json'}`);
