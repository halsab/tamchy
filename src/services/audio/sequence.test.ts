import { describe, expect, it, vi } from 'vitest';
import {
  browserAudio,
  deferred,
  flush,
  successfulFetch,
} from '../../../tests/helpers/browser.ts';
import { createAudioService } from './audio.ts';

const parts = [
  'assets/audio/tt/clips/animal-cat-target.mp3',
  'assets/audio/tt/clips/common-find.mp3',
];
function setup() {
  const boundary = browserAudio();
  const fetch = successfulFetch();
  const service = createAudioService({ ...boundary, fetch });
  const controller = new AbortController();
  const callbacks = { started: vi.fn(), ended: vi.fn(), failed: vi.fn() };
  return { ...boundary, fetch, service, controller, callbacks };
}

describe('составное учебное задание', () => {
  it('сохраняет порядок и сообщает начало один раз, конец после последнего слова', async () => {
    const s = setup();
    await s.service.activate();
    s.service.play(
      parts,
      s.controller.signal,
      s.callbacks,
      'assets/audio/tt/interaction/hello.mp3',
    );
    await flush();
    expect(s.callbacks.started).not.toHaveBeenCalled();
    s.sources[0]!.onended!();
    await flush();
    expect(s.callbacks.started).toHaveBeenCalledTimes(1);
    s.sources[1]!.onended!();
    await flush();
    expect(s.callbacks.started).toHaveBeenCalledTimes(1);
    expect(s.callbacks.ended).not.toHaveBeenCalled();
    expect(s.fetch.mock.calls.slice(1).map(([url]) => String(url))).toEqual(
      parts.map((x) => `/${x}`),
    );
    expect(s.sources[1]!.onended).toBeNull();
    s.sources[2]!.onended!();
    expect(s.callbacks.ended).toHaveBeenCalledTimes(1);
    s.service.dispose();
  });

  it.each(['abort', 'stop', 'replace', 'interrupt'] as const)(
    '%s отменяет оставшиеся слова и старые окончания',
    async (mode) => {
      const s = setup();
      await s.service.activate();
      s.service.play(parts, s.controller.signal, s.callbacks);
      await flush();
      const late = s.sources[0]!.onended!;
      if (mode === 'abort') s.controller.abort();
      if (mode === 'stop') s.service.stop();
      if (mode === 'interrupt') s.changeState('interrupted');
      if (mode === 'replace')
        s.service.play(parts, new AbortController().signal, {
          started: vi.fn(),
          ended: vi.fn(),
          failed: vi.fn(),
        });
      late();
      await flush();
      expect(s.callbacks.ended).not.toHaveBeenCalled();
      expect(s.callbacks.failed).not.toHaveBeenCalled();
      expect(
        s.fetch.mock.calls.some(([url]) => String(url).endsWith(parts[1]!)),
      ).toBe(false);
      expect(s.sources).toHaveLength(mode === 'replace' ? 2 : 1);
      s.service.dispose();
    },
  );

  it('отмена между словами не даёт поздней загрузке запустить звук', async () => {
    const s = setup();
    await s.service.activate();
    s.service.play(parts, s.controller.signal, s.callbacks);
    await flush();
    const pending = deferred<Response>();
    s.fetch.mockReturnValueOnce(pending.promise);
    s.sources[0]!.onended!();
    await flush();
    s.controller.abort();
    pending.resolve(new Response('late'));
    await flush();
    expect(s.sources).toHaveLength(1);
    expect(s.callbacks.ended).not.toHaveBeenCalled();
    s.service.dispose();
  });

  it('передаёт конкретный повреждённый клип, не объявляя окончание задания', async () => {
    const s = setup();
    await s.service.activate();
    s.service.play(parts, s.controller.signal, s.callbacks);
    await flush();
    s.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    s.sources[0]!.onended!();
    await flush();
    expect(s.callbacks.failed).toHaveBeenCalledWith('load', parts[1]);
    expect(s.callbacks.ended).not.toHaveBeenCalled();
    s.service.dispose();
  });
});
