export const interactionIds = [
  'hello',
  'game-start',
  'correct',
  'well-done',
  'very-good',
  'think-again',
  'try-again',
  'hint',
  'listen',
  'next-one',
  'continue',
  'goodbye',
] as const;

export type InteractionId = (typeof interactionIds)[number];

export function interactionPath(id: InteractionId): string {
  return `assets/audio/tt/interaction/${id}.mp3`;
}
