// Copies the FlightGear files every model in `models.ts` is built from into
// `sources/fgdata/`, at the pinned commit, together with who wrote them.
//
//   bun run fetch
//
// `sources/` is committed: it is the "complete corresponding source" the GPL
// asks for, shipped in the same place as the built models. Only the files the
// build actually reads are copied: the geometry, the XML, and the neutral
// default paint scheme's textures — never an airline livery.

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FGDATA_COMMIT, models } from '../models';
import { parseAc3d } from '../src/ac3d';

const PROJECT = 'flightgear%2Ffgdata';
const RAW = `https://gitlab.com/flightgear/fgdata/-/raw/${FGDATA_COMMIT}`;
const API = `https://gitlab.com/api/v4/projects/${PROJECT}/repository`;
const OUT = 'sources/fgdata';

async function download(path: string, to: string): Promise<void> {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`${res.status} fetching ${path}`);
  await mkdir(dirname(to), { recursive: true });
  await Bun.write(to, await res.arrayBuffer());
}

interface Commit {
  author_name: string;
  authored_date: string;
  title: string;
}

/** Every commit touching [path] up to the pinned commit, oldest first. */
async function history(path: string): Promise<Commit[]> {
  const out: Commit[] = [];
  for (let page = 1; ; page++) {
    const url =
      `${API}/commits?ref_name=${FGDATA_COMMIT}&path=${encodeURIComponent(path)}` +
      `&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} listing history of ${path}`);
    const batch = (await res.json()) as Commit[];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.reverse();
}

/** `<author>` tags from the model XMLs — often the only record of the modeller. */
async function xmlAuthors(files: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.xml')) continue;
    const text = await Bun.file(f).text();
    for (const m of text.matchAll(/<author>([^<]*)<\/author>/g)) found.add(m[1]!.trim());
    for (const m of text.matchAll(/<!--\s*Author\s+([^-]*?)\s*-->/gi)) found.add(m[1]!.trim());
  }
  return [...found];
}

await download('LICENSE.md', `${OUT}/LICENSE.md`);

for (const model of models) {
  const rel = [model.ac, model.mainXml, model.lightsXml].filter((f): f is string => !!f);
  const local: string[] = [];
  for (const f of rel) {
    const to = join(OUT, model.folder, f);
    await download(`AI/Aircraft/${model.folder}/${f}`, to);
    local.push(to);
  }

  if (model.textureDir) {
    const ac = parseAc3d(await Bun.file(join(OUT, model.folder, model.ac)).text());
    const names = new Set(ac.objects.flatMap((o) => (o.texture ? [o.texture] : [])));
    for (const name of names) {
      const rel = `${model.textureDir}/${name}`;
      try {
        await download(`AI/Aircraft/${model.folder}/${rel}`, join(OUT, model.folder, rel));
      } catch {
        // Interior-only textures often don't exist in the default set; the
        // objects that use them are removed anyway.
        console.log(`  ${model.folder}: no ${rel}`);
      }
    }
  }

  const commits = await history(`AI/Aircraft/${model.folder}`);
  const committers = [...new Set(commits.map((c) => c.author_name))];
  const authors = await xmlAuthors(local);
  const lines = [
    `# ${model.folder}`,
    '',
    `Source: https://gitlab.com/flightgear/fgdata/-/tree/${FGDATA_COMMIT}/AI/Aircraft/${model.folder}`,
    'Licence: GNU GPL v2 (see ../LICENSE.md)',
    '',
    '## Authors named in the model files',
    '',
    ...(authors.length ? authors.map((a) => `- ${a}`) : ['- (none named)']),
    '',
    '## Contributors (fgdata history of this folder)',
    '',
    ...committers.map((a) => `- ${a}`),
    '',
    '## History',
    '',
    ...commits.map((c) => `- ${c.authored_date.slice(0, 10)} ${c.author_name}: ${c.title}`),
    '',
  ];
  await Bun.write(join(OUT, model.folder, 'AUTHORS.md'), lines.join('\n'));
  console.log(`${model.folder}: ${local.length} files, ${committers.length} contributors`);
}

await Bun.write(join(OUT, 'FGDATA_COMMIT'), `${FGDATA_COMMIT}\n`);
