// One entry per output model. Everything the pipeline knows about a model that
// it can't read from the FlightGear files themselves lives here.
//
// `typeIds` are Skytrails catalog ids (`AircraftModelType.id` in the app) this
// model is drawn for. Ids are stable forever on the app side, so a typo here
// shows up as a validation error, never as a silent miss.

import type { PartClass } from './src/classify';

export interface ModelSpec {
  /** Output id: `ac_<id>.glb`. Stable once released. */
  id: string;
  /** Folder under fgdata `AI/Aircraft/`. */
  folder: string;
  /** The geometry, relative to [folder]. */
  ac: string;
  /** Main model XML (gear `select` animations), relative to [folder]. */
  mainXml?: string;
  /** Light positions (nav/strobe/beacon offsets), relative to [folder]. */
  lightsXml?: string;
  /** Skytrails catalog ids this model is drawn for. */
  typeIds: string[];
  /** Real overall length; a sanity check on the model's own metres (±10 %). */
  lengthM: number;
  /** Triangle budget for the main model. */
  budget: number;
  /** Per-object class overrides, keyed by object name (exact). */
  classes?: Record<string, PartClass>;
  /**
   * The model's neutral paint scheme (relative to [folder]), usually
   * `Textures/Default`: plain white with windows, cockpit windows, doors and
   * engine details, no airline. Kept because without it an airliner is an
   * anonymous white tube. Airline liveries are never used.
   */
  textureDir?: string;
  /**
   * Regions painted over in the output texture, per texture file, as
   * `[x, y, width, height]` fractions of the image (origin top-left) — for
   * branding a default scheme still carries.
   */
  textureMasks?: Record<string, [number, number, number, number][]>;
  /** Longest edge of the output textures, px (default 1024). */
  textureSize?: number;
}

/** fgdata commit every model is pinned to (gitlab.com/flightgear/fgdata). */
export const FGDATA_COMMIT = 'd96d5702c3bdeab4befb57b07079c3b4fad2dcce';

export const models: ModelSpec[] = [
  // ── Light aircraft ──
  // Also the Cessna 152: same high-wing layout, a size smaller.
  {
    id: 'c172',
    folder: 'c172',
    ac: 'Models/c172p.ac',
    mainXml: 'c172-default.xml',
    textureDir: 'Textures/Default',
    textureSize: 256,
    typeIds: ['cessna_172', 'c152'],
    lengthM: 8.28,
    budget: 1500,
  },
  {
    id: 'pa18',
    folder: 'Cub',
    ac: 'Models/Cub.ac',
    mainXml: 'Cub-default.xml',
    textureDir: 'Models',
    textureSize: 512,
    typeIds: ['pa18', 'piper_pa12'],
    lengthM: 6.88,
    budget: 1500,
  },
  {
    id: 'c182',
    folder: 'c182',
    ac: 'Models/c182.ac',
    mainXml: 'c182-default.xml',
    // The main gear's spring legs, in one object with a generic name.
    classes: { struts: 'gear' },
    textureDir: 'Models',
    textureSize: 512,
    // A real registration, N301DP.
    textureMasks: { 'c182-01.png': [[0.18, 0.105, 0.1, 0.028], [0.36, 0.268, 0.095, 0.03]] },
    typeIds: ['c182'],
    lengthM: 8.84,
    budget: 1500,
  },
  {
    id: 'c208',
    folder: 'Cessna208Caravan',
    ac: 'Models/caravan.ac',
    mainXml: 'Cessna208Caravan-default.xml',
    textureDir: 'Models',
    textureSize: 512,
    typeIds: ['c208'],
    lengthM: 11.46,
    budget: 1500,
  },
  // The low-wing single for the whole class until each has its own model.
  {
    id: 'pa28',
    folder: 'pa-28',
    ac: 'Models/pa-28.ac',
    mainXml: 'pa-28-main.xml',
    textureDir: 'Textures/Default',
    textureSize: 512,
    typeIds: ['p28a', 'aquila', 'dv20', 'da40', 'sr20', 'sr22', 'be36', 'tbm9', 'pc12', 'wt9', 'vl3'],
    lengthM: 7.25,
    budget: 1500,
  },
  {
    id: 'dr40',
    folder: 'DR400',
    ac: 'Models/dr400.ac',
    mainXml: 'DR400-default.xml',
    textureDir: 'Models',
    textureSize: 512,
    typeIds: ['dr40'],
    lengthM: 6.96,
    budget: 1500,
  },
  // Also the other light low-wing twins with the engines on the wing.
  {
    id: 'da42',
    folder: 'Diamond-Da42',
    ac: 'Models/da42.ac',
    mainXml: 'Diamond-Da42-default.xml',
    textureDir: 'Models',
    textureSize: 512,
    typeIds: ['da42', 'da62', 'pa34'],
    lengthM: 8.56,
    budget: 1500,
  },
  // Stands in for the Baron: a low-wing piston twin.
  {
    id: 'c310',
    folder: 'c310',
    ac: 'Models/c310-dpm.ac',
    mainXml: 'c310-default.xml',
    textureDir: 'Models',
    textureSize: 512,
    // A real registration, C-GDPM.
    textureMasks: { 'c310-01.png': [[0.465, 0.08, 0.195, 0.045], [0.29, 0.205, 0.195, 0.048]] },
    typeIds: ['be58'],
    lengthM: 9.0,
    budget: 1500,
  },
  {
    id: 'be20',
    folder: 'beech-200',
    ac: 'Models/beech-200.ac',
    mainXml: 'beech-200-main.xml',
    textureDir: 'Textures/Default',
    textureSize: 512,
    typeIds: ['be20'],
    lengthM: 13.34,
    budget: 1500,
  },
  // High-wing microlights.
  {
    id: 'fk9',
    folder: 'FK9MK2',
    ac: 'Models/fk9mk2.ac',
    mainXml: 'Models/fk9mk2-ai.xml',
    textureDir: 'Models',
    textureSize: 512,
    // A real registration, D-MSJA.
    textureMasks: { 'texture.png': [[0.5, 0.148, 0.165, 0.035], [0.355, 0.343, 0.165, 0.037]] },
    typeIds: ['c42', 'p92'],
    lengthM: 6.0,
    budget: 1500,
  },
  // ── Gliders ──
  // Every glider type until they have their own models. No default paint: its
  // only textures carry real gliders' registrations, so it stays in flat tones.
  {
    id: 'centrair101',
    folder: 'centrair-101',
    ac: 'Models/centrair-101.ac',
    mainXml: 'centrair-101-default.xml',
    typeIds: ['as21', 'duod', 'disc', 'sf25'],
    lengthM: 6.59,
    budget: 1200,
  },
  // ── Airliners ──
  {
    id: 'a220',
    folder: '220',
    ac: 'Models/223.ac',
    mainXml: '223-main.xml',
    lightsXml: 'Lights/223-NavLights.xml',
    textureDir: 'Textures/Default',
    // Airbus house livery: AIRBUS A220-300 lettering, the C-FFDD registration
    // with flags, navy engine and belly panels, the patterned fin.
    textureMasks: {
      '223-tex.png': [
        [0.18, 0.185, 0.19, 0.03],
        [0.63, 0.315, 0.195, 0.03],
        [0.665, 0.025, 0.075, 0.02],
        [0.665, 0.093, 0.075, 0.02],
        [0.665, 0.16, 0.075, 0.02],
        [0.255, 0.29, 0.075, 0.02],
        [0.78, 0.04, 0.1, 0.06],
        [0.73, 0.16, 0.145, 0.07],
        [0.13, 0.295, 0.14, 0.065],
        [0.165, 0.418, 0.12, 0.068],
        [0.062, 0.51, 0.437, 0.07],
        [0.531, 0.555, 0.19, 0.17],
        [0.775, 0.555, 0.19, 0.17],
        [0.16, 0.92, 0.115, 0.065],
      ],
    },
    typeIds: ['a220'],
    lengthM: 38.7,
    budget: 3000,
  },
  {
    id: 'a320',
    folder: 'A320',
    ac: 'Models/A320.ac',
    mainXml: 'A320-main.xml',
    lightsXml: 'Lights/A320-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['a320'],
    lengthM: 37.57,
    budget: 3000,
  },
  {
    id: 'a333',
    folder: 'A333',
    ac: 'Models/A333.ac',
    mainXml: 'A333-main.xml',
    lightsXml: 'Lights/333-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['a330'],
    lengthM: 63.66,
    budget: 3000,
  },
  {
    id: 'a343',
    folder: 'A343',
    ac: 'Models/A343.ac',
    mainXml: 'A343-main.xml',
    lightsXml: 'Lights/343-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['a340'],
    lengthM: 63.69,
    budget: 3000,
  },
  {
    id: 'a359',
    folder: 'A350',
    ac: 'Models/359.ac',
    mainXml: '359-main.xml',
    lightsXml: 'Lights/359-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['a350'],
    lengthM: 66.8,
    budget: 3000,
  },
  {
    id: 'a380',
    folder: 'A380',
    ac: 'Models/388.ac',
    mainXml: '388-main.xml',
    lightsXml: 'Lights/388-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['a380'],
    lengthM: 72.72,
    budget: 3000,
  },
  {
    id: 'b738',
    folder: '738',
    ac: 'Models/737-800.ac',
    mainXml: '738-main.xml',
    lightsXml: 'Lights/738-NavLights.xml',
    textureDir: 'Textures/Default',
    // FlightGear's fictional "Gooneybird" airline wordmark.
    textureMasks: { '738-tex.png': [[0.655, 0.925, 0.22, 0.075]] },
    typeIds: ['b737', 'b737max'],
    lengthM: 39.5,
    budget: 3000,
  },
  {
    id: 'b744',
    folder: '747',
    ac: 'Models/744.ac',
    mainXml: '744-main.xml',
    lightsXml: 'Lights/744-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['b747'],
    lengthM: 70.66,
    budget: 3000,
  },
  {
    id: 'b752',
    folder: '757',
    ac: 'Models/757-200.ac',
    mainXml: '757-200-default.xml',
    textureDir: 'Textures/Default',
    typeIds: ['b757'],
    lengthM: 47.32,
    budget: 3000,
  },
  {
    id: 'b77w',
    folder: '777',
    ac: 'Models/77W.ac',
    mainXml: '77W-main.xml',
    lightsXml: 'Lights/77W-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['b777'],
    lengthM: 73.86,
    budget: 3000,
  },
  {
    id: 'e190',
    folder: 'E90',
    ac: 'Models/E90.ac',
    mainXml: 'E90-main.xml',
    lightsXml: 'Lights/E90-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['e170'],
    lengthM: 36.24,
    budget: 3000,
  },
  {
    id: 'e195',
    folder: 'E95',
    ac: 'Models/E95.ac',
    mainXml: 'E95-main.xml',
    lightsXml: 'Lights/E95-NavLights.xml',
    textureDir: 'Textures/Default',
    // Embraer house livery: the 195 lettering, EMBRAER wordmarks, arrow logos,
    // the blue band.
    textureMasks: {
      'E95-tex.png': [
        [0.235, 0, 0.765, 0.13],
        [0.705, 0.17, 0.13, 0.055],
        [0.895, 0.155, 0.07, 0.05],
        [0.16, 0.92, 0.13, 0.055],
        [0.04, 0.905, 0.07, 0.05],
        [0.04, 0.045, 0.07, 0.065],
        [0.27, 0.605, 0.045, 0.045],
        [0.13, 0.73, 0.045, 0.05],
        [0.89, 0.8, 0.065, 0.06],
      ],
    },
    typeIds: ['e2'],
    lengthM: 38.65,
    budget: 3000,
  },
  // ── Regional ──
  {
    id: 'at72',
    folder: 'AT7',
    ac: 'Models/AT7.ac',
    mainXml: 'AT7-main.xml',
    lightsXml: 'Lights/AT7-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['atr'],
    lengthM: 27.17,
    budget: 2000,
  },
  // Also the Dorniers: high-wing twin turboprops.
  {
    id: 'dh8c',
    folder: 'DH3',
    ac: 'Models/DH3.ac',
    mainXml: 'DH3-main.xml',
    lightsXml: 'Lights/DH3-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['dh8', 'd228', 'd328'],
    lengthM: 25.68,
    budget: 2000,
  },
  {
    id: 'dh8d',
    folder: 'DH4',
    ac: 'Models/DH4.ac',
    mainXml: 'DH4-main.xml',
    lightsXml: 'Lights/DH4-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['dh8d'],
    lengthM: 32.84,
    budget: 2000,
  },
  {
    id: 'crj2',
    folder: 'CR2',
    ac: 'Models/CR2.ac',
    mainXml: 'CR2-main.xml',
    lightsXml: 'Lights/CR2-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['crj'],
    lengthM: 26.77,
    budget: 2000,
  },
  {
    id: 'crj7',
    folder: 'CR7',
    ac: 'Models/CR7.ac',
    mainXml: 'CR7-main.xml',
    lightsXml: 'Lights/CR7-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['crj7'],
    lengthM: 32.3,
    budget: 2000,
  },
  {
    id: 'e145',
    folder: 'ERJ145',
    ac: 'Models/ERJ-145.ac',
    mainXml: 'ERJ145-main.xml',
    textureDir: 'Textures/Default',
    typeIds: ['erj'],
    lengthM: 29.87,
    budget: 2000,
  },
  {
    id: 'sf34',
    folder: 'SF3',
    ac: 'Models/SF3.ac',
    mainXml: 'SF3-main.xml',
    lightsXml: 'Lights/SF3-NavLights.xml',
    textureDir: 'Textures/Default',
    typeIds: ['sf34'],
    lengthM: 19.73,
    budget: 2000,
  },
  // ── Business jets ──
  // The small and mid-size bizjets: rear engines, low wing.
  {
    id: 'c550',
    folder: 'Citation-Bravo',
    ac: 'Models/bravo.ac',
    mainXml: 'Citation-Bravo-default.xml',
    textureDir: 'Models',
    textureSize: 512,
    typeIds: ['c510', 'c525', 'c560xl', 'c680', 'e50p', 'e55p', 'pc24', 'ha420', 'ea50', 'lj45'],
    lengthM: 14.39,
    budget: 1500,
  },
  // Large-cabin bizjets. The Falcons have a third engine this model lacks.
  {
    id: 'cl60',
    folder: 'Bombardier-Challenger',
    ac: 'Models/chal604.ac',
    mainXml: 'Bombardier-Challenger-default.xml',
    textureDir: 'Textures/Default',
    textureSize: 512,
    typeIds: ['cl30', 'cl60', 'g280', 'f900', 'fa7x'],
    lengthM: 20.85,
    budget: 1500,
  },
  // Ultra-long-range bizjets.
  {
    id: 'legacy',
    folder: 'Embraer-Legacy',
    ac: 'Models/legacy.ac',
    mainXml: 'Embraer-Legacy-default.xml',
    textureDir: 'Textures/Default',
    textureSize: 512,
    typeIds: ['glex', 'glf5', 'glf6'],
    lengthM: 26.33,
    budget: 2000,
  },
];
