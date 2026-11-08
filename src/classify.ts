// Decides what each AC3D object is, from its name and its ancestors' names.
//
// FlightGear modellers name parts for their animations (`NoseWheel`,
// `RightWheelStrut`, `Propeller.Fast`, `no1intake`, `Gear`), which is what
// makes gear, props and interiors removable by rule instead of by geometric
// guesswork. Where names run out — newer AI models merge the airframe into one
// `Body` mesh — `process.ts` finds the fin geometrically instead.

export type PartClass =
  /** Airframe, painted in the body tone. */
  | 'body'
  /** Fin and engines, painted in the livery accent tone. */
  | 'accent'
  | 'glass'
  /** Removed, unless the model's gear is fixed: the map draws aircraft in flight. */
  | 'gear'
  /** Removed: invisible from outside, costs triangles. */
  | 'interior'
  /** Removed and replaced by a prop disc. */
  | 'prop'
  /** Removed; the pipeline places its own lights. */
  | 'light'
  /** Removed: duplicates (light Off states), shadows, LODs. */
  | 'drop';

export interface ClassifyHints {
  /** Object names the model XML shows/hides with the gear (`select` animations). */
  gear: ReadonlySet<string>;
  /** Exact-name overrides from `models.ts`. */
  overrides: Readonly<Record<string, PartClass>>;
}

// Order matters: the first rule that matches wins, so the removal classes come
// before the paint classes, and `interior` before `light` and `prop` (a
// `NavLightSwitch` is a cockpit switch, a `PropControl` a cockpit lever).
// Names are English and French: the Aircraft Division models (DR400, DA42,
// Caravan, FK9) call a wheel `roue`, a canopy `verrière`, an engine `moteur`.
const rules: [PartClass, RegExp][] = [
  ['drop', /(light|lite)off$|^shadow|\blod\d|\.lod|damaged/i],
  [
    'interior',
    /seat|panel|yoke|pedal|pedestal|throttle|mixture|carbheat|switch|trimwheel|instrument|cockpit|console|cabin|interior|int$|pilot|stick|rod$|mount$|propcontrol|surround|siege|tableau|manche/i,
  ],
  [
    'light',
    /nav.?li(gh)?te?|(red|green|white)nav|strobe|beacon|becon|landing.?light|lndlight|taxi.?light|lighton$|lampe|glow|^flash\d|recog|wlight|antiicelight/i,
  ],
  ['prop', /prop(?!.*(boss|hub|spinner|control|cone))|helice|blade|blur/i],
  [
    'gear',
    /gear|wheel|(nose|side|main|tail|frt|lh|rh)[_ .-]?strut|damper|shock|trailingarm|oleo|tyre|tire|bogie|truck|axle|^axe|torque|steercyl|link(upper|lower)|collar|nosedoor|suspension|brake|roue|^cache[adg]?$|(^|[^a-z])(ng|mg|nlg|mlg)[a-z]*door/i,
  ],
  ['glass', /window|windshield|windscreen|glass|canopy|^screen(\.\d+)?$|vitre|^(toit)?verriere\d*$/i],
  [
    'accent',
    /vertstab|^fin\b|rudder|v.?tail|nacelle|intake|engine|engig|^eng|eng$|exhaust|cowl|pylon|tailcone|^(lh|rh)?no\d|fan$|moteur|^direction$|derive/i,
  ],
];

/** Names that mark a vertical tail. The fin is found geometrically when none match. */
export const finName = /vertstab|^fin\b|rudder|v.?tail|^direction$|derive/i;

export function classifyName(name: string): PartClass | undefined {
  for (const [cls, re] of rules) if (re.test(name)) return cls;
  return undefined;
}

const inherited: ReadonlySet<PartClass> = new Set(['gear', 'interior', 'drop', 'prop']);

/**
 * What an object's own name says outright. It beats the XML gear hints: a
 * model's gear `select` animation often also switches its propeller discs
 * and lights, and those must still become prop discs and lights.
 */
const decisive: ReadonlySet<PartClass> = new Set(['drop', 'interior', 'light', 'prop']);

/**
 * Classifies one object: an explicit override, then a decisive own name,
 * then the XML gear hints, then an ancestor's removal class (every child of
 * a `gear` group is gear), then the remaining name rules.
 */
export function classify(path: readonly string[], name: string, hints: ClassifyHints): PartClass {
  const override = hints.overrides[name];
  if (override) return override;

  const own = classifyName(name);
  if (own && decisive.has(own)) return own;
  if ([...path, name].some((n) => hints.gear.has(n))) return 'gear';
  for (const n of path) {
    const cls = hints.overrides[n] ?? classifyName(n);
    if (cls && inherited.has(cls)) return cls;
  }
  return own ?? 'body';
}

export const removedClasses: ReadonlySet<PartClass> = new Set([
  'gear',
  'interior',
  'prop',
  'light',
  'drop',
]);

const removedWithFixedGear: ReadonlySet<PartClass> = new Set([...removedClasses].filter((c) => c !== 'gear'));

/** What a model loses. Fixed gear stays (painted body): it is out in flight too. */
export function removedClassesFor(fixedGear = false): ReadonlySet<PartClass> {
  return fixedGear ? removedWithFixedGear : removedClasses;
}
