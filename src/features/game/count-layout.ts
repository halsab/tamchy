import type { TintedPixels } from '../../services/assets/tint.ts';

export function countLayout(value: number, limit: number) {
  const columns = Math.min(value, limit);
  const rows = Math.ceil(value / columns);
  const cells = Array.from({ length: value }, (_, index) => {
    const y = Math.floor(index / columns);
    const occupied = Math.min(columns, value - y * columns);
    return { x: (columns - occupied) / 2 + (index % columns), y };
  });
  return { columns, rows, cells };
}

export function visibleBounds({ width, height, data }: TintedPixels) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Почти прозрачные следы экспорта не определяют оптический размер предмета.
      if (data[(y * width + x) * 4 + 3]! < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return right < left
    ? { x: 0, y: 0, width, height }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
