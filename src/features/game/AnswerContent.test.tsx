// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnswerContent } from './AnswerContent.tsx';
import { contentV2 } from '../../content/v2/catalog.ts';
import { createExerciseGenerator } from '../../domain/game/exercises.ts';

afterEach(cleanup);
const boundary = {
  imageUrl: (path: string) => `/${path}`,
  onImageError: vi.fn(),
};

it('цифры 1–10 содержат точное число одинаковых предметов из одного упражнения', () => {
  const generate = createExerciseGenerator(
    contentV2,
    'numbers',
    () => 0.999999,
  );
  for (let index = 0; index < 10; index++) {
    const exercise = generate(4);
    if (exercise.kind !== 'N1-A') throw new Error('Ожидается число');
    const countObject = {
      kind: 'raster' as const,
      id: 'apple',
      image: 'assets/images/numbers/count-apple.webp',
    };
    for (const item of exercise.options) {
      const view = render(
        <AnswerContent item={item} countObject={countObject} {...boundary} />,
      );
      expect(screen.getByText(String(item.value))).toBeTruthy();
      const images = view.container.querySelectorAll('img');
      expect(images).toHaveLength(item.value);
      expect(
        [...images].every(
          (image) => image.getAttribute('src') === `/${countObject.image}`,
        ),
      ).toBe(true);
      view.unmount();
    }
  }
});

it('белая фишка сохраняет точный цвет, сбой животного передаёт ресурс', () => {
  const white = render(
    <AnswerContent
      item={{ kind: 'color', id: 'color-white', hex: '#FFFFFF', labelTt: 'Ак' }}
      {...boundary}
    />,
  );
  expect(white.container.firstElementChild?.getAttribute('style')).toContain(
    'rgb(255, 255, 255)',
  );
  white.unmount();
  const image = 'assets/images/animals/animal-cat.webp';
  const view = render(
    <AnswerContent
      item={{ kind: 'animal', id: 'animal-cat', image, labelTt: 'Мәче' }}
      {...boundary}
    />,
  );
  fireEvent.error(view.container.querySelector('img')!);
  expect(boundary.onImageError).toHaveBeenCalledWith(image);
});
