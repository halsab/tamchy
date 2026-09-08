import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { contentV2 } from '../../src/content/v2/catalog.ts';

type TraceWindow = Window & {
  audioTrace?: { starts: string[]; overlaps: string[] };
  failAudioPath?: string;
};

export async function traceAudio(page: Page) {
  const known = Object.fromEntries(
    await Promise.all(
      contentV2.audio.map(async ({ path }) => [
        createHash('sha256')
          .update(await readFile(resolve('public', path)))
          .digest('hex'),
        path,
      ]),
    ),
  );
  await page.addInitScript((known) => {
    const trace = { starts: [] as string[], overlaps: [] as string[] };
    (window as TraceWindow).audioTrace = trace;
    const buffers = new WeakMap<AudioBuffer, string>();
    const active = new Set<AudioBufferSourceNode>();
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      // Подписываемся до приложения: его ended может сразу запустить следующий клип.
      source.addEventListener('ended', () => active.delete(source), {
        once: true,
      });
      return source;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (data) {
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice(0))),
      ]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const buffer = await decode.call(this, data);
      buffers.set(buffer, known[hash] ?? 'unknown');
      return buffer;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const path = this.buffer
        ? (buffers.get(this.buffer) ?? 'unknown')
        : 'empty';
      if ((window as TraceWindow).failAudioPath === path) {
        delete (window as TraceWindow).failAudioPath;
        throw new DOMException(
          'Ошибка воспроизведения для проверки восстановления',
          'NotAllowedError',
        );
      }
      if (active.size > 0) trace.overlaps.push(path);
      start.apply(this, args);
      active.add(this);
      trace.starts.push(path);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      active.delete(this);
      stop.apply(this, args);
    };
  }, known);
  return () =>
    page.evaluate(
      () => (window as TraceWindow).audioTrace ?? { starts: [], overlaps: [] },
    );
}
