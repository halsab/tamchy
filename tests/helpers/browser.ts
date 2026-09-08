import { vi } from 'vitest';
import { ResourceError } from '../../src/services/assets/resource-loading.ts';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

export function buffer(length = 100, numberOfChannels = 1): AudioBuffer {
  return { length, numberOfChannels } as AudioBuffer;
}

export function browserAudio(autoEndInteractions = false) {
  const sources: ReturnType<typeof makeSource>[] = [];
  const learningSources: ReturnType<typeof makeSource>[] = [];
  function makeSource() {
    return {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(function (this: {
        buffer: AudioBuffer | null;
        onended: (() => void) | null;
      }) {
        const interaction = (
          this.buffer as (AudioBuffer & { interaction?: string }) | null
        )?.interaction;
        if (!interaction)
          learningSources.push(this as ReturnType<typeof makeSource>);
        else if (autoEndInteractions) queueMicrotask(() => this.onended?.());
      }),
      stop: vi.fn(function (this: { onended: (() => void) | null }) {
        this.onended?.();
      }),
    };
  }
  const listeners = new Set<() => void>();
  const context = {
    state: 'suspended' as string,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
    decodeAudioData: vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>(
      async (data) => {
        const recording = new TextDecoder().decode(data);
        return Object.assign(
          buffer(),
          recording.includes('/interaction/') ? { interaction: recording } : {},
        );
      },
    ),
    createBufferSource: vi.fn(() => {
      const source = makeSource();
      sources.push(source);
      return source;
    }),
    addEventListener: vi.fn((_type: string, listener: () => void) =>
      listeners.add(listener),
    ),
    removeEventListener: vi.fn((_type: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  };
  return {
    context,
    sources,
    learningSources,
    listeners,
    createContext: vi.fn(() => context as unknown as AudioContext),
    changeState(state: string) {
      context.state = state;
      for (const listener of listeners) listener();
    },
  };
}

// Реплики в обычных регрессионных сценариях заканчиваются сами; учебные записи управляются тестом.
export function identifyInteractions(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    return response.ok && String(input).includes('/interaction/')
      ? new Response(new TextEncoder().encode(String(input)))
      : response;
  };
}

export function browserImages() {
  const images: {
    src: string;
    decode: ReturnType<typeof vi.fn<() => Promise<void>>>;
  }[] = [];
  return {
    images,
    createImage: vi.fn(() => {
      const image = { src: '', decode: vi.fn(async () => {}) };
      images.push(image);
      return image as unknown as HTMLImageElement;
    }),
    createObjectURL: vi.fn(() => `blob:test-${images.length}`),
    revokeObjectURL: vi.fn(),
  };
}

export function successfulFetch() {
  return vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1, 2, 3])),
  );
}

export function mockCanvas() {
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  const contexts = new WeakMap<
    HTMLCanvasElement,
    {
      drawImage: ReturnType<typeof vi.fn>;
      clearRect: ReturnType<typeof vi.fn>;
      putImageData: ReturnType<typeof vi.fn>;
    }
  >();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (!context) {
        const drawImage = vi.fn();
        context = {
          drawImage,
          clearRect: vi.fn(() => drawImage.mockClear()),
          putImageData: vi.fn(),
        };
        contexts.set(this, context);
      }
      return context as unknown as CanvasRenderingContext2D;
    },
  );
  return contexts;
}

export function failNextConfirmation(
  context: ReturnType<typeof browserAudio>['context'],
) {
  const makeSource = context.createBufferSource.getMockImplementation()!;
  context.createBufferSource
    .mockImplementationOnce(makeSource)
    .mockImplementationOnce(() => {
      const source = makeSource();
      source.start.mockImplementationOnce(() => {
        throw new ResourceError('decode');
      });
      return source;
    });
}
