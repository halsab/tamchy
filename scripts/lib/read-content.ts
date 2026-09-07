import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCatalog, parseStrings } from './catalog.ts';

export async function readContent(root: string) {
  const [catalog, strings] = await Promise.all([
    readFile(join(root, 'src/content/catalog.json'), 'utf8'),
    readFile(join(root, 'src/content/tt.json'), 'utf8'),
  ]);
  return {
    catalog: parseCatalog(JSON.parse(catalog)),
    strings: parseStrings(JSON.parse(strings)),
  };
}
