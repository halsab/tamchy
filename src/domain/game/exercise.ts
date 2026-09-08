import type { CountObject } from '../../content/types.ts';

export type AnswerCount = 2 | 3 | 4;
export type AudioPrompt =
  | Readonly<{ type: 'clip'; clipId: string }>
  | Readonly<{ type: 'sequence'; clipIds: readonly string[] }>;
export type Prompt = Readonly<{
  kind: 'spoken';
  textTt: string;
  audio: AudioPrompt;
}>;
type OptionBase = Readonly<{ id: string; labelTt: string }>;
export type ColorOption = OptionBase & Readonly<{ kind: 'color'; hex: string }>;
export type AnimalOption = OptionBase &
  Readonly<{ kind: 'animal'; image: string }>;
export type NumberOption = OptionBase &
  Readonly<{ kind: 'number'; value: number }>;
export type Option = ColorOption | AnimalOption | NumberOption;
export type CountIllustration = Pick<CountObject, 'id' | 'image'> &
  (Readonly<{ kind: 'raster' }> | Readonly<{ kind: 'tinted'; hex: string }>);

type ExerciseBase = Readonly<{
  id: number;
  difficulty: 1;
  prompt: Prompt;
  correctOptionId: string;
  confirmation: AudioPrompt;
}>;
export type Exercise = ExerciseBase &
  (
    | Readonly<{
        kind: 'C1';
        categoryId: 'colors';
        options: readonly ColorOption[];
      }>
    | Readonly<{
        kind: 'A1';
        categoryId: 'animals';
        options: readonly AnimalOption[];
      }>
    | Readonly<{
        kind: 'N1-A';
        categoryId: 'numbers';
        options: readonly NumberOption[];
        countObject: CountIllustration;
      }>
  );

export function audioClipIds(prompt: AudioPrompt): readonly string[] {
  return prompt.type === 'clip' ? [prompt.clipId] : prompt.clipIds;
}
