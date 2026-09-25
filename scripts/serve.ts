// Serves the `out/` build over HTTP so a device on the LAN can load the
// models before there is a public release:
//
//   bun run serve            # http://0.0.0.0:8788/manifest.json
//
// Point the app at it with SKYLOG_AIRCRAFT_MODELS_BASE_URL=http://<lan-ip>:8788
// in the skylog repo's env/dev.json. The layout matches a GitHub release,
// where every asset sits flat next to manifest.json.

const port = Number(process.env.PORT ?? 8788);

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(req) {
    const name = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    if (name.includes('/') || name.includes('..')) return new Response('not found', { status: 404 });
    for (const candidate of [`out/${name || 'manifest.json'}`, `out/models/${name}`]) {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        console.log(`200 /${name}`);
        return new Response(file);
      }
    }
    console.log(`404 /${name}`);
    return new Response('not found', { status: 404 });
  },
});

console.log(`serving out/ on http://0.0.0.0:${port}/`);
