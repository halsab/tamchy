import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 as catalog } from '../../src/content/v2/catalog.ts';
import legacyCatalog from '../../src/content/catalog.json' with { type: 'json' };
import type { OfflineManifest } from '../../src/services/pwa/worker.ts';
import { artifactServer } from './pwa-server.ts';
import { answerButtons, answersReady, currentExercise } from './fixtures.ts';
import { installSeniorRandom, startSeniorPlayer } from './senior-player.ts';
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

for (const baseline of ['current', 'mvp', 'junior'] as const)
  for (const failure of [false, true]) {
    test(`T15–T16: ${baseline === 'mvp' ? 'MVP→v2' : baseline === 'junior' ? 'младший→старший' : 'v2→v2'}, ${failure ? 'неудачная B сохраняет A, явный повтор' : 'A→B без прерывания игры'}, несколько окон и соседнее приложение`, async ({
      page,
      context,
      browserName,
    }, testInfo) => {
      test.setTimeout(60_000);
      const migration = baseline !== 'current';
      const legacy = baseline === 'mvp';
      const a = legacy
        ? process.env.TAMCHY_MVP_DIST
        : baseline === 'junior'
          ? process.env.TAMCHY_JUNIOR_DIST
          : resolve('dist');
      const b = migration ? resolve('dist') : process.env.TAMCHY_UPDATE_DIST;
      expect(
        a,
        'Запускайте через npm run test:e2e: MVP собирается из зафиксированного коммита',
      ).toBeTruthy();
      expect(
        b,
        'Запускайте через npm run test:e2e: B собирается в отдельном каталоге',
      ).toBeTruthy();
      const sourceAudio = legacy
        ? legacyCatalog.categories[0]!.items[0]!.labelAudio
        : changedAudio;
      const server = await artifactServer(a!, base);
      try {
        const versionA = JSON.parse(
          await readFile(resolve(a!, 'offline-manifest.json'), 'utf8'),
        ) as OfflineManifest;
        const versionB = JSON.parse(
          await readFile(resolve(b!, 'offline-manifest.json'), 'utf8'),
        ) as OfflineManifest;
        const resourcesA = versionA.entries.map((entry) => entry.url);
        const resourcesB = versionB.entries.map((entry) => entry.url);
        const hashA = createHash('sha256')
          .update(await readFile(resolve(a!, sourceAudio)))
          .digest('hex');
        const hashB = createHash('sha256')
          .update(await readFile(resolve(b!, changedAudio)))
          .digest('hex');
        expect(versionA.release).not.toBe(versionB.release);
        if (baseline === 'junior') expect(hashA).toBe(hashB);
        else expect(hashA).not.toBe(hashB);
        const changedCode = resourcesB.find(
          (path) => path.endsWith('.js') && !resourcesA.includes(path),
        )!;
        expect(changedCode).toBeTruthy();
        await installSeniorRandom(page);
        await page.goto(server.url);
        await ready(page);
        await page.reload();
        await expect(status(page)).toHaveText(strings.status.offlineReady);
        if (!legacy)
          await page.getByText(strings.parents.senior, { exact: true }).click();
        await neighbor(page);
        const other = await context.newPage();
        await other.goto(server.url);
        await ready(other);
        await page.bringToFront();
        await page
          .getByRole('button', {
            name:
              baseline === 'current' ? strings.action.close : strings.nav.home,
          })
          .click();
        let exercise: { target: { labelTt: string }; textTt: string };
        if (baseline === 'current') {
          const player = await startSeniorPlayer(page, 'colors');
          exercise = {
            target: player.exercise.options.find(
              (x) => x.id === player.exercise.correctOptionId,
            )!,
            textTt: player.exercise.prompt.textTt,
          };
          await expect(answerButtons(page)).toHaveCount(4);
        } else {
          await page
            .getByRole('button', {
              name: catalog.categories[0]!.labelTt,
              exact: true,
            })
            .click();
          await answersReady(page);
          await expect(answerButtons(page)).toHaveCount(2);
          exercise = legacy
            ? await legacyExercise(page)
            : await currentExercise(page, 'colors');
        }
        const { target } = exercise;
        let navigations = 0;
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) navigations++;
        });
        server.use(b!);
        if (failure)
          server.fail(
            (path) =>
              path === (baseline === 'junior' ? changedCode : changedAudio),
          );
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
        const originalAnswer = await answerButtons(page)
          .first()
          .elementHandle();
        await page
          .getByRole('button', { name: target.labelTt, exact: true })
          .click();
        await expect(page.getByRole('status')).toHaveText(strings.game.correct);
        await expect
          .poll(() => originalAnswer!.evaluate((button) => button.isConnected))
          .toBe(false);
        await answersReady(page);
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
        if (baseline !== 'junior')
          expect(oldKeys.some((url) => url.includes(oldRevision))).toBe(false);
        for (const path of resourcesA.filter(
          (path) => path.endsWith('.js') && !resourcesB.includes(path),
        ))
          expect(
            oldKeys.some((url) => new URL(url).pathname === `${base}${path}`),
          ).toBe(false);
        const cachedAudio = new Set(
          oldKeys
            .filter((url) => new URL(url).pathname.endsWith('.mp3'))
            .map((url) => new URL(url).pathname),
        );
        expect(cachedAudio.size).toBe(189);
        for (const clip of catalog.audio)
          expect(cachedAudio.has(`${base}${clip.path}`), clip.path).toBe(true);
        if (!legacy) {
          await expect(
            reopened.getByRole('radio', { name: strings.parents.senior }),
          ).toBeChecked();
          await reopened
            .getByRole('button', { name: strings.action.close })
            .click();
          await reopened
            .getByRole('button', { name: 'Хайваннар', exact: true })
            .click();
          await answersReady(reopened);
          await expect(answerButtons(reopened)).toHaveCount(4);
        }
        await testInfo.attach('update-evidence', {
          body: JSON.stringify(
            {
              versionA,
              versionB,
              hashA,
              hashB,
              failure,
              migration,
              baseline,
              cachedAudio: cachedAudio.size,
              navigations,
              neighborIntact: true,
              oldRevisionRemovedAfterActivation: baseline !== 'junior',
              oldCodeRemovedAfterActivation: true,
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
