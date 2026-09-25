import { describe, expect, test } from 'bun:test';
import { gearObjectNames, lightPositions } from '../src/fgxml';

describe('gearObjectNames', () => {
  test('takes select animations keyed on airspeed', () => {
    const xml = `<?xml version="1.0"?><PropertyList>
      <animation><type>select</type><object-name>Gear</object-name>
        <condition><less-than><property>velocities/true-airspeed-kt</property><value>180</value></less-than></condition>
      </animation>
      <animation><type>rotate</type><object-name>Elevator</object-name>
        <property>velocities/true-airspeed-kt</property></animation>
    </PropertyList>`;
    expect([...gearObjectNames(xml)]).toEqual(['Gear']);
  });
});

describe('lightPositions', () => {
  test('maps FlightGear offsets (x aft, y right, z up) to glTF (X right, Y up, Z aft)', () => {
    const xml = `<?xml version="1.0"?><PropertyList>
      <model><name>nav-right</name><path>x.xml</path>
        <offsets><x-m>10.5</x-m><y-m>38.2</y-m><z-m>7.7</z-m></offsets></model>
      <model><name>something-else</name><offsets><x-m>1</x-m></offsets></model>
    </PropertyList>`;
    expect(lightPositions(xml)).toEqual([{ kind: 'nav-right', pos: [38.2, 7.7, 10.5] }]);
  });
});
