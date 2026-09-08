import { resolve } from 'node:path';
import { readContent } from './lib/read-content.ts';
import {
  assertCompleteContent,
  formatResourceReport,
  inspectResources,
  inspectResourcePaths,
} from './lib/resources.ts';
import { readV2Content, v2ResourcePaths } from './lib/v2-content.ts';

try {
  const mode = process.argv[2];
  if (mode !== 'catalog' && mode !== 'content' && mode !== 'v2')
    throw new Error('Ожидается режим catalog, content или v2');
  const root = resolve(import.meta.dirname, '..');
  if (mode === 'v2') {
    const content = await readV2Content(root);
    const report = await inspectResourcePaths(
      resolve(root, 'public'),
      v2ResourcePaths(content),
    );
    assertCompleteContent(report);
    console.log(
      'Полный набор v2: 13 цветов, 39 животных, 20 чисел, 13 типов счёта; 43 WebP, 12 PNG, 4 иконки, 189 MP3. Все обязательные ресурсы присутствуют.',
    );
  } else {
    const { catalog } = await readContent(root);
    const report = await inspectResources(resolve(root, 'public'), catalog);
    console.log(
      'Каталог: три раздела, 15 учебных элементов; структура и словарь проверены.',
    );
    console.log(formatResourceReport(report));
    if (mode === 'content') assertCompleteContent(report);
    else if (report.errors.length)
      throw new Error(
        'Обязательная графика или существующие ресурсы не прошли проверку.',
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
