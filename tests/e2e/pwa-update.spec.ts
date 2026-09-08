import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 as catalog } from '../../src/content/v2/catalog.ts';
import legacyCatalog from '../../src/content/catalog.json' with { type: 'json' };
import { artifactServer } from './pwa-server.ts';
import { answersReady, currentExercise } from './fixtures.ts';
const base = process.env.VITE_BASE ?? '/';
const changedAudio = catalog.audio.find(
  (clip) => clip.id === 'color.red',
)!.path;
const status = (page: Page) =>
  page.getByRole('status', { name: strings.parents.connectionTitle });
const updateStatus = (page: Page) =>
  page.getByRole('status', { name: strings.pwa.updateTitle });
async function ready(page: Page) {
  await page.getByRole('button', { name: strings.nav.parents }).click();
  await expect(status(page)).toHaveText(strings.status.offlineReady, {
    timeout: 30_000,
  });
}
async function audioHash(page: Page, path = changedAudio) {
  return page.evaluate(async (path) => {
    const response = await fetch(new URL(path, document.baseURI), {
      cache: 'no-store',
    });
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await response.arrayBuffer(),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }, path);
}
async function neighbor(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/neighbor/sw.js', {
      scope: '/neighbor/',
    });
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration =
          await navigator.serviceWorker.getRegistration('/neighbor/');
        return registration?.active?.state;
      }),
    )
    .toBe('activated');
}
async function neighborIntact(page: Page) {
  expect(
    await page.evaluate(async () => ({
      registration: (
        await navigator.serviceWorker.getRegistration('/neighbor/')
      )?.scope,
      bytes: await (
        await (await caches.open('neighbor-cache')).match('/neighbor/proof')
      )?.text(),
    })),
  ).toEqual({
    registration: new URL('/neighbor/', page.url()).href,
    bytes: 'neighbor',
  });
}

for (const migration of [false, true])
  for (const failure of [false, true]) {
    test(`T15–T16: ${migration ? 'MVP→v2' : 'v2→v2'}, ${failure ? 'неудачная B сохраняет A, явный повтор' : 'A→B без прерывания игры'}, несколько окон и соседнее приложение`, async ({
      page,
      context,
      browserName,
    }, testInfo) => {
      test.setTimeout(60_000);
      const a = migration ? process.env.TAMCHY_MVP_DIST : resolve('dist');
      const b = migration ? resolve('dist') : process.env.TAMCHY_UPDATE_DIST;
      expect(
        a,
        'Запускайте через npm run test:e2e: MVP собирается из зафиксированного коммита',
      ).toBeTruthy();
      expect(
        b,
        'Запускайте через npm run test:e2e: B собирается в отдельном каталоге',
      ).toBeTruthy();
      const sourceAudio = migration
        ? legacyCatalog.categories[0]!.items[0]!.labelAudio
        : changedAudio;
      const server = await artifactServer(a!, base);
      try {
        const versionA = JSON.parse(
          await readFile(resolve(a!, 'offline-manifest.json'), 'utf8'),
        ) as { release: string; resources: string[] };
        const versionB = JSON.parse(
          await readFile(resolve(b!, 'offline-manifest.json'), 'utf8'),
        ) as { release: string; resources: string[] };
        const hashA = createHash('sha256')
          .update(await readFile(resolve(a!, sourceAudio)))
          .digest('hex');
        const hashB = createHash('sha256')
          .update(await readFile(resolve(b!, changedAudio)))
          .digest('hex');
        expect(versionA.release).not.toBe(versionB.release);
        expect(hashA).not.toBe(hashB);
        await page.goto(server.url);
        await ready(page);
        await page.reload();
        await expect(status(page)).toHaveText(strings.status.offlineReady);
        await neighbor(page);
        const other = await context.newPage();
        await other.goto(server.url);
        await ready(other);
        await page.bringToFront();
        await page.getByRole('button', { name: strings.nav.home }).click();
        await page
          .getByRole('button', {
            name: catalog.categories[0]!.labelTt,
            exact: true,
          })
          .click();
        await answersReady(page);
        const exercise = migration
          ? await legacyExercise(page)
          : await currentExercise(page, 'colors');
        const { target } = exercise;
        let navigations = 0;
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) navigations++;
        });
        server.use(b!);
        if (failure) server.fail((path) => path === changedAudio);
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration(
            document.baseURI,
          ))!.update();
        });
        if (failure) {
          await expect(updateStatus(other)).toHaveText(
            strings.pwa.updateError,
            {
              timeout: 20_000,
            },
          );
          await expect(status(other)).toHaveText(strings.status.offlineReady);
          await server.stop();
          if (browserName === 'chromium') await context.setOffline(true);
          expect(await audioHash(page, sourceAudio)).toBe(hashA);
          await expect(status(other)).toHaveText(strings.status.offlineReady);
          await server.start();
          await context.setOffline(false);
          server.fail(() => false);
          // Повтор через экран взрослых, без принудительной активации.
          await other
            .getByRole('button', { name: strings.action.retry })
            .click();
        }
        await expect(updateStatus(other)).toHaveText(
          strings.pwa.updateWaiting,
          {
            timeout: 30_000,
          },
        );
        await expect(status(other)).toHaveText(strings.status.offlineReady);
        expect(await audioHash(page, sourceAudio)).toBe(hashA);
        await expect(
          page.getByText(exercise.textTt, { exact: true }),
        ).toBeVisible();
        await answersReady(page);
        expect(navigations).toBe(0);
        await page
          .getByRole('button', { name: target.labelTt, exact: true })
          .click();
        await expect(page.getByRole('status')).toHaveText(strings.game.correct);
        await expect(
          page.getByText(exercise.textTt, { exact: true }),
        ).not.toBeVisible();
        await neighborIntact(other);
        await page.close();
        await expect(updateStatus(other)).toHaveText(strings.pwa.updateWaiting);
        expect(await audioHash(other, sourceAudio)).toBe(hashA);
        const waiting = await other.evaluate(async () =>
          Boolean(
            (await navigator.serviceWorker.getRegistration(document.baseURI))
              ?.waiting,
          ),
        );
        expect(waiting).toBe(true);
        await other.close();
        // Нет ни одного клиента A. Новая вкладка сначала вне scope, ждёт естественную активацию B.
        const reopened = await context.newPage();
        await reopened
          .goto(new URL('/neighbor/', server.url).href)
          .catch(() => {});
        await expect
          .poll(() =>
            reopened.evaluate(async (url) => {
              const registration =
                await navigator.serviceWorker.getRegistration(url);
              return (
                registration?.active?.state === 'activated' &&
                !registration.waiting
              );
            }, server.url),
          )
          .toBe(true);
        await server.stop();
        if (browserName === 'chromium') await context.setOffline(true);
        await reopened.goto(server.url);
        await ready(reopened);
        await expect(
          reopened.getByText(
            migration
              ? strings.parents.about
              : `${strings.parents.about} Яңа версия.`,
            {
              exact: true,
            },
          ),
        ).toBeVisible();
        expect(await audioHash(reopened)).toBe(hashB);
        await neighborIntact(reopened);
        const oldKeys = await reopened.evaluate(async () => {
          const result: string[] = [];
          for (const name of await caches.keys())
            if (name.startsWith('tamchy-')) {
              for (const request of await (await caches.open(name)).keys())
                result.push(request.url);
            }
          return result;
        });
        const oldRevision = createHash('md5')
          .update(await readFile(resolve(a!, sourceAudio)))
          .digest('hex');
        expect(oldKeys.some((url) => url.includes(oldRevision))).toBe(false);
        const cachedAudio = new Set(
          oldKeys
            .filter((url) => new URL(url).pathname.endsWith('.mp3'))
            .map((url) => new URL(url).pathname),
        );
        expect(cachedAudio.size).toBe(189);
        for (const clip of catalog.audio)
          expect(cachedAudio.has(`${base}${clip.path}`), clip.path).toBe(true);
        await testInfo.attach('update-evidence', {
          body: JSON.stringify(
            {
              versionA,
              versionB,
              hashA,
              hashB,
              failure,
              migration,
              cachedAudio: cachedAudio.size,
              navigations,
              neighborIntact: true,
              oldRevisionRemovedAfterActivation: true,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      } finally {
        await server.stop();
      }
    });
  }

async function legacyExercise(page: Page) {
  // Старый каталог — отдельный контракт MVP с цельной фразой.
  const text = await page
    .getByRole('group', { name: strings.game.answers })
    .evaluate((group) => group.previousElementSibling?.textContent);
  const actual = legacyCatalog.categories[0]!.items.find(
    (item) => item.promptTt === text,
  );
  expect(actual).toBeDefined();
  return { target: actual!, textTt: text! };
}
