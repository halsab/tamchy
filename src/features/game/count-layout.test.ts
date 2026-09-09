import { expect, it } from 'vitest';
import { countLayout, visibleBounds } from './count-layout.ts';

it('центрирует одиночный предмет и каждый неполный ряд без изменения размера ячейки', () => {
  expect(countLayout(1, 4)).toEqual({
    columns: 1,
    rows: 1,
    cells: [{ x: 0, y: 0 }],
  });
  expect(countLayout(5, 4)).toEqual({
    columns: 4,
    rows: 2,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 1.5, y: 1 },
    ],
  });
  expect(countLayout(6, 4).cells.slice(4)).toEqual([
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);
});
it('находит видимую область, сохраняя пропорции и прозрачность источника', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  data[(1 * 4 + 2) * 4 + 3] = 255;
  data[(2 * 4 + 2) * 4 + 3] = 255;
  const before = data.slice();
  expect(visibleBounds({ width: 4, height: 4, data })).toEqual({
    x: 2,
    y: 1,
    width: 1,
    height: 2,
  });
  expect(data).toEqual(before);
});
