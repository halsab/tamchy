// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contentV2 as content } from '../../content/v2/catalog.ts';
import { seniorExercise } from '../../../tests/fixtures/senior-exercises.ts';
import { SeniorPrompt, SeniorAnswerContent } from './SeniorContent.tsx';
import type { SeniorVisualAssets } from './SeniorIllustration.tsx';
import { tintNeutralPixels } from '../../services/assets/tint.ts';
import type {
  CountIllustration,
  ExerciseKind,
  SeniorExercise,
} from '../../domain/game/exercise.ts';

const pixels = tintNeutralPixels(
  { width: 1, height: 1, data: new Uint8Array([128, 255]) },
  '#D94343',
);
const drawImage = vi.fn(),
  putImageData = vi.fn();
const context = { drawImage, putImageData, clearRect: vi.fn() };
const assets: SeniorVisualAssets = {
  imageUrl: (path) => `/tamchy/${path}`,
  tintedPixels: vi.fn(() => pixels),
  onImageError: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const apple: CountIllustration = {
  kind: 'raster',
  id: 'count-apple',
  image: 'assets/images/numbers/count-apple.webp',
};
function answers(exercise: SeniorExercise) {
  return exercise.options.map((option) => (
    <button key={option.id} aria-label={option.labelTt}>
      <SeniorAnswerContent
        exercise={exercise}
        option={option}
        content={content}
        assets={assets}
      />
    </button>
  ));
}

it('N1-A показывает только цифры, N1-C — только группы без подписи-ответа', () => {
  const number = seniorExercise('N1-A');
  const view = render(<>{answers(number)}</>);
  expect(screen.getByText('4')).toBeTruthy();
  expect(view.container.querySelectorAll('img, canvas')).toHaveLength(0);
  view.unmount();
  const group = {
    ...seniorExercise('N1-C'),
    countObject: apple,
  } as SeniorExercise;
  const groups = render(
    <>
      <SeniorPrompt exercise={group} content={content} assets={assets} />
      {answers(group)}
    </>,
  );
  expect(screen.getByText('4')).toBeTruthy();
  for (const [index, button] of screen.getAllByRole('button').entries()) {
    expect(button.textContent).toBe('');
    expect(button.querySelectorAll('img')).toHaveLength(
      (group.options[index] as { value: number }).value,
    );
  }
  expect(groups.container.querySelectorAll('canvas')).toHaveLength(0);
});
it('N1-B отображает точное количество, N3 — обе группы и явно убранную часть', () => {
  for (const kind of ['N1-B', 'N3-A', 'N3-B'] as const) {
    const e = seniorExercise(kind);
    const exercise = {
      ...e,
      prompt: { ...e.prompt, countObject: apple },
    } as SeniorExercise;
    const view = render(
      <SeniorPrompt exercise={exercise} content={content} assets={assets} />,
    );
    const expected = kind === 'N1-B' ? 4 : kind === 'N3-A' ? 4 : 7;
    expect(view.container.querySelectorAll('img')).toHaveLength(expected);
    expect(
      view.container.querySelectorAll('[data-removed="true"]'),
    ).toHaveLength(kind === 'N3-B' ? 3 : 0);
    if (kind === 'N3-A')
      expect(
        [...view.container.querySelectorAll('[data-quantity]')].map((x) =>
          x.getAttribute('data-quantity'),
        ),
      ).toEqual(['1', '3']);
    expect(view.container.textContent).not.toMatch(/[+=−]/u);
    view.unmount();
  }
});
it('C2/C3 выводят точные пиксели через существующую перекраску, размер меняет только рисунок', () => {
  const e = seniorExercise('C2');
  const view = render(
    <SeniorPrompt exercise={e} content={content} assets={assets} />,
  );
  expect(assets.tintedPixels).toHaveBeenCalledWith(
    'assets/images/shapes/shape-circle.png',
    '#D94343',
  );
  expect(putImageData.mock.calls[0]![0].data).toEqual(
    new Uint8ClampedArray([217, 67, 67, 255]),
  );
  view.unmount();
  const shapes = seniorExercise('C3-B');
  render(<>{answers(shapes)}</>);
  expect(screen.getAllByRole('button')).toHaveLength(4);
  expect(document.querySelectorAll('[data-size="big"]')).toHaveLength(3);
  expect(document.querySelectorAll('[data-size="small"]')).toHaveLength(1);
});
it('C4 содержит весь ряд, одну пустую следующую позицию и точный белый', () => {
  const e = seniorExercise('C4');
  if (e.kind !== 'C4') throw Error();
  const view = render(
    <SeniorPrompt
      exercise={{
        ...e,
        prompt: { ...e.prompt, colorIds: ['white', 'blue', 'white', 'blue'] },
      }}
      content={content}
      assets={assets}
    />,
  );
  expect(view.container.querySelectorAll('[data-color]')).toHaveLength(4);
  expect(
    view.container.querySelector('[data-color="white"]')?.getAttribute('style'),
  ).toContain('rgb(255, 255, 255)');
  expect(view.container.querySelectorAll('[data-next]')).toHaveLength(1);
  expect(
    view.container
      .querySelector('[data-next]')
      ?.previousElementSibling?.getAttribute('data-color'),
  ).toBe('blue');
});
it('A3 использует альфу исходного WebP, полноцветные ответы и сообщает сбой ресурса', () => {
  const e = seniorExercise('A3');
  if (e.kind !== 'A3') throw Error();
  const view = render(
    <>
      <SeniorPrompt exercise={e} content={content} assets={assets} />
      {answers(e)}
    </>,
  );
  const silhouette = view.container.querySelector(
    '[data-silhouette]',
  ) as HTMLElement;
  expect(silhouette.style.maskImage).toContain(`/tamchy/${e.prompt.image}`);
  const image = view.container.querySelector('img')!;
  fireEvent.error(image);
  expect(assets.onImageError).toHaveBeenCalledWith(e.prompt.image);
  expect(screen.queryByText('Мәче')).toBeNull();
});
it('счётные PNG рисуются одинаковыми ячейками без отдельных больших буферов на предмет', () => {
  const e = seniorExercise('N1-C');
  const view = render(<>{answers(e)}</>);
  expect(view.container.querySelectorAll('canvas')).toHaveLength(4);
  expect(drawImage).toHaveBeenCalledTimes(14);
  for (const call of drawImage.mock.calls)
    expect(call.slice(-2)).toEqual([120, 120]);
  expect(new Set(drawImage.mock.calls.map((x) => x[0])).size).toBe(4);
});
it('поздняя перекраска перерисовывает canvas, ошибка canvas возвращает обязательный ресурс', () => {
  const e = seniorExercise('C2');
  const view = render(
    <SeniorPrompt
      exercise={e}
      content={content}
      assets={{ ...assets, tintedPixels: () => undefined }}
    />,
  );
  expect(putImageData).not.toHaveBeenCalled();
  view.rerender(
    <SeniorPrompt exercise={e} content={content} assets={assets} />,
  );
  expect(putImageData).toHaveBeenCalledTimes(1);
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  view.unmount();
  render(<SeniorPrompt exercise={e} content={content} assets={assets} />);
  expect(assets.onImageError).toHaveBeenCalledWith(
    'assets/images/shapes/shape-circle.png',
    '#D94343',
  );
});
it('каждый вид имеет представление задания и ответа без утечки правильного ID в подпись', () => {
  for (const kind of [
    'C1',
    'C2',
    'C3-A',
    'C3-B',
    'C4',
    'A1',
    'A2',
    'A3',
    'N1-A',
    'N1-B',
    'N1-C',
    'N2',
    'N3-A',
    'N3-B',
  ] as ExerciseKind[]) {
    const e = seniorExercise(kind);
    const view = render(
      <>
        <SeniorPrompt exercise={e} content={content} assets={assets} />
        {answers(e)}
      </>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(kind === 'N2' ? 2 : 4);
    expect(view.container.textContent).not.toContain(e.correctOptionId);
    view.unmount();
  }
});
