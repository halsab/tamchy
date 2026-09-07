import { assetUrl } from '../assets/asset-url.ts';
import {
  abortable,
  createPendingLoads,
  fetchResource,
  ResourceError,
  resourceStep,
} from '../assets/resource-loading.ts';
import { createBufferCache } from './buffer-cache.ts';

export type AudioBoundary = {
  createContext: () => AudioContext;
  fetch: typeof fetch;
  resolveUrl: (path: string) => string;
  maxCacheBytes: number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};
export type PlaybackCallbacks = {
  started: () => void;
  ended: () => void;
  failed: (reason: ResourceError['reason']) => void;
};

export function createAudioService(boundary: Partial<AudioBoundary> = {}) {
  const environment: AudioBoundary = {
    createContext: () => new AudioContext(),
    fetch: (...args) => fetch(...args),
    resolveUrl: assetUrl,
    maxCacheBytes: 8 * 1024 * 1024,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
    ...boundary,
  };
  const cache = createBufferCache(environment.maxCacheBytes);
  const interruptions = new Set<() => void>();
  let context: AudioContext | undefined;
  let activation: Promise<boolean> | undefined;
  let wasRunning = false;
  let disposed = false;
  let playback: {
    path: string;
    controller: AbortController;
    detach: () => void;
    source: AudioBufferSourceNode | null;
    buffer: AudioBuffer | null;
  } | null = null;

  const loads = createPendingLoads(async (path, signal) => {
    const cached =
      cache.get(path) ?? (playback?.path === path ? playback.buffer : null);
    if (cached) return cached;
    if (!context || disposed) throw new ResourceError('blocked');
    const decodingContext = context;
    const response = await fetchResource(
      environment.fetch,
      environment.resolveUrl(path),
      signal,
    );
    const data = await resourceStep(
      () => response.arrayBuffer(),
      signal,
      'load',
    );
    const buffer = await resourceStep(
      () => decodingContext.decodeAudioData(data),
      signal,
      'decode',
    );
    cache.put(path, buffer, playback?.buffer ? playback.path : undefined);
    return buffer;
  });

  function stop() {
    const previous = playback;
    playback = null;
    if (!previous) return;
    previous.detach();
    previous.controller.abort();
    if (previous.source) {
      previous.source.onended = null;
      try {
        previous.source.stop();
      } catch {
        /* Узел мог уже завершиться в браузере. */
      }
      previous.source.disconnect();
    }
  }

  function stateChanged() {
    const running = context?.state === 'running';
    const interrupted = wasRunning && !running;
    wasRunning = running;
    if (interrupted && !disposed) {
      stop();
      for (const listener of interruptions) listener();
    }
  }

  function activate(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    try {
      if (!context) {
        context = environment.createContext();
        context.addEventListener('statechange', stateChanged);
      }
      const activatedContext = context;
      // resume вызывается в стеке пользовательского обработчика, до первого await.
      const resumed =
        context.state === 'running' ? Promise.resolve() : context.resume();
      activation = resumed.then(
        () => {
          const ready = !disposed && activatedContext.state === 'running';
          if (ready) wasRunning = true;
          return ready;
        },
        () => false,
      );
    } catch {
      activation = Promise.resolve(false);
    }
    return activation;
  }

  function play(
    path: string,
    signal: AbortSignal,
    callbacks: PlaybackCallbacks,
    introduction?: string,
  ) {
    stop();
    if (signal.aborted || disposed) return;
    const controller = new AbortController();
    const abort = () => {
      if (playback === current) stop();
    };
    let introductionTimer: ReturnType<typeof setTimeout> | undefined;
    let introductionLoad: AbortController | undefined;
    const clearIntroduction = () => {
      if (introductionTimer !== undefined)
        environment.clearTimeout(introductionTimer);
      introductionTimer = undefined;
      introductionLoad?.abort();
      introductionLoad = undefined;
    };
    const current = {
      path,
      controller,
      source: null as AudioBufferSourceNode | null,
      buffer: null as AudioBuffer | null,
      detach: () => {
        signal.removeEventListener('abort', abort);
        clearIntroduction();
      },
    };
    playback = current;
    signal.addEventListener('abort', abort, { once: true });
    const attempt = activation ?? Promise.resolve(false);
    async function startRecording(recording: string, introductory: boolean) {
      try {
        if (
          !(await abortable(attempt, controller.signal)) ||
          context?.state !== 'running'
        )
          throw new ResourceError('blocked');
        current.buffer = null;
        current.path = recording;
        if (introductory) {
          introductionLoad = new AbortController();
          introductionTimer = environment.setTimeout(
            () => introductionLoad?.abort(),
            2000,
          );
        }
        const buffer = await loads.run(
          recording,
          introductionLoad?.signal ?? controller.signal,
        );
        clearIntroduction();
        controller.signal.throwIfAborted();
        if (context.state !== 'running') throw new ResourceError('blocked');
        const source = context.createBufferSource();
        current.buffer = buffer;
        current.source = source;
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          if (
            playback !== current ||
            current.source !== source ||
            controller.signal.aborted
          )
            return;
          if (context?.state !== 'running') {
            stateChanged();
            return;
          }
          source.onended = null;
          source.disconnect();
          current.source = null;
          if (introductory) void startRecording(path, false);
          else {
            current.detach();
            playback = null;
            callbacks.ended();
          }
        };
        source.start();
        if (context.state !== 'running') throw new ResourceError('blocked');
        // Ответ разрешается только после начала учебной фразы, а не вступительной реплики.
        if (!introductory) callbacks.started();
      } catch (error) {
        if (playback !== current || controller.signal.aborted) return;
        clearIntroduction();
        if (
          introductory &&
          context?.state === 'running' &&
          ((error instanceof ResourceError && error.reason !== 'blocked') ||
            (error instanceof DOMException && error.name === 'AbortError'))
        ) {
          void startRecording(path, false);
          return;
        }
        stop();
        callbacks.failed(
          error instanceof ResourceError ? error.reason : 'blocked',
        );
      }
    }
    void startRecording(introduction ?? path, introduction !== undefined);
  }

  return {
    activate,
    prepare: loads.run,
    play,
    stop,
    cacheBytes: cache.bytes,
    subscribeInterruption(listener: () => void) {
      interruptions.add(listener);
      return () => {
        interruptions.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      loads.dispose();
      cache.clear();
      interruptions.clear();
      if (context) {
        context.removeEventListener('statechange', stateChanged);
        void context.close().catch(() => {});
      }
    },
  };
}

export type AudioService = ReturnType<typeof createAudioService>;
