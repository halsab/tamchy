import type {
  GameEvent,
  GameEventData,
  OperationScope,
  Resource,
} from '../../domain/game/models.ts';
import type { GameRequirements } from '../../domain/game/requirements.ts';
import type { AudioService } from '../../services/audio/audio.ts';
import type { TintedImageService } from '../../services/assets/tinted-images.ts';
import type { ImageService } from '../../services/assets/images.ts';
import { ResourceError } from '../../services/assets/resource-loading.ts';
import type { SessionRounds } from './session-rounds.ts';
import { interactionPath } from '../../content/interactions.ts';

export type GameClock = {
  now: () => number;
  setTimeout: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};
export const browserClock: GameClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (id) => clearTimeout(id),
};

type Dependencies = {
  audio: AudioService;
  images: ImageService;
  tintedImages: TintedImageService;
  clock: GameClock;
  rounds: SessionRounds;
  send: (event: GameEvent) => void;
};
const resourceKey = (resource: Resource) =>
  `${resource.kind === 'prompt' || resource.kind === 'confirmation' ? 'audio' : resource.kind}:${resource.path}${resource.kind === 'tinted-image' ? `:${resource.hex}` : ''}`;
const sameScope = (left: OperationScope | null, right: OperationScope) =>
  left?.sessionId === right.sessionId &&
  left.roundId === right.roundId &&
  left.operationId === right.operationId;

export function createGameExecutor({
  audio,
  images,
  tintedImages,
  clock,
  rounds,
  send,
}: Dependencies) {
  let scope: OperationScope | null = null;
  let workKey: string | null = null;
  let generation = 0;
  let disposed = false;
  let played = false;
  let delivered = false;
  const loads = new Map<string, AbortController>();
  let playing: AbortController | null = null;
  let timer: {
    key: string;
    at: number;
    id: ReturnType<typeof setTimeout> | null;
  } | null = null;

  function clearTimer() {
    if (timer?.id !== null && timer?.id !== undefined)
      clock.clearTimeout(timer.id);
    timer = null;
  }

  function cancel() {
    generation++;
    clearTimer();
    for (const controller of loads.values()) controller.abort();
    loads.clear();
    playing?.abort();
    playing = null;
    audio.stop();
    scope = null;
    workKey = null;
    played = false;
    delivered = false;
  }

  function reconcile(requirement: GameRequirements) {
    if (disposed || requirement.scope.sessionId !== rounds.sessionId) return;
    const { work } = requirement;
    const key =
      work.kind === 'play'
        ? `play:${resourceKey(work.resource)}`
        : work.kind === 'next-round'
          ? `next-round:${work.roundId}:${work.optionCount}`
          : work.kind;
    if (!sameScope(scope, requirement.scope) || workKey !== key) {
      cancel();
      scope = { ...requirement.scope };
      workKey = key;
    }
    const token = { ...requirement.scope };
    const launched = generation;
    const live = () => !disposed && launched === generation;
    const emit = (event: GameEventData) => {
      if (live()) send({ ...token, ...event });
    };
    rounds.accept(token.roundId);

    function schedule(key: string, at: number, callback: () => void) {
      if (timer?.key === key && timer.at === at) return;
      clearTimer();
      const scheduled: NonNullable<typeof timer> = { key, at, id: null };
      timer = scheduled;
      const fire = () => {
        if (!live() || timer !== scheduled) return;
        const remaining = at - clock.now();
        if (remaining > 0) {
          scheduled.id = clock.setTimeout(fire, remaining);
          return;
        }
        timer = null;
        callback();
      };
      scheduled.id = clock.setTimeout(fire, Math.max(0, at - clock.now()));
    }

    function expire(resource: Resource) {
      if (!live()) return;
      const event: GameEvent = {
        ...token,
        type: 'RESOURCE_TIMEOUT',
        resource,
        at: clock.now(),
      };
      cancel();
      send(event);
    }

    function timeout(resource: Resource, at: number) {
      schedule(`timeout:${resourceKey(resource)}`, at, () => expire(resource));
    }

    switch (work.kind) {
      case 'prepare': {
        const required = new Set(work.resources.map(resourceKey));
        for (const [key, controller] of loads) {
          if (!required.has(key)) {
            controller.abort();
            loads.delete(key);
          }
        }
        const first = work.resources[0];
        if (first) timeout(first, work.timeoutAt);
        else clearTimer();
        for (const resource of work.resources) {
          const key = resourceKey(resource);
          if (loads.has(key)) continue;
          const controller = new AbortController();
          loads.set(key, controller);
          const pending =
            resource.kind === 'tinted-image'
              ? tintedImages.prepare(
                  resource.path,
                  resource.hex,
                  controller.signal,
                )
              : resource.kind === 'image'
                ? images.prepare(resource.path, controller.signal)
                : audio.prepare(resource.path, controller.signal);
          void pending.then(
            () => {
              if (!live() || controller.signal.aborted) return;
              if (clock.now() >= work.timeoutAt) expire(resource);
              else {
                // Название цвета одновременно входит в задание и подтверждение: загрузка у него одна.
                for (const ready of work.resources.filter(
                  (candidate) => resourceKey(candidate) === key,
                ))
                  emit({
                    type: 'RESOURCE_READY',
                    resource: ready,
                    at: clock.now(),
                  });
              }
            },
            (error: unknown) => {
              if (!live() || controller.signal.aborted) return;
              const event: GameEvent = {
                ...token,
                type: 'RESOURCE_FAILED',
                resource,
                reason: error instanceof ResourceError ? error.reason : 'load',
              };
              cancel();
              send(event);
            },
          );
        }
        break;
      }
      case 'play':
        if (work.timeoutAt === null) clearTimer();
        else timeout(work.resource, work.timeoutAt);
        if (!played) {
          played = true;
          if (work.started) {
            // После уничтожения исполнителя нельзя выдать повторный старт за продолжение звука.
            queueMicrotask(() => emit({ type: 'PAUSE' }));
            break;
          }
          const controller = new AbortController();
          playing = controller;
          audio.play(
            work.sequence,
            controller.signal,
            {
              started: () => {
                if (work.timeoutAt !== null && clock.now() >= work.timeoutAt)
                  expire(work.resource);
                else emit({ type: 'AUDIO_STARTED', at: clock.now() });
              },
              ended: () => emit({ type: 'AUDIO_ENDED', at: clock.now() }),
              failed: (reason, path) =>
                emit({
                  type: 'RESOURCE_FAILED',
                  resource:
                    path && work.sequence.includes(path)
                      ? { ...work.resource, path }
                      : work.resource,
                  reason,
                }),
            },
            work.introduction ? interactionPath(work.introduction) : undefined,
          );
        }
        break;
      case 'wait':
        if (work.timer) {
          const { type, at } = work.timer;
          schedule(type, at, () => emit({ type, at: clock.now() }));
        } else clearTimer();
        break;
      case 'next-round':
        if (!delivered) {
          delivered = true;
          const round = rounds.get(work.roundId, work.optionCount);
          queueMicrotask(() =>
            emit({ type: 'ROUND_GENERATED', round, at: clock.now() }),
          );
        }
        break;
      case 'stop':
        break;
    }
  }

  return {
    reconcile,
    cancel,
    activity() {
      if (timer?.key === 'IDLE_DUE') clearTimer();
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}

export type GameExecutor = ReturnType<typeof createGameExecutor>;
