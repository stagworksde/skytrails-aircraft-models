import { describe, expect, test } from 'bun:test';
import { classify, classifyName, type PartClass } from '../src/classify';

const none = { gear: new Set<string>(), overrides: {} };

describe('classifyName', () => {
  const cases: [string, PartClass | undefined][] = [
    // c172p.ac
    ['NoseWheel', 'gear'],
    ['RightWheelStrut', 'gear'],
    ['RightWingStrut', undefined],
    ['Oleo', 'gear'],
    ['Axle', 'gear'],
    ['PilotSeat', 'interior'],
    ['NavLightSwitch', 'interior'],
    ['LeftDoorInt', 'interior'],
    ['Cabin', 'interior'],
    ['Propeller.Fast', 'prop'],
    ['Hub', undefined],
    ['RightNavLightOn', 'light'],
    ['RightNavLightOff', 'drop'],
    ['BeaconOn', 'light'],
    ['WindShield', 'glass'],
    ['Windows', 'glass'],
    ['VTail', 'accent'],
    ['Rudder', 'accent'],
    ['Fuselage', undefined],
    ['Wings', undefined],
    // older airliner AI models
    ['lhsidestrut', 'gear'],
    ['nosegear', 'gear'],
    ['ngrhfwddoor', 'gear'],
    ['btyrerf', 'gear'],
    ['lhnavlite', 'light'],
    ['upperbecon', 'light'],
    ['no1intake', 'accent'],
    ['no2pylon', 'accent'],
    ['rhno3eng', 'accent'],
    ['vertstab', 'accent'],
    ['rhwing', undefined],
    ['lhstab', undefined],
    // wing, roof and window struts are structure, not gear (Piper Cub)
    ['strut_front_l', undefined],
    ['roof_strut_l', undefined],
    ['wheel_strut_l', 'gear'],
    ['tail_wheel_strut', 'gear'],
    ['suspension_coil_l', 'gear'],
    // Citation Bravo's gear legs
    ['FrtStrut', 'gear'],
    ['LHstrut', 'gear'],
    ['FUdamper', 'gear'],
    ['RHLwrShock', 'gear'],
    ['LHTrailingArm', 'gear'],
    // props, with prefixes and in French, but not their hubs or levers
    ['DH3_PropR', 'prop'],
    ['SF3_Prop_L', 'prop'],
    ['heliceD', 'prop'],
    ['propblurleft', 'prop'],
    ['propbossleft', undefined],
    ['PropControl', 'interior'],
    ['propcontrolsurround', 'interior'],
    // French parts (DR400, DA42, Caravan)
    ['roueA', 'gear'],
    ['axeDB', 'gear'],
    ['cacheG', 'gear'],
    ['vitres', 'glass'],
    ['verriere', 'glass'],
    ['toitverriere', 'glass'],
    ['tourverriere', undefined],
    ['lamperouge', 'light'],
    ['moteurs', 'accent'],
    ['direction', 'accent'],
    // Citation light objects
    ['Flash01', 'light'],
    ['Whiteglow', 'light'],
    ['RecogLight', 'light'],
    ['greennav', 'light'],
    ['whitenav_0', 'light'],
  ];
  for (const [name, cls] of cases) {
    test(`${name} → ${cls ?? 'none'}`, () => expect(classifyName(name)).toBe(cls));
  }
});

describe('classify', () => {
  test('children of a gear group are gear', () => {
    expect(classify(['gear.001', 'gear'], 'gear_0', none)).toBe('gear');
  });

  test('XML gear hints win over an ordinary name', () => {
    expect(classify([], '320_gear_parts', { gear: new Set(['320_gear_parts']), overrides: {} })).toBe('gear');
    expect(classify([], 'Body', { gear: new Set(['Body']), overrides: {} })).toBe('gear');
  });

  test('a prop or light switched with the gear stays a prop or light', () => {
    const hints = { gear: new Set(['propdisc', 'rednav']), overrides: {} };
    expect(classify([], 'propdisc', hints)).toBe('prop');
    expect(classify([], 'rednav', hints)).toBe('light');
  });

  test('overrides win over everything', () => {
    expect(classify([], 'NoseWheel', { gear: new Set(), overrides: { NoseWheel: 'body' } })).toBe('body');
  });

  test('unmatched names are body', () => {
    expect(classify([], 'Body', none)).toBe('body');
  });
});
