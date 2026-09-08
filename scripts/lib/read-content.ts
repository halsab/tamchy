import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readV2Content } from './v2-content.ts';
import { parseStrings } from './catalog.ts';

export async function readContent(root: string) {
  const [catalog, strings] = await Promise.all([
    readV2Content(root),
    readFile(join(root, 'src/content/tt.json'), 'utf8'),
  ]);
  return {
    catalog,
    strings: parseStrings(JSON.parse(strings)),
  };
}
