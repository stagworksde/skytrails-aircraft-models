// Publishes the current `out/` build as a GitHub release.
//
//   bun run build && bun run scripts/release.ts             # dry run: checks + prints the command
//   bun run build && bun run scripts/release.ts --publish   # really creates the release
//   ... --prerelease                                        # publish, but not as `latest`
//
// One release carries every GLB, every icon (`bun run icons`) and manifest.json as assets, so the app can
// load `<repo>/releases/latest/download/manifest.json` and every file it names.
// A release must always hold the complete set: `latest` points at the newest
// one, so never upload only the changed models.
//
// GitHub attaches the repository's source archive (sources/, the pipeline,
// models.ts) to the same release page, which is the "equivalent access to the
// source from the same place" GPL v2 §3 asks for. That archive is the git tree
// at the tag, so the checks below insist the tag is exactly the pushed HEAD.

import { readdir } from 'node:fs/promises';
import pkg from '../package.json';

const publish = process.argv.includes('--publish');
const prerelease = process.argv.includes('--prerelease');
const tag = `v${pkg.version}`;

async function sh(...cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(' ')} failed: ${err.trim()}`);
  return out.trim();
}

const problems: string[] = [];

// Every file the manifest names exists in out/models and matches its hash.
const manifest = await Bun.file('out/manifest.json').json();
const built = new Set(await readdir('out/models'));
const named = new Set<string>();
for (const [id, m] of Object.entries<any>(manifest.models)) {
  for (const [file, sha] of [[m.file, m.sha256], [m.strobeFile, m.strobeSha256], [m.iconFile, m.iconSha256]] as const) {
    if (!file) continue;
    named.add(file);
    if (!built.has(file)) {
      problems.push(`${id}: ${file} is in the manifest but not in out/models`);
      continue;
    }
    const actual = new Bun.CryptoHasher('sha256').update(await Bun.file(`out/models/${file}`).bytes()).digest('hex');
    if (actual !== sha) problems.push(`${id}: ${file} sha256 differs from the manifest (rebuild)`);
  }
}
for (const file of built) if (!named.has(file)) problems.push(`out/models/${file} is not in the manifest`);
if (manifest.version !== pkg.version) problems.push(`manifest version ${manifest.version} != package.json ${pkg.version}`);

// The source archive must be exactly what was built: clean tree, HEAD pushed.
if (await sh('git', 'status', '--porcelain')) problems.push('working tree is not clean: commit first');
try {
  const head = await sh('git', 'rev-parse', 'HEAD');
  const pushed = await sh('git', 'branch', '-r', '--contains', head);
  if (!pushed) problems.push('HEAD is not pushed: the release source archive would not match the build');
} catch (e) {
  problems.push(`git: ${(e as Error).message}`);
}
try {
  const existing = await sh('gh', 'release', 'view', tag, '--json', 'tagName', '-q', '.tagName');
  if (existing) problems.push(`release ${tag} already exists: bump "version" in package.json`);
} catch {
  // gh exits non-zero when the release does not exist, which is what we want.
}

if (problems.length) {
  console.error(`Not releasing ${tag}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const models = [...built].sort().map((f) => `out/models/${f}`);
const notes = [
  `Aircraft models ${tag}, built from FlightGear fgdata AI traffic models.`,
  '',
  'Models: GNU GPL v2. Each GLB records its source, authors and the changes made',
  '(asset.copyright / asset.extras). Complete source: the source archive of this release.',
].join('\n');

const args = [
  'release', 'create', tag,
  'out/manifest.json', ...models,
  '--title', `Aircraft models ${tag}`,
  '--notes', notes,
  '--target', await sh('git', 'rev-parse', 'HEAD'),
  ...(prerelease ? ['--prerelease'] : ['--latest']),
];

if (!publish) {
  console.log(`Checks passed. Dry run, would run:\n\ngh ${args.map((a) => JSON.stringify(a)).join(' ')}`);
} else {
  console.log(await sh('gh', ...args));
}
