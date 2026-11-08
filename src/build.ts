// Builds every model in `models.ts` (or the ids given) from `sources/fgdata/`
// into `out/`:
//
//   out/models/ac_<id>-<sha8>.glb          airframe + steady lights + prop discs
//   out/models/ac_<id>_strobe-<sha8>.glb   flashing lights only
//   out/manifest.json                      what the app downloads first
//   out/contact_sheet.svg (+ .png)         the QA sheet
//
//   bun run build [id…]
//
// Fails on any validation error. Run `bun run fetch` first.

import { mkdir, rm } from 'node:fs/promises';
import pkg from '../package.json';
import { FGDATA_COMMIT, models, type ModelSpec } from '../models';
import { emitMain, emitStrobe, type Provenance } from './emit';
import { prepareTexture, type PreparedTexture } from './textures';
import { contactSheet } from './preview';
import { processModel, type ProcessedModel } from './process';
import { removedClassesFor } from './classify';
import { validate } from './validate';

const SOURCES = 'sources/fgdata';
const OUT = 'out';

const wanted = process.argv.slice(2);
const specs = wanted.length ? models.filter((m) => wanted.includes(m.id)) : models;
const unknown = wanted.filter((id) => !models.some((m) => m.id === id));
if (unknown.length) {
  console.error(`unknown model ids: ${unknown.join(', ')}`);
  process.exit(1);
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/** Names from the fetched AUTHORS.md: modellers first, then fgdata contributors. */
async function authorsOf(spec: ModelSpec): Promise<{ modellers: string[]; contributors: string[] }> {
  const text = await Bun.file(`${SOURCES}/${spec.folder}/AUTHORS.md`).text();
  const section = (title: string) => {
    const start = text.indexOf(`## ${title}`);
    if (start < 0) return [];
    const rest = text.slice(start).split('\n').slice(1);
    const end = rest.findIndex((l) => l.startsWith('## '));
    return (end < 0 ? rest : rest.slice(0, end))
      .filter((l) => l.startsWith('- ') && !l.includes('(none named)'))
      .map((l) => l.slice(2).trim());
  };
  return {
    modellers: section('Authors named in the model files'),
    contributors: section('Contributors (fgdata history of this folder)'),
  };
}

function provenance(spec: ModelSpec, authors: { modellers: string[]; contributors: string[] }): Provenance {
  const who = [...new Set([...authors.modellers, ...authors.contributors])].join(', ');
  return {
    copyright: `FlightGear AI model "${spec.folder}" by ${who}. GNU GPL v2.`,
    extras: {
      source: `https://gitlab.com/flightgear/fgdata/-/tree/${FGDATA_COMMIT}/AI/Aircraft/${spec.folder}`,
      sourceFiles: [spec.ac, spec.mainXml, spec.lightsXml].filter(Boolean),
      licence: 'GPL-2.0-only',
      modified: {
        by: 'skytrails-aircraft-models',
        date: new Date().toISOString().slice(0, 10),
        changes:
          `Converted from AC3D to glTF. ${spec.fixedGear ? 'Interior' : 'Landing gear, interior'}, propeller blades and light objects removed; ` +
          'mesh simplified; airline liveries replaced by FlightGear\'s neutral default paint (branding masked), ' +
          'tinted in three tones; nav/strobe/beacon lights and propeller discs added.',
      },
    },
  };
}

await rm(`${OUT}/models`, { recursive: true, force: true });
await mkdir(`${OUT}/models`, { recursive: true });

const processed: ProcessedModel[] = [];
const manifestModels: Record<string, unknown> = {};
let failed = false;

for (const spec of specs) {
  const model = await processModel(spec, SOURCES);
  const authors = await authorsOf(spec);
  const prov = provenance(spec, authors);
  const textures = new Map<string, PreparedTexture>();
  for (const name of new Set(model.parts.flatMap((p) => (p.texture ? [p.texture] : [])))) {
    textures.set(
      name,
      prepareTexture(
        `${SOURCES}/${spec.folder}/${spec.textureDir}/${name}`,
        spec.textureMasks?.[name] ?? [],
        spec.textureSize ?? 1024,
      ),
    );
  }
  const main = await emitMain(model, prov, textures);
  const strobe = await emitStrobe(model, prov);
  const { errors, warnings } = await validate(spec, model, main, strobe);

  const mainSha = sha256(main);
  const strobeSha = sha256(strobe);
  const mainFile = `ac_${spec.id}-${mainSha.slice(0, 8)}.glb`;
  const strobeFile = `ac_${spec.id}_strobe-${strobeSha.slice(0, 8)}.glb`;
  await Bun.write(`${OUT}/models/${mainFile}`, main);
  await Bun.write(`${OUT}/models/${strobeFile}`, strobe);

  const removedSet = removedClassesFor(spec.fixedGear);
  const removed = model.objects.filter((o) => removedSet.has(o.cls));
  const defaulted = model.objects.filter((o) => o.defaulted).map((o) => o.name || '(unnamed)');
  console.log(
    `\n${spec.id.padEnd(8)} ${model.trisBefore} → ${model.trisAfter} tris  ` +
      `${(main.length / 1024).toFixed(1)} kB + ${(strobe.length / 1024).toFixed(1)} kB  ` +
      `${model.size.length.toFixed(2)} × ${model.size.span.toFixed(2)} × ${model.size.height.toFixed(2)} m  ` +
      `lights: ${model.lightSource}  fin: ${model.finFound}  props: ${model.props.length}`,
  );
  for (const cls of ['gear', 'interior', 'prop', 'light', 'drop'] as const) {
    const names = removed.filter((o) => o.cls === cls).map((o) => o.name);
    if (names.length) console.log(`  removed ${cls}: ${names.join(', ')}`);
  }
  if (defaulted.length) console.log(`  body by default: ${defaulted.join(', ')}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const e of errors) console.log(`  ERROR: ${e}`);
  if (errors.length) failed = true;

  processed.push(model);
  manifestModels[spec.id] = {
    file: mainFile,
    sha256: mainSha,
    bytes: main.length,
    strobeFile,
    strobeSha256: strobeSha,
    strobeBytes: strobe.length,
    typeIds: spec.typeIds,
    lengthM: round(model.size.length),
    spanM: round(model.size.span),
    heightM: round(model.size.height),
    tris: model.trisAfter,
    source: `fgdata/AI/Aircraft/${spec.folder}`,
    authors: [...new Set([...authors.modellers, ...authors.contributors])],
    licence: 'GPL-2.0-only',
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// A catalog id must resolve to exactly one model.
const owner = new Map<string, string>();
for (const spec of specs) {
  for (const t of spec.typeIds) {
    const prev = owner.get(t);
    if (prev) {
      console.log(`ERROR: typeId ${t} claimed by both ${prev} and ${spec.id}`);
      failed = true;
    }
    owner.set(t, spec.id);
  }
}

const manifest = {
  schema: 1,
  version: pkg.version,
  fgdataCommit: FGDATA_COMMIT,
  licence: 'Models: GPL-2.0-only (FlightGear fgdata). Source: see the release this manifest belongs to.',
  models: manifestModels,
};
await Bun.write(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

const sheet = contactSheet(processed);
await Bun.write(`${OUT}/contact_sheet.svg`, sheet);
const magick = Bun.which('magick');
if (magick) {
  Bun.spawnSync([magick, `${OUT}/contact_sheet.svg`, `${OUT}/contact_sheet.png`]);
}

const total = Object.values(manifestModels).reduce<number>(
  (n, m) => n + (m as { bytes: number; strobeBytes: number }).bytes + (m as { strobeBytes: number }).strobeBytes,
  0,
);
console.log(`\n${specs.length} models, ${(total / 1024).toFixed(1)} kB total → ${OUT}/`);
if (failed) {
  console.error('build failed: validation errors above');
  process.exit(1);
}
