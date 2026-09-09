// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CountGroup } from './CountGroup.tsx';
import { mockCanvas } from '../../../tests/helpers/browser.ts';
let contexts: ReturnType<typeof mockCanvas>;
beforeEach(() => {
  contexts = mockCanvas();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('рисует одинаковые предметы и центрирует последний ряд по реальным координатам', () => {
  const pixels = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]),
  };
  const view = render(
    <CountGroup value={5} maxValue={10} pixels={pixels} onError={vi.fn()} />,
  );
  const canvas = view.container.querySelector('canvas')!;
  const draw = contexts.get(canvas)!.drawImage;
  expect(draw).toHaveBeenCalledTimes(5);
  for (const call of draw.mock.calls)
    expect(call.slice(-2)).toEqual([105.6, 52.8]);
  expect(draw.mock.calls[4]![5]).toBeCloseTo((canvas.width - 105.6) / 2);
  expect(draw.mock.calls[4]![6]).toBeGreaterThan(120);
});

it('ошибка актуального растра сообщается, поздние результаты прежней группы игнорируются', () => {
  const images: {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    onload?: () => void;
    onerror?: () => void;
  }[] = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 1;
      naturalHeight = 1;
      constructor() {
        images.push(this);
      }
    },
  );
  const error = vi.fn();
  const view = render(
    <CountGroup value={2} maxValue={4} src="old.webp" onError={error} />,
  );
  const target = view.container.querySelector('canvas')!;
  view.rerender(
    <CountGroup value={3} maxValue={4} src="new.webp" onError={error} />,
  );
  images[0]!.onload!();
  images[0]!.onerror!();
  expect(error).not.toHaveBeenCalled();
  expect(contexts.get(target)).toBeUndefined();
  images[1]!.onload!();
  expect(contexts.get(target)!.drawImage).toHaveBeenCalledTimes(3);
  images[1]!.onerror!();
  expect(error).toHaveBeenCalledOnce();
  view.unmount();
  images[1]!.onerror!();
  expect(error).toHaveBeenCalledOnce();
});
