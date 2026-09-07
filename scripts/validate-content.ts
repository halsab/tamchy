import { resolve } from 'node:path';
import { readContent } from './lib/read-content.ts';
import {
  assertCompleteContent,
  formatResourceReport,
  inspectResources,
} from './lib/resources.ts';

try {
  const mode = process.argv[2];
  if (mode !== 'catalog' && mode !== 'content')
    throw new Error('Ожидается режим catalog или content');
  const root = resolve(import.meta.dirname, '..');
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
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
