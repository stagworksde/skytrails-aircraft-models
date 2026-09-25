# skytrails-aircraft-models

Builds the type-accurate 3D aircraft that the Skytrails Spot Map draws. The source is FlightGear's AI traffic models (`fgdata/AI/Aircraft`), which are low-poly already. Each model is turned into a small, livery-free GLB that is safe for Mapbox.

| Directory | Contents | Licence |
|---|---|---|
| `src/`, `scripts/`, `test/`, `models.ts` | the pipeline | MIT (`LICENSE-CODE`) |
| `sources/fgdata/` | original FlightGear files, pinned commit, authors | GPL v2 (`COPYING.md`) |
| built GLBs (release assets) | modified FlightGear models | GPL v2 (`COPYING.md`) |

## Why the app downloads these instead of bundling them

The models are GPL v2. GPL v2 and the Apple App Store's usage rules are widely considered incompatible (VLC was pulled over this in 2011). So the app never ships these files. It downloads them at runtime from this repository's GitHub releases, and falls back to its own built-in shapes when offline.

Base URL for the app (`SKYLOG_AIRCRAFT_MODELS_BASE_URL`): `https://github.com/stagworksde/skytrails-aircraft-models/releases/latest/download`. The repository must stay public, or the app cannot download and the GPL source is not accessible.

Our GPL obligations are met here:
- **Copyright notices:** kept in `sources/fgdata/*/AUTHORS.md` and in each GLB's `asset.copyright` (§1).
- **Change notice:** each GLB records what was changed and when in `asset.extras` (§2(a)).
- **Source:** every release's source archive holds the original files, this pipeline and its config, from the same place as the binaries (§3).

## What the pipeline does to each model

1. **Parse** the AC3D file and the model XML: gear `select` animations, `*-NavLights.xml` light positions.
2. **Classify** objects by name (`src/classify.ts`). Ancestors pass removal down, so every child of a `Gear` group is gear.
3. **Remove** gear, interior, propeller blades and light objects. Read no animation.
4. **Paint** in three tones: body, accent (fin and engines) and glass. Newer AI models are one merged mesh, so there the fin is found geometrically: what rises above the fuselage roof, aft, on the centreline.
   - **Texture:** each model keeps FlightGear's neutral **default paint** (`Textures/Default`: white, with windows, cockpit windows, doors and engine fans), because without it an airliner is an anonymous white tube. The tones multiply it, so the details stay dark under any livery tint.
   - **No airline liveries.** Branding a default scheme still carries is painted over via `textureMasks` in `models.ts` (the 737's "Gooneybird" wordmark).
   - Textures are re-encoded as JPEG at up to 1024 px, 256 px for light aircraft. This uses ImageMagick (`magick`), which also reads FlightGear's SGI `.rgb` files.
5. **Simplify** with meshoptimizer to the model's triangle budget. Shade with 40° crease normals.
6. **Add lights:** steady nav lights (red left, green right, white tail) in the main GLB. Wingtip lights are always placed on the tip geometry, centred in its thickness: FlightGear's light XML often puts them a metre off the tip. Tail and beacons come from that XML. Flashing strobes and beacons go in a separate `_strobe` GLB, which the app blinks by toggling a map layer.
7. **Add a prop disc** in place of each removed propeller.
8. **Validate:** every primitive indexed (Mapbox segfaults otherwise), uint16 indices, budget, length ±10 %, orientation from the light positions, no textures or animations.

Output frame: X right, Y up, nose along −Z, metres, X/Z centred, bottom at Y = 0. This matches the app's hand-built `assets/models/ac_*.glb`.

## Coverage

33 models cover 69 of the app's 81 catalog types; `models.ts` maps them. All mapped ids exist in the app's catalog (checked by hand against `aircraft_model_type.dart`; the build does not check it).

- **Own model:** the common airliners (A220, A320, A330, A340, A350, A380, 737, 747, 757, 777, E190, E195), the regionals (ATR 72, Dash 8-300/-400, CRJ200/700, ERJ 145, Saab 340) and the frequent GA types (C172, C182, Caravan, Cub, PA-28, DR400, DA42, King Air).
- **Nearest model:** several types share one.
  - The low-wing singles share the PA-28.
  - The light twins share the DA42 or the C310.
  - Small and mid-size bizjets share the Citation Bravo, large ones the Challenger 604 and the Legacy.
  - Microlights share the FK9.
  - All gliders share the Centrair Pégase.
- **No model:** helicopters (none in `AI/Aircraft`), the Extra 300 and the Cirrus Vision Jet keep the app's built-in shapes.

Branding a default paint scheme still carries is masked per texture: Airbus's A220 house livery, Embraer's E195 lettering, the 737's "Gooneybird", and real registrations on the C182, C310 and FK9. Modellers' credit lines inside textures stay.

For review, `bun run snapshot` takes a list of ids: render at most about six per call, or Chromium's time budget runs out and later rows come back blank.

## Commands

```sh
bun install
bun run fetch          # copy the listed FlightGear files into sources/fgdata (pinned commit)
bun run build [id…]    # build into out/, write out/manifest.json and out/contact_sheet.{svg,png}
bun test
bun run typecheck
bun run snapshot       # render the built GLBs for real (three.js, headless Chromium) → out/snapshot.png
bun run inspect sources/fgdata/A380/Models/388.ac   # list a model's objects before configuring it
bun run serve          # serve out/ on :8788 for a device on the LAN
bun run release        # check and print the gh release command (dry run); --publish creates it
```

Always review `out/snapshot.png` (the real render: textures, lights) and `out/contact_sheet.png` (geometry and paint classes) before a release. It shows every model from above, the side and the front: check that the gear is gone, the lights are on the tips, the fin is painted and the prop discs are in place.

## Releasing

1. Bump `version` in `package.json`, `bun run fetch && bun run build`, review `out/snapshot.png` and `out/contact_sheet.png`.
2. Commit and push. The release source archive is the git tree at the tag, so `sources/fgdata/` must be committed.
3. `bun run release` is a dry run: it checks that every manifest file exists and matches its sha256, the tree is clean, HEAD is pushed and the tag is free.
4. `bun run release -- --publish` creates the release (add `--prerelease` to keep it out of `latest`).

Every release must hold the complete set of files: the app follows `releases/latest`.

## Adding a model

1. Pick a folder from `fgdata/AI/Aircraft`, and check its git history for third-party terms ("converted from", "with permission").
2. Add an entry to `models.ts` with the catalog `typeIds`, real length and budget.
3. `bun run fetch && bun run build <id>`, then read the build report:
   - `body by default` lists names no rule matched,
   - `removed …` lists what was stripped.
4. Fix misses with a new rule in `src/classify.ts` (plus a test case), or a per-model `classes` override.

## Future

A second importer for hand-downloaded CC BY Sketchfab models is planned: see `docs/future-sketchfab.md`.
