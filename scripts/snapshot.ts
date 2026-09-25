// Renders every built model for real — textures, lights, materials as a glTF
// viewer draws them — into `out/snapshot.png`: one row per model, seen from
// the front-left, the side, above and below. The SVG contact sheet only shows
// geometry and paint classes; this is the check for textures and lights.
//
//   bun run build && bun run snapshot
//
// three.js in headless Chromium with its software GL (SwiftShader), so it
// needs no GPU. Strobes and beacons are drawn switched on.

import { resolve } from 'node:path';

const port = 8791;
const manifest = (await Bun.file('out/manifest.json').json()) as {
  models: Record<string, { file: string; strobeFile: string }>;
};
// `bun run snapshot [id…]`: all models, or just the ids given (a render of
// all 30-odd in one screenshot is taller than Chromium will capture).
const wanted = process.argv.slice(2);
const ids = Object.keys(manifest.models).filter((id) => wanted.length === 0 || wanted.includes(id));

const page = `<!doctype html>
<html><head><style>html,body{margin:0;background:#16202c}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const models = ${JSON.stringify(ids.map((id) => ({ id, ...manifest.models[id] })))};
const cell = 300, cols = 4;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(cell * cols, cell * models.length);
renderer.setScissorTest(true);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader();
const load = (f) => new Promise((ok, err) => loader.load('/models/' + f, (g) => ok(g.scene), undefined, err));
const views = [[-1, 0.45, -1], [-1, 0.05, 0], [0.001, 1, 0], [0.4, -0.8, -0.6]];
for (let row = 0; row < models.length; row++) {
  const m = models[row];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16202c);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-3, 5, -2);
  scene.add(sun);
  scene.add(await load(m.file));
  scene.add(await load(m.strobeFile));
  const box = new THREE.Box3().setFromObject(scene);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  views.forEach((d, col) => {
    const cam = new THREE.PerspectiveCamera(35, 1, radius / 50, radius * 10);
    const dir = new THREE.Vector3(...d).normalize();
    cam.position.copy(centre).addScaledVector(dir, radius / Math.sin((35 * Math.PI) / 360) * 0.9);
    cam.lookAt(centre);
    const y = (models.length - 1 - row) * cell;
    renderer.setViewport(col * cell, y, cell, cell);
    renderer.setScissor(col * cell, y, cell, cell);
    renderer.render(scene, cam);
  });
}
document.title = 'done';
</script></body></html>`;

const server = Bun.serve({
  port,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/') return new Response(page, { headers: { 'content-type': 'text/html' } });
    if (path.startsWith('/three/')) return new Response(Bun.file(`node_modules/three/${path.slice(7)}`));
    if (path.startsWith('/models/')) return new Response(Bun.file(`out/models/${path.slice(8)}`));
    return new Response('not found', { status: 404 });
  },
});

const chromium = Bun.which('chromium') ?? Bun.which('chromium-browser') ?? Bun.which('google-chrome');
if (!chromium) throw new Error('needs Chromium for the headless render');
// The snap-packaged Chromium can only write under $HOME.
const target = resolve('out/snapshot.png');
// Async spawn: a blocking one would stall the server Chromium is loading from.
const proc = Bun.spawn(
  [
    chromium,
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--enable-logging=stderr',
    '--v=0',
    `--window-size=${300 * 4},${300 * ids.length}`,
    '--virtual-time-budget=60000',
    `--screenshot=${target}`,
    `http://localhost:${port}/`,
  ],
  { stdout: 'pipe', stderr: 'pipe' },
);
const code = await proc.exited;
server.stop(true);
const log = await new Response(proc.stderr).text();
if (code !== 0) throw new Error(log);
// Page errors (a GLB three.js can't load) would otherwise only show up as
// blank rows.
for (const line of log.split('\n')) if (/CONSOLE|Uncaught|Error/.test(line)) console.error(line);
console.log(`${ids.length} models → ${target}`);

