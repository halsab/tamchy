import {
  test,
  expect,
  chromium,
  webkit,
  firefox,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contentV2 as catalog } from '../../src/content/v2/catalog.ts';
import { juniorItems } from '../helpers/junior-content.ts';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { artifactServer } from './pwa-server.ts';
import { answersReady, currentExercise } from './fixtures.ts';

const base = process.env.VITE_BASE ?? '/';
const engines = { chromium, webkit, firefox };
const metadata = JSON.parse(
  await readFile('dist/offline-manifest.json', 'utf8'),
) as { release: string };
async function verifyHome(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration(
            document.baseURI,
          );
          if (registration?.active?.state !== 'activated') return 'preparing';
          return await new Promise<string>((done) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              channel.port1.close();
              done(event.data.status);
            };
            registration.active!.postMessage({ type: 'VERIFY' }, [
              channel.port2,
            ]);
          });
        }),
      { timeout: 30_000 },
    )
    .toBe('ready');
}
async function parents(page: Page) {
  await page.getByRole('button', { name: strings.nav.parents }).click();
}
const offlineStatus = (page: Page) =>
  page.getByRole('status', { name: strings.parents.connectionTitle });

test('T13: только главное меню → закрытие браузера → тот же профиль без сети → 62 цели и 189 записей', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(300_000);
  const server = await artifactServer(resolve('dist'), base);
  const profile = await mkdtemp(join(tmpdir(), 'tamchy-offline-profile-'));
  const engine = engines[browserName];
  let context = await engine.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    let page = context.pages()[0]!;
    await page.goto(server.url);
    await expect(
      page.getByRole('heading', { name: strings.app.name }),
    ).toBeVisible();
    await verifyHome(page);
    if (browserName === 'chromium') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
      await cdp.detach();
    }
    if (browserName === 'chromium') await context.setOffline(true);
    await context.close();
    await server.stop();
    context = await engine.launchPersistentContext(profile, {
      headless: true,
      offline: browserName === 'chromium',
      viewport: { width: 390, height: 844 },
    });
    page = context.pages()[0]!;
    const fromWorker = new Set<string>();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.fromServiceWorker())
        fromWorker.add(new URL(response.url()).pathname);
    });
    const navigation = await page.goto(server.url);
    expect(navigation?.fromServiceWorker()).toBe(true);
    expect((await page.reload())?.fromServiceWorker()).toBe(true);
    await parents(page);
    await expect(offlineStatus(page)).toHaveText(strings.status.offlineReady);
    await page.getByRole('button', { name: strings.nav.home }).click();
    const audio = catalog.audio.map((clip) => clip.path);
    const decoded = await page.evaluate(async (paths) => {
      const audio = new AudioContext();
      const results = [];
      try {
        for (const path of paths) {
          const response = await fetch(new URL(path, document.baseURI), {
            cache: 'no-store',
          });
          if (!response.ok) throw new Error(path);
          const buffer = await audio.decodeAudioData(
            await response.arrayBuffer(),
          );
          results.push({
            path,
            channels: buffer.numberOfChannels,
            duration: buffer.duration,
          });
        }
      } finally {
        await audio.close();
      }
      return results;
    }, audio);
    expect(decoded).toHaveLength(189);
    for (const item of decoded) {
      expect(item.channels).toBe(1);
      expect(item.duration).toBeGreaterThan(0);
      expect(fromWorker.has(`${base}${item.path}`), item.path).toBe(true);
    }
    const visited: string[] = [];
    for (const category of catalog.categories) {
      await page
        .getByRole('button', { name: category.labelTt, exact: true })
        .click();
      const cycle = new Set<string>();
      for (let round = 0; round < juniorItems(category.id).length; round++) {
        await answersReady(page);
        const exercise = await currentExercise(page, category.id);
        const { target } = exercise;
        expect(target).toBeDefined();
        expect(cycle.has(target.id)).toBe(false);
        cycle.add(target.id);
        visited.push(target.id);
        await page
          .getByRole('button', { name: target.labelTt, exact: true })
          .click();
        await expect(page.getByRole('status')).toHaveText(strings.game.correct);
        await expect(
          page.getByText(exercise.textTt, { exact: true }),
        ).not.toBeVisible();
      }
      expect(cycle.size).toBe(juniorItems(category.id).length);
      await page.getByRole('button', { name: strings.nav.home }).click();
    }
    expect(visited).toHaveLength(62);
    expect(errors).toEqual([]);
    await testInfo.attach('offline-evidence', {
      body: JSON.stringify(
        {
          release: metadata.release,
          browser: context.browser()?.version(),
          visited,
          decoded,
          responsesFromServiceWorker: [...fromWorker],
          httpServerStopped: true,
          persistentProfileRelaunched: true,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
    await server.stop();
    await rm(profile, { recursive: true, force: true });
  }
});

test('T14: обрыв первой подготовки, честная ошибка и явный повтор', async ({
  page,
  context,
}) => {
  const server = await artifactServer(resolve('dist'), base);
  try {
    server.hold((path) => path.endsWith('.mp3'));
    const requested = server.requested((path) => path.endsWith('.mp3'));
    await page.goto(server.url);
    await requested;
    await parents(page);
    await expect(offlineStatus(page)).toHaveText(strings.pwa.preparing);
    await context.setOffline(true);
    await server.stop();
    await expect(offlineStatus(page)).toHaveText(strings.pwa.error, {
      timeout: 20_000,
    });
    server.hold(() => false);
    await server.start();
    await context.setOffline(false);
    await expect(offlineStatus(page)).toHaveText(strings.pwa.error);
    await page.getByRole('button', { name: strings.action.retry }).click();
    await expect(offlineStatus(page)).toHaveText(strings.status.offlineReady, {
      timeout: 30_000,
    });
  } finally {
    await server.stop();
  }
});

test('потеря сохранённого MP3 обнаруживается без сетевого восполнения, затем явный retry', async ({
  page,
}) => {
  const server = await artifactServer(resolve('dist'), base);
  try {
    await page.goto(server.url);
    await verifyHome(page);
    const path = catalog.audio.find((clip) => clip.id === 'color.red')!.path;
    const removed = await page.evaluate(async (path) => {
      let removed = false;
      for (const name of await caches.keys()) {
        if (!name.startsWith('tamchy-')) continue;
        const cache = await caches.open(name);
        for (const key of await cache.keys())
          if (new URL(key.url).pathname.endsWith(path))
            removed = (await cache.delete(key)) || removed;
      }
      return removed;
    }, path);
    expect(removed).toBe(true);
    const count = () => server.seen.filter((url) => url.endsWith(path)).length;
    const before = count();
    await parents(page);
    await expect(offlineStatus(page)).toHaveText(strings.pwa.error);
    expect(count()).toBe(before);
    await page.getByRole('button', { name: strings.action.retry }).click();
    await expect(offlineStatus(page)).toHaveText(strings.status.offlineReady);
    expect(count()).toBeGreaterThan(before);
  } finally {
    await server.stop();
  }
});
