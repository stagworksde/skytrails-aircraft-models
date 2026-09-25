import { describe, expect, test } from 'bun:test';
import { parseAc3d } from '../src/ac3d';

// Two nested objects: the child's `loc` is relative to its parent, and the
// world object overstates `kids` the way c172p.ac does.
const sample = `AC3Db
MATERIAL "white" rgb 1 1 1  amb 1 1 1  emis 0 0 0  spec 0 0 0  shi 10  trans 0
OBJECT world
kids 3
OBJECT group
name "gear"
loc 1 0 0
kids 1
OBJECT poly
name "NoseWheel"
texture "gear.png"
data 5
hello
loc 0 2 0
numvert 3
0 0 0
1 0 0
0 0 1
numsurf 2
SURF 0x10
mat 0
refs 3
0 0 0
1 1 0
2 0 1
SURF 0x02
mat 0
refs 2
0 0 0
1 1 0
kids 0
`;

describe('parseAc3d', () => {
  const ac = parseAc3d(sample);

  test('reads materials', () => {
    expect(ac.materials).toEqual([{ name: 'white', rgb: [1, 1, 1], transparency: 0 }]);
  });

  test('flattens objects with their ancestor path', () => {
    expect(ac.objects.map((o) => [o.path, o.name])).toEqual([[['gear'], 'NoseWheel']]);
  });

  test('applies parent and child offsets', () => {
    expect(ac.objects[0]!.verts[0]).toEqual([1, 2, 0]);
    expect(ac.objects[0]!.verts[1]).toEqual([2, 2, 0]);
  });

  test('keeps the texture name', () => {
    expect(ac.objects[0]!.texture).toBe('gear.png');
  });

  test('keeps polygons, skips line surfaces', () => {
    expect(ac.objects[0]!.surfaces).toEqual([
      {
        mat: 0,
        refs: [0, 1, 2],
        uvs: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
    ]);
  });
});
