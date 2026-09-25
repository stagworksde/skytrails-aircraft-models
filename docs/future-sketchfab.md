# Future: Sketchfab importer (CC BY 4.0 models)

Saved from the planning session on 2026-09-24. Not implemented. This extends the FlightGear pipeline with a second importer for hand-downloaded Sketchfab models (kept in skylog `preprocessing/plane-models/`).



## Context

Every airliner, regional jet and bizjet on the map currently uses one `ac_jet.glb`, so an A380 looks like a Citation. The 4 coarse `AirframeShape` GLBs are hand-built, at about 150–200 tris and ~15 KB each. Goal: an A380 shows an A380, a C172 a C172.

The user downloads CC-BY models from Sketchfab by hand into `preprocessing/plane-models/`. Every model there is licensed so it may be bundled; attribution is in `Manifest.md`. They need processing:
- decimation,
- gear removal,
- livery, texture and animation stripping,
- added strobe and nav lights,
- prop discs.

## Step 0: back up the previous plan

The FlightGear plan was rejected. Once plan mode ends, write it to `docs/plans/aircraft-models-flightgear.md` as the backup the user asked for. (Plan mode only allowed editing the plan file.)

## What the first 4 downloads look like (inspected)

| Model | Format | Tris | Structure |
|---|---|---|---|
| A320 (Andre11230) | STL, SketchUp export, 6.3 MB | 127k | one triangle soup: no parts, no materials, no units |
| A330 (1883) | glTF, SketchUp via Collada | 50k | 53 nodes named only by material (`Material3.014`), Qantas logo textures |
| A340-600 (Dave Love) | GLB 20 MB + 3 PNG diffuse textures (17 MB) | 44k | **one mesh, one node**, 6 materials, Lufthansa livery baked into textures |
| C172 "Plane" (osmosikum) | binary FBX 5 MB + ~20 PBR JPEGs | ? (FBX) | materials `Main`, `Altbody`, `windows`, `interior`, `seats_and_stuff`, `xtra` |

Consequences:
- **No part names.** Neither gear, props nor engines can be found by name. Every automated step has to work from **geometry**, with a small per-model config for overrides.
- **Arbitrary axes and units.** SketchUp exports are in inches and have random axes, so each model needs `nose`/`up` axes in its config. Scale comes from the catalog length in metres.
- **Mixed formats (STL/glTF/GLB/FBX).** Use **Blender headless** as the single tool: it imports all four, decimates well, and its glTF exporter always writes an index buffer, which is required because Mapbox segfaults without one. Install it with `apt`/`snap`; it is not on the machine yet.

## Answers to the four questions

### 1. Gear removal: mostly scriptable, with a manual fallback for some models
The script works from geometry:
1. Weld vertices.
2. Split the mesh into connected components.
3. Find the fuselage (the largest component along the length axis) and its belly height.
4. Treat as gear any component that:
   - lies mostly below the belly line,
   - is small (under ~3 % of the aircraft's size),
   - is outside the engine nacelles. Nacelles are recognised as larger, roughly cylindrical components aligned with the length axis. They hang below the belly on A320s and 737s, so a plain cut plane would clip them.
5. Also drop gear-door slivers under the same rule.

Expectations:
- **Separate-part models** (glTF/FBX, like A330 and C172): about 70–80 % need nothing more.
- **STL welded soups** (A320) and **high-wing strut gear** (C172 spring legs, which touch the fuselage) often need one of:
  - an override in the model config (`gear_cut: {below_z: …, keep: […]}`, or a box to delete),
  - about 5–10 min by hand in Blender, saved as a cleaned intermediate `.blend` next to the zip.

Stubs that stay inside the wheel wells are invisible from the map's ~55° camera.

### 2. Strobe and nav lights: fully automatic for fixed-wing
Light positions come from the geometry:
- wingtips = the vertices with the largest |span| coordinate,
- tail = the aftmost vertex near the top of the fin,
- beacon = the top of the fuselage near its middle.

What gets added (tiny emissive shapes):
- **Steady lights**, baked into the main GLB: red on the left tip, green on the right, white at the tail. These are emissive materials, which `model-emissive-strength` already lights up at night.
- **Flashing lights**: a white strobe at each wingtip and a red beacon. **Mapbox `ModelLayer` does not play glTF animations** (to verify on device), so these go into a separate tiny GLB per type, `ac_<type>_strobe.glb` (~2 KB).
  - A second `ModelLayer` draws it from the **same** plane GeoJSON source, so position, rotation and scale are shared with no extra feature updates.
  - A timer toggles that layer's visibility at a strobe rhythm: double flash, 1.2 s.
  - Planes are split across 2–3 strobe layers by uid hash, so they don't all blink in sync.

Light size is exaggerated to about 0.6–1 m. At 6 px/m that is about 4–6 px, visible without looking like a toy.

### 3. Liveries and animations: fully automatic
- Drop every texture, UV set, normal/roughness map, animation, camera, light and skin. This removes all airline logos (Qantas, Lufthansa), which is also the trademark hygiene we want.
- Delete interior parts by material name (the C172's `interior` and `seats_and_stuff`) and by an "enclosed inside the fuselage" test.
- Recolour everything into our 3 tones, the same `Mat` scheme as today's GLBs:
  - **glass**: transparent or dark window materials,
  - **accent**: the fin and engine nacelles (found by geometry),
  - **body**: everything else.

  For single-material soups (the STL) the classification is purely geometric: fin region, nacelles, and a windshield band above the nose. The per-model config can override any assignment.

### 4. Prop: automatic disc, no spinning on the map
- Detect the prop position as the forward-most point of the nose, for single-engine models. For twins it is the front of each nacelle; fully automatic if nacelles separate cleanly, otherwise a one-line override (`props: [[x,y,z], …]`).
- Remove the modelled blades.
- Add a thin, semi-transparent, slightly tinted **prop disc**. This is the standard low-poly look.
- A real spin on the map would need modelId swaps at the ticker rate, which the motion throttle would make visibly steppy. Not worth it.
- `Plane3D` on the runway hero already spins its own prop and keeps its own meshes (see scope).

## Would the sim files be easier? Yes, clearly

Inspected: FlightGear AI models name their parts (`RightWheelStrut`, `NoseWheel`, `Propeller.Fast`, `RightNavLightOn`, `no1intake`, `nglhfwddoor`, …).
- **Gear, props and nav lights are found by name**, not by heuristics.
- Light positions sit in the XML.
- They are already low-poly (1.6k–4.5k tris), so no decimation.
- One repo covers about 35 catalog types in one consistent style, and the units are metres.

Rough per-model effort:
- FlightGear: **~5 min**, almost all scripted.
- Sketchfab: **~20–45 min**. That covers sourcing, axes/length config, gear overrides and QA, plus downloading 3–5 candidates for each good one.

What stops FlightGear is only GPL v2 vs the App Store. That is exactly the risk the user wants to avoid. X-Plane and MSFS models may not be redistributed at all.

**Middle ground that keeps the licence clean:** positions (wingtip, prop and gear locations) are facts, not copyrightable expression. FlightGear can serve as a **reference** for per-model overrides while the geometry comes from Sketchfab. It is optional.

## Licensing in detail

This is not legal advice. It is the reasoning behind each choice, with the sources checked. A short review by a lawyer before release is cheap insurance, especially for Option B.

### Option A: Sketchfab, CC BY 4.0, bundled in the app
- **What we may do:** copy, modify (decimate, strip, recolour, add lights), and ship it commercially inside the app. The licence is irrevocable for the copy we downloaded.
- **Obligations** (CC BY 4.0 §3(a)): for every model, credit
  - the creator,
  - the title,
  - a link to the source,
  - a link to the licence,
  - **a note that it was modified**.

  "In any reasonable manner" means a "3D aircraft models" section on the in-app legal screen is enough. `Manifest.md` already holds most of this. The **A340 entry has no URL yet**, so fill it in. Save each model's Sketchfab page as it was on the download date, as evidence.
- **No downstream restrictions** (§2(a)(5)(B)): we must not add terms or DRM that stop others using the models. FairPlay encrypts only the iOS executable, not bundled resource files, and the originals stay public on Sketchfab. In practice this is fine: CC BY assets ship in App Store apps routinely.
- **Weak spots:**
  - A licence is only as good as the uploader's right to grant it: someone may have re-uploaded a ripped sim model as "CC BY".
  - To lower that risk, avoid models whose description or file names point to a game or sim (MSFS, X-Plane, GTA, "ripped", "converted from"), and prefer uploaders who have other original work.
  - If a takedown ever comes, swapping one GLB is a one-line manifest change, and the shape fallback covers the gap.

### Option B: FlightGear, GPL v2, downloaded at runtime
The files: `fgdata/AI/Aircraft/*` has no per-model licence files, so the repo's `COPYING` (GPL v2) covers them. Authors appear only in the git history and `AUTHORS`/`Thanks`.

**Why bundling is the problem.** GPL v2 §6 forbids "further restrictions" on recipients. Apple's App Store Usage Rules limit copying and redistribution. That is why VLC was pulled in 2011 after one copyright holder objected. Any GPL files inside the IPA carry that conflict. Only a copyright holder can enforce it, but one complaint is enough.

**Why runtime download takes it off the table:**
- **Apple never distributes the GPL files.** The IPA holds only our non-GPL app. The models come from **our** server, where we control the terms and comply with the GPL ourselves. The App Store conflict simply doesn't arise.
- **The app does not become GPL.** It loads the GLBs as data and Mapbox renders them. They are separate works communicating at arm's length (mere aggregation, like a PDF viewer opening a GPL-licensed PDF). The FSF's position is that data a program processes and the program itself can carry different licences.
- **App Store Review 2.5.2** forbids downloading **executable code** that changes app behaviour. 3D models are passive data, the same as the map tiles we already download. Fine.
- **Google Play:** no conflict either way. The same download path keeps one code path.

**Obligations when we host the modified GLBs** (they are a "work based on the Program"):
1. **§1:** keep the copyright notices, and serve the GPL v2 text next to the files.
2. **§2(a):** the modified files carry a note saying they were changed, and when. Put it in each GLB's `asset.extras` and in the manifest.
3. **§2(b):** the modified GLBs are themselves licensed GPL v2. That's fine, since we own neither of the originals.
4. **§3, source code:** we must provide the "preferred form for making modifications", including "the scripts used to control compilation". So publish:
   - the original `.ac` files and textures,
   - **our conversion pipeline** (`preprocessing/src/plane_models/`, e.g. MIT-licensed, which is GPL-compatible),
   - the per-model config.

   §3's last paragraph accepts "equivalent access to copy the source code **from the same place**". A `src/` folder next to the GLBs on our server satisfies it.
5. **In the app:** a legal-screen entry naming FlightGear and the authors (from git log), GPL v2, and a link to the hosted source.

**Residual risks** (small):
- A model in fgdata could itself be derived from something with other terms. Check each chosen folder's git history for "converted from", "with permission of" and similar, and drop any that is unclear.
- If our server is down or the device is offline, those types fall back to the shape GLBs. That's a product cost, not a legal one.

**Upgrade path:** if an author of a heavily used model agrees to a permissive relicence (email them, ~10 models), that model may be bundled after all.

### Both options: aircraft trademarks
- The **shape** of an A380 or 747 can be protected trade dress. Boeing and Airbus run licensing programmes for merchandise likenesses.
- Neither Sketchfab nor FlightGear licenses those rights: Sketchfab's licence says so explicitly, and TurboSquid marks such models "editorial use".
- **Our use is descriptive:** we show which type a pilot is actually flying, the same as flight trackers do with type-specific 3D models. It is not merchandise.

Mitigations:
- no logos, liveries or manufacturer names on the meshes (the pipeline strips them anyway),
- type names only as text labels,
- no Airbus/Boeing models as hero art in store screenshots or marketing.

Low risk, not zero, and the same for every source.

### Verdict
- **Option A** needs only attribution. Every model has to be cleaned by heuristics (the effort estimate below).
- **Option B**, done as described, is legally sound: download only, source hosted, notices kept. It saves most of the per-model work and covers ~35 types from one consistent set. It costs one server route and a device cache (the download service from the earlier plan, backed up in step 0).

**Recommendation:**
- If the analysis above is reassuring enough: **Option B for coverage**, with Option A models used where FlightGear has no type (A350, 787, A220, bizjets, SR22, TBM, PC-12).
- Otherwise, **A only**.

The pipeline below handles both input kinds. FlightGear models just skip the heuristics because their parts are named.

## Pipeline: `preprocessing/src/plane_models/`

Layout:
- `models.yaml`, one entry per model:
  - `typeIds`: a model can serve several catalog ids,
  - `source`: zip + inner path,
  - `nose`, `up`: axes,
  - `lengthM`: from the type spec,
  - `budget`: tris,
  - optional `gear`, `props`, `lights`, `materials` overrides,
  - `attribution`: copied from `Manifest.md`.
- `process.py`, run with `blender -b -P process.py -- <id|all>`. Per model:
  1. Unzip into a temp directory.
  2. Import (STL/glTF/GLB/FBX).
  3. Apply transforms.
  4. Merge by distance and delete loose or degenerate geometry.
  5. Orient to the existing GLB convention (nose −Z, up +Y, see `tool/glb.dart`) and scale to `lengthM` in metres, matching `tool/export_plane_models.dart`.
  6. Delete interior parts.
  7. Remove gear.
  8. Strip everything listed under question 3.
  9. Decimate (Collapse, planar pre-pass) to the budget: **airliner ≤ 3,000 tris, GA/regional ≤ 2,000**.
  10. Recolour into body/accent/glass.
  11. Add nav lights and the prop disc.
  12. Export `assets/models/ac_t_<modelId>.glb` and `ac_t_<modelId>_strobe.glb`.
- **Validation** fails the run on:
  - a missing index buffer,
  - more than 65,535 indices in a primitive,
  - triangle count over budget,
  - bounding-box length more than ±5 % off `lengthM`,
  - nose not along −Z,
  - any texture or animation left over.
- **Preview:** a Blender Workbench render of top, side and ¾ views for every model into one contact-sheet PNG (`out/contact_sheet.png`). This is the QA step for gear, lights and colours before anything ships.
- Update `preprocessing/README.md`, the same way as for `sights_db`.

## App integration (much simpler than the download variant: everything is bundled)

1. **Publish the real type.**
   - `PlaneSkin` (`lib/data/models/plane_skin.dart`) gets an optional `typeId` inside `skin`. `pilot_locations` rules don't pin keys, so there's no rules deploy; old clients ignore it.
   - `AircraftRepository.skin` (`lib/data/repository/aircraft/aircraft_repository.dart`) sets it from the flown or planned airplane's `AirplaneModel.typeId`. It notifies only when the value changes, because `PilotLocationRepository` republishes on every notify.
   - The legacy top-level `typeId` (the shape mirror) stays untouched.
2. **Model manifest**, a const table `lib/data/models/aircraft_model_asset.dart`. Each entry holds catalog `typeId` → `modelId`, `lengthM`, and `approx` (for example `b737max` → the 737-800 model).
   - Types without an entry keep the `AirframeShape` GLB.
   - `test/` asserts that every manifest entry names a catalog id and that its asset file exists, like `achievement_catalog_test.dart`.
3. **Map** (`lib/ui/main/map/widgets/map_canvas_3d.dart`):
   - `_addPlaneModels` registers the shape GLBs plus, **lazily**, a type GLB the first time a feature needs it. It goes through the existing `_planeModelUri` tmp-file path, because `asset://` URIs resolve to nothing.
   - `_planeFeatureJson` sets `modelId` to the type model if there is one, else the shape. It also sets `strobeId` and a `strobeGroup`.
   - A new strobe `ModelLayer` (or 2–3) on `_planeSourceId`, and a `Timer` in the canvas state that toggles its visibility. Paused when the app is backgrounded, and off under reduced motion.
   - **Scale:** `_modelScale` is uniform pixels per metre, so an A380 (73 m) would draw about 9× a C172 (8 m). Add a per-feature size factor that compresses by length, `(lengthM / 9)^0.45` clamped to 0.8–2.2×, folded into the `scale` array.
   - The annotation/feature dirty-check signature includes the resolved model id.
4. **ADS-B** (phase 2): `AdsbPosition` parses the feed's `t` (for example `A388`). `AircraftModelType` gains ICAO aliases and `byIcao()`. `_adsbBackedPilot` fills `skin.typeId` only if the pilot published none.
5. **Attribution**, which CC-BY requires: a "3D aircraft models" section in `assets/legal/{en,de}` with title, author, link, CC BY 4.0, and "modified: simplified, gear/livery removed, recoloured, lights added".
6. **Only if Option B is used:** `AircraftModelService`/`AircraftModelRepository`.
   - Downloads content-addressed `<modelId>-<sha8>.glb` files from `../skylog-server` `/models/aircraft/` (base URL via `SkylogApiService`), verifies sha256, and caches in the app support dir.
   - The manifest entry gets `remote: true`. The map registers the model once the file lands.
   - Best-effort: offline, demo mode or no relay URL means the shape GLB is used.
   - Server: a static route plus the `src/` folder for GPL §3.
   - Effort: about +1–1.5 days.
7. **Mock:** `scripts/mock/src/` can give mock pilots a `skin.typeId`.
8. **Docs:** CLAUDE.md "Aircraft"/"Map" and `docs/MAPBOX.md` (pipeline, strobe layer, scale factor, index requirement).

**Out of scope:** `Plane3D` (runway hero, CustomPaint software renderer, a few-hundred-face budget per frame) and the flat silhouettes keep the existing shape meshes.

## Size estimate

- **Per model:** 3,000 tris after welding is about 3.5k vertices × 24 B (position + normal) plus 18 KB of uint16 indices, so **≈ 100 KB**. A 2,000-tri GA model is **≈ 65 KB**. Each strobe GLB is about 2 KB.
- **The 4 current downloads:** about **0.35 MB**.
- **Full catalog:** about 35 distinct models (families share one) → **≈ 3–3.5 MB** in `assets/models`, about **1.5–2 MB** after store compression. `assets/models` is 304 KB today; `assets/db` is 28 MB.
- **Runtime:** each type is registered once and instanced, and only types actually on screen are registered, so the cost is negligible.

## Effort estimate

| Work | Effort |
|---|---|
| Pipeline (Blender script, gear heuristic, lights, prop disc, validation, contact sheet) | 2–3 days |
| Per model: sourcing on Sketchfab (user), config, overrides, QA | 20–45 min × ~35 models ≈ 2–3 days |
| App integration (typeId publish, manifest, lazy registration, strobe layer, scale, legal, tests) | 2–3 days |
| ADS-B `t` mapping | ½ day |
| **Total** | **≈ 1.5–2 weeks** |

Same scope with FlightGear files: about 1 week, with most of the per-model time gone.

## Phasing
1. The pipeline plus the 4 downloaded models (A320, A330, A340, C172), `typeId` publishing, map integration and the strobe layer.
2. The next ~10 most common types: 737, 747, 777, A380, A350, PA-28, DR400, SR22, ATR, Dash 8, E-jets. Plus the ADS-B type code.
3. The rest of the catalog, helicopters (rotor disc instead of prop disc, same pipeline) and gliders.

## Verification
- **Pipeline:** the validator passes, and the contact sheet is checked by eye for gear, lights, colours and orientation.
- **Tests:**
  - `PlaneSkin` JSON round-trip with and without `typeId`.
  - The manifest covers catalog ids and its assets exist.
  - The resolution chain: type, then shape.
  - `byIcao`.
- `flutter analyze` is clean.
- **Manual (the user runs this):**
  - A Pixel build with `SKYLOG_3D_MODELS=true` (never the emulator).
  - `scripts/dev_scenario.sh` with mock pilots flying `a320`, `a340`, `cessna_172` and a type without a model. Expect the right models, blinking strobes, visible prop discs, sane relative sizes, and the shape fallback.
  - Then `cd scripts/mock && bun run mock teardown --yes`.
