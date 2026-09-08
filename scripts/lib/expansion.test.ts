import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import colors from '../../src/content/v2/colors.json' with { type: 'json' };
import audio from '../../src/content/v2/audio.json' with { type: 'json' };
import graphics from '../../src/content/v2/graphics.json' with { type: 'json' };
import {
  interactionIds,
  interactionPath,
} from '../../src/content/interactions.ts';
import { isAssetPath } from '../../src/services/assets/paths.ts';
import { icons } from './resources.ts';

const root = resolve(import.meta.dirname, '../..');
const text = z.string().trim().min(1);
const masters = [
  'master-01-colors-shapes-objects.wav',
  'master-02-numbers.wav',
  'master-03-animal-labels.wav',
  'master-04-animal-target-forms.wav',
  'master-05-common-prompts.wav',
] as const;

function tableRows(document: string) {
  return document
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf('|'))
        .split('|')
        .map((cell) => cell.trim().replaceAll('`', '')),
    );
}

describe('подготовленные данные v2', () => {
  it('проверяет структуру, уникальность и безопасные пути реестров', () => {
    z.array(
      z.strictObject({
        id: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
        labelTt: text,
        hex: z.string().regex(/^#[0-9A-F]{6}$/),
        labelClipId: text,
      }),
    )
      .length(13)
      .parse(colors);
    z.array(
      z.strictObject({
        id: z.string().regex(/^[a-z]+\.[A-Za-z0-9.-]+$/),
        textTt: text,
        path: z.string().refine(isAssetPath),
        master: z.enum(masters).nullable(),
      }),
    )
      .length(189)
      .parse(audio);
    z.array(
      z.strictObject({
        id: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
        source: z.string().regex(/^assets-source\/(?:[a-z-]+\/)*[a-z-]+\.png$/),
        outputs: z.array(z.string().refine(isAssetPath)).min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
      .length(56)
      .parse(graphics);
    for (const entries of [colors, audio, graphics]) {
      expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
    }
    expect(new Set(audio.map(({ path }) => path)).size).toBe(189);
    expect(new Set(graphics.map(({ source }) => source)).size).toBe(56);
    const outputs = graphics.flatMap(({ outputs }) => outputs);
    expect(outputs).toHaveLength(59);
    expect(new Set(outputs).size).toBe(outputs.length);
    expect(outputs.filter((path) => path.endsWith('.webp'))).toHaveLength(43);
    expect(outputs.filter((path) => path.endsWith('.png'))).toHaveLength(16);
    expect(outputs.filter((path) => path.endsWith('.svg'))).toEqual([]);
  });

  it('сверяет все названия и HEX с ТЗ, графическим и аудиореестрами', async () => {
    for (const file of [
      'specification.md',
      'illustrations-registry.md',
      'audio-recording-script.md',
    ]) {
      const rows = tableRows(
        await readFile(resolve(root, 'docs', file), 'utf8'),
      );
      const palette = rows.flatMap((cells) => {
        const index = cells.findIndex((cell) => /^#[A-F0-9]{6}$/.test(cell));
        if (index < 2) return [];
        return [
          {
            id: cells[index - 2]!.replace(/^color\./, ''),
            labelTt: cells[index - 1],
            hex: cells[index],
          },
        ];
      });
      expect(palette, file).toEqual(
        colors.map(({ id, labelTt, hex }) => ({ id, labelTt, hex })),
      );
    }
    for (const color of colors) {
      expect(audio.find(({ id }) => id === color.labelClipId)).toMatchObject({
        id: `color.${color.id}`,
        textTt: color.labelTt,
      });
    }
  });

  it('сверяет 177 новых клипов с каждым мастер-разделом сценария', async () => {
    const script = await readFile(
      resolve(root, 'docs/audio-recording-script.md'),
      'utf8',
    );
    const expected = masters.flatMap((master, index) => {
      const start = script.indexOf(`# ${index + 4}. MASTER`);
      const end = script.indexOf(`\n# ${index + 5}. `, start);
      return tableRows(script.slice(start, end)).flatMap((cells) =>
        cells.flatMap((cell, index) =>
          /^(?:color|size|shape|count|number|animal|common|colors|animals|numbers)\.[A-Za-z0-9.-]+$/.test(
            cell,
          )
            ? [{ id: cell, textTt: cells[index + 1], master }]
            : [],
        ),
      );
    });
    expect(expected).toHaveLength(177);
    expect(
      audio
        .filter(({ master }) => master !== null)
        .map(({ id, textTt, master }) => ({ id, textTt, master })),
    ).toEqual(expected);
    expect(
      masters.map(
        (master) => audio.filter((clip) => clip.master === master).length,
      ),
    ).toEqual([33, 40, 39, 39, 26]);
    for (const clip of audio.filter(({ master }) => master !== null)) {
      const filename = clip.id
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replaceAll('.', '-')
        .toLowerCase();
      expect(clip.path).toBe(`assets/audio/tt/clips/${filename}.mp3`);
    }
  });

  it('сохраняет все 12 настоящих реплик и их прежние пути', async () => {
    const interactions = audio.filter(({ master }) => master === null);
    expect(interactions.map(({ id }) => id).sort()).toEqual(
      interactionIds.map((id) => `interaction.${id}`).sort(),
    );
    const script = tableRows(
      await readFile(resolve(root, 'docs/audio-recording-script.md'), 'utf8'),
    );
    for (const id of interactionIds) {
      const clip = interactions.find(
        (clip) => clip.id === `interaction.${id}`,
      )!;
      expect(clip.path).toBe(interactionPath(id));
      expect(script.find((cells) => cells[0] === clip.id)?.[2]).toBe(
        clip.textTt,
      );
      expect(
        (await stat(resolve(root, 'public', clip.path))).size,
      ).toBeGreaterThan(0);
    }
  });

  it('согласует животных, формы, числа и считаемые объекты с клипами', () => {
    const animals = graphics.filter(({ id }) => id.startsWith('animal-'));
    expect(animals).toHaveLength(39);
    const ids = new Set(audio.map(({ id }) => id));
    for (const animal of animals) {
      const id = animal.id.replace('animal-', 'animal.');
      expect(ids.has(id)).toBe(true);
      expect(ids.has(`${id}.target`)).toBe(true);
    }
    const shapes = graphics.filter(({ id }) => id.startsWith('shape-'));
    expect(shapes).toHaveLength(6);
    for (const shape of shapes) {
      const id = shape.id.replace('shape-', 'shape.');
      expect(ids.has(id)).toBe(true);
      expect(ids.has(`${id}.target`)).toBe(true);
    }
    for (let number = 1; number <= 20; number++) {
      expect(ids.has(`number.${number}`)).toBe(true);
      expect(ids.has(`number.${number}.target`)).toBe(true);
    }
    expect(audio.filter(({ id }) => id.startsWith('count.'))).toHaveLength(6);
    expect(
      graphics
        .filter(({ id }) => id.startsWith('color-object-'))
        .map(({ id }) => id),
    ).toEqual([
      'color-object-ball',
      'color-object-ring-toy',
      'color-object-car-toy',
      'color-object-cube',
      'color-object-pyramid-toy',
      'color-object-top',
    ]);
    expect(audio.find(({ id }) => id === 'shape.square')?.textTt).toBe(
      'Шакмак',
    );
    expect(audio.find(({ id }) => id === 'count.pyramid')?.textTt).toBe(
      'Пирамида',
    );
    expect(audio.find(({ id }) => id === 'count.top')?.textTt).toBe('Бөтерчек');
    expect(ids.has('count.cube')).toBe(false);
    expect(
      graphics.find(({ id }) => id === 'app-icon-master')?.outputs,
    ).toEqual(icons.map(({ path }) => path));
  });

  it('сверяет графический реестр с документом и точным регистром путей', async () => {
    const document = await readFile(
      resolve(root, 'docs/illustrations-registry.md'),
      'utf8',
    );
    const names = [...document.matchAll(/^\d{2}\s+([\w-]+\.png)$/gm)].map(
      (match) => match[1],
    );
    expect(names).toEqual(
      graphics.map(({ source }) => source.split('/').at(-1)),
    );
    for (const { id, source, outputs } of graphics) {
      let directory = root;
      for (const segment of source.split('/')) {
        expect(await readdir(directory)).toContain(segment);
        directory = resolve(directory, segment);
      }
      expect(source.split('/').at(-1)).toBe(`${id}.png`);
      if (id !== 'app-icon-master') {
        const neutral =
          id.startsWith('shape-') || id.startsWith('color-object-');
        const output = source.replace('assets-source/', 'assets/images/');
        expect(outputs).toEqual([
          neutral ? output : output.replace(/\.png$/, '.webp'),
        ]);
      }
    }
  });

  it('проверяет хеши, размеры и альфу всех 56 PNG-мастеров', async () => {
    for (const { id, source, sha256 } of graphics) {
      const buffer = await readFile(resolve(root, source));
      expect(createHash('sha256').update(buffer).digest('hex'), source).toBe(
        sha256,
      );
      const metadata = await sharp(buffer).metadata();
      await sharp(buffer).raw().toBuffer();
      const neutral = id.startsWith('shape-') || id.startsWith('color-object-');
      const size = neutral ? 1024 : 1254;
      expect(metadata.format).toBe('png');
      expect([metadata.width, metadata.height]).toEqual([size, size]);
      expect(metadata.hasAlpha).toBe(!source.includes('/icons/'));
      if (metadata.hasAlpha) {
        const alpha = (await sharp(buffer).stats()).channels[3]!;
        expect([alpha.min, alpha.max], source).toEqual([0, 255]);
      }
    }
  }, 30000);

  it('проверяет нейтральную серую основу всех 12 мастеров для перекраски', async () => {
    const neutral = graphics.filter(
      ({ id }) => id.startsWith('shape-') || id.startsWith('color-object-'),
    );
    expect(neutral).toHaveLength(12);
    for (const { id, source } of neutral) {
      const { data, info } = await sharp(resolve(root, source))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      const histogram = new Array<number>(256).fill(0);
      let nonGray = 0;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] === 0) continue;
        const tone = data[index]!;
        if (tone !== data[index + 1] || tone !== data[index + 2]) nonGray++;
        histogram[tone] = histogram[tone]! + 1;
        visible++;
      }
      expect(nonGray, source).toBe(0);
      expect(visible, source).toBeGreaterThan(0);
      expect(histogram[128], source).toBeGreaterThan(0);
      if (id.startsWith('shape-')) {
        expect(histogram[128], source).toBe(visible);
      } else {
        const tones = histogram.flatMap((count, tone) => (count ? [tone] : []));
        expect([tones[0], tones.at(-1)], source).toEqual([48, 224]);
      }
    }
  });

  it('проверяет места записи и сообщает о фактической готовности новых MP3', async () => {
    for (const directory of [
      'assets-source/audio/tt',
      'public/assets/audio/tt/clips',
    ]) {
      expect((await stat(resolve(root, directory))).isDirectory()).toBe(true);
    }
    const missing: string[] = [];
    for (const clip of audio.filter(({ master }) => master !== null)) {
      try {
        expect(
          (await stat(resolve(root, 'public', clip.path))).size,
        ).toBeGreaterThan(0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        missing.push(clip.id);
      }
    }
    console.log(
      `Подготовка v2: ожидаются ${missing.length} из 177 новых MP3. Наличие реестра не подтверждает приёмку и готовность релиза v2.`,
    );
  });
});
