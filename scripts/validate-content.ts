import { validateReviewedGraphics } from './lib/senior-content.ts';
import { resolve } from 'node:path';
import { readContent } from './lib/read-content.ts';
import {
  assertCompleteContent,
  formatResourceReport,
  inspectResources,
} from './lib/resources.ts';

try {
  const mode = process.argv[2];
  if (mode !== 'catalog' && mode !== 'content' && mode !== 'v2')
    throw new Error('Ожидается режим catalog, content или v2');
  const root = resolve(import.meta.dirname, '..');
  const { catalog } = await readContent(root);
  const report = await inspectResources(resolve(root, 'public'), catalog);
  await validateReviewedGraphics(root, catalog);
  console.log(
    'Каталог v2: 13 цветов, 39 животных, 20 чисел, 13 типов счёта; 43 WebP, 12 PNG, 4 иконки, 189 MP3. Структура и словарь проверены.',
  );
  console.log(formatResourceReport(report));
  if (mode !== 'catalog') assertCompleteContent(report);
  else if (report.errors.length)
    throw new Error(
      'Обязательная графика или существующие ресурсы не прошли проверку.',
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
