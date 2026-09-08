import categories from './categories.json';
import colors from './colors.json';
import animals from './animals.json';
import numbers from './numbers.json';
import countObjects from './count-objects.json';
import audio from './audio.json';
import recipes from './recipes.json';
import type { ContentV2 } from './types.ts';

// Строгая проверка каталогов выполняется до сборки, Zod не попадает в браузер.
export const contentV2 = {
  categories,
  colors,
  animals,
  numbers,
  countObjects,
  audio,
  recipes,
} as ContentV2;
