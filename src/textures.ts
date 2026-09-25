// Prepares a model's default-paint textures for the GLB: masks out branding
// the config names, downsizes to the model's texture size and re-encodes as
// JPEG (the sources are PNG and SGI `.rgb`, which glTF can't carry).
//
// Uses ImageMagick (`magick`) — it reads SGI, which no npm image library does.

export interface PreparedTexture {
  bytes: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

function run(args: string[]): Uint8Array {
  const magick = Bun.which('magick');
  if (!magick) throw new Error('ImageMagick (`magick`) is required to build textured models');
  const res = Bun.spawnSync([magick, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (res.exitCode !== 0) throw new Error(`magick ${args.join(' ')}: ${res.stderr.toString()}`);
  return res.stdout;
}

const text = (args: string[]) => new TextDecoder().decode(run(args)).trim();

export function prepareTexture(
  path: string,
  masks: readonly [number, number, number, number][],
  maxSize: number,
): PreparedTexture {
  const [w, h] = text([path, '-format', '%w %h', 'info:']).split(' ').map(Number) as [number, number];
  const draw: string[] = [];
  for (const [fx, fy, fw, fh] of masks) {
    const x0 = Math.round(fx * w);
    const y0 = Math.round(fy * h);
    const x1 = Math.round((fx + fw) * w);
    const y1 = Math.round((fy + fh) * h);
    // Fill with the paint just outside the region's top-left corner, so the
    // patch matches whatever surrounds it.
    const sx = Math.max(0, x0 - 4);
    const sy = Math.max(0, y0 - 4);
    const colour = text([path, '-format', `%[pixel:p{${sx},${sy}}]`, 'info:']);
    draw.push('-fill', colour, '-draw', `rectangle ${x0},${y0} ${x1},${y1}`);
  }
  const bytes = run([
    path,
    // Transparent texels (unused atlas space) go white, not black.
    '-background',
    'white',
    '-alpha',
    'remove',
    ...draw,
    '-resize',
    `${maxSize}x${maxSize}>`,
    '-strip',
    '-quality',
    '85',
    'jpeg:-',
  ]);
  const scale = Math.min(1, maxSize / Math.max(w, h));
  return {
    bytes,
    mimeType: 'image/jpeg',
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}
