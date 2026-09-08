import categories from './categories.json' with { type: 'json' };
import colors from './colors.json' with { type: 'json' };
import animals from './animals.json' with { type: 'json' };
import numbers from './numbers.json' with { type: 'json' };
import countObjects from './count-objects.json' with { type: 'json' };
import audio from './audio.json' with { type: 'json' };
import recipes from './recipes.json' with { type: 'json' };
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
