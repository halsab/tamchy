import type {
  CategoryId,
  CountObject,
  ExerciseKind,
} from '../../content/types.ts';
import type { ShapeId, SizeId, TraitId } from '../../content/types.ts';
export type { ExerciseKind } from '../../content/types.ts';

export type AgeMode = 'junior' | 'senior';
export type JuniorAnswerCount = 2 | 3 | 4;
export type SeniorAnswerCount = 4 | 5 | 6;
export type AnswerCount = JuniorAnswerCount | SeniorAnswerCount;
export type Difficulty = 1 | 2 | 3;
export const exerciseDefinitions = {
  C1: { categoryId: 'colors', difficulty: 1 },
  C2: { categoryId: 'colors', difficulty: 1 },
  'C3-A': { categoryId: 'colors', difficulty: 2 },
  'C3-B': { categoryId: 'colors', difficulty: 2 },
  C4: { categoryId: 'colors', difficulty: 3 },
  A1: { categoryId: 'animals', difficulty: 1 },
  A2: { categoryId: 'animals', difficulty: 2 },
  A3: { categoryId: 'animals', difficulty: 2 },
  'N1-A': { categoryId: 'numbers', difficulty: 1 },
  'N1-B': { categoryId: 'numbers', difficulty: 1 },
  'N1-C': { categoryId: 'numbers', difficulty: 1 },
  N2: { categoryId: 'numbers', difficulty: 2 },
  'N3-A': { categoryId: 'numbers', difficulty: 3 },
  'N3-B': { categoryId: 'numbers', difficulty: 3 },
} as const satisfies Readonly<
  Record<ExerciseKind, { categoryId: CategoryId; difficulty: Difficulty }>
>;

export type AudioPrompt =
  | Readonly<{ type: 'clip'; clipId: string }>
  | Readonly<{ type: 'sequence'; clipIds: readonly string[] }>;
export type ConfirmationPrompt = AudioPrompt | Readonly<{ type: 'visual' }>;
export type CountIllustration = Pick<CountObject, 'id' | 'image'> &
  (Readonly<{ kind: 'raster' }> | Readonly<{ kind: 'tinted'; hex: string }>);
export type SequencePattern = 'ABAB' | 'AABAAB' | 'ABCABC';
type Speech = Readonly<{ textTt: string; audio: AudioPrompt }>;
export type SpokenPrompt = Speech & Readonly<{ kind: 'spoken' }>;
export type Prompt = Speech &
  (
    | Readonly<{ kind: 'spoken' }>
    | Readonly<{
        kind: 'tinted-object';
        object: Extract<CountIllustration, { kind: 'tinted' }>;
      }>
    | Readonly<{ kind: 'shape-request'; shapeId: ShapeId; colorId: string }>
    | Readonly<{
        kind: 'sized-shape-request';
        shapeId: ShapeId;
        colorId: string;
        sizeId: SizeId;
      }>
    | Readonly<{
        kind: 'color-sequence';
        pattern: SequencePattern;
        colorIds: readonly string[];
      }>
    | Readonly<{ kind: 'trait'; traitId: TraitId }>
    | Readonly<{ kind: 'silhouette'; animalId: string; image: string }>
    | Readonly<{
        kind: 'quantity';
        value: number;
        countObject: CountIllustration;
      }>
    | Readonly<{ kind: 'numeral'; value: number }>
    | Readonly<{ kind: 'comparison'; direction: 'more' | 'less' }>
    | Readonly<{
        kind: 'addition';
        left: number;
        right: number;
        countObject: CountIllustration;
      }>
    | Readonly<{
        kind: 'subtraction';
        total: number;
        removed: number;
        countObject: CountIllustration;
      }>
  );
type OptionBase = Readonly<{ id: string; labelTt: string }>;
export type ColorOption = OptionBase & Readonly<{ kind: 'color'; hex: string }>;
export type AnimalOption = OptionBase &
  Readonly<{ kind: 'animal'; image: string }>;
export type NumberOption = OptionBase &
  Readonly<{ kind: 'number'; value: number }>;
export type GroupOption = OptionBase &
  Readonly<{ kind: 'group'; value: number }>;
export type ShapeOption = OptionBase &
  Readonly<{ kind: 'shape'; shapeId: ShapeId; colorId: string }>;
export type SizedShapeOption = OptionBase &
  Readonly<{
    kind: 'sized-shape';
    shapeId: ShapeId;
    colorId: string;
    sizeId: SizeId;
  }>;
export type Option =
  | ColorOption
  | AnimalOption
  | NumberOption
  | GroupOption
  | ShapeOption
  | SizedShapeOption;

type ExerciseBase = Readonly<{ id: number; correctOptionId: string }>;
type DirectExercise =
  | Readonly<{
      kind: 'C1';
      categoryId: 'colors';
      difficulty: 1;
      prompt: SpokenPrompt;
      options: readonly ColorOption[];
    }>
  | Readonly<{
      kind: 'A1';
      categoryId: 'animals';
      difficulty: 1;
      prompt: SpokenPrompt;
      options: readonly AnimalOption[];
    }>;
export type JuniorExercise = ExerciseBase &
  Readonly<{ mode: 'junior'; confirmation: AudioPrompt }> &
  (
    | DirectExercise
    | Readonly<{
        kind: 'N1-A';
        categoryId: 'numbers';
        difficulty: 1;
        prompt: SpokenPrompt;
        options: readonly NumberOption[];
        countObject: CountIllustration;
      }>
  );
type P<K extends Prompt['kind']> = Extract<Prompt, { kind: K }>;
export type SeniorExercise = ExerciseBase &
  Readonly<{ mode: 'senior' }> &
  (
    | (Readonly<{ confirmation: AudioPrompt }> &
        (
          | DirectExercise
          | Readonly<{
              kind: 'C2';
              categoryId: 'colors';
              difficulty: 1;
              prompt: P<'tinted-object'>;
              options: readonly ColorOption[];
            }>
          | Readonly<{
              kind: 'C4';
              categoryId: 'colors';
              difficulty: 3;
              prompt: P<'color-sequence'>;
              options: readonly ColorOption[];
            }>
          | Readonly<{
              kind: 'A2';
              categoryId: 'animals';
              difficulty: 2;
              prompt: P<'trait'>;
              options: readonly AnimalOption[];
            }>
          | Readonly<{
              kind: 'A3';
              categoryId: 'animals';
              difficulty: 2;
              prompt: P<'silhouette'>;
              options: readonly AnimalOption[];
            }>
          | Readonly<{
              kind: 'N1-A';
              categoryId: 'numbers';
              difficulty: 1;
              prompt: SpokenPrompt;
              options: readonly NumberOption[];
            }>
          | Readonly<{
              kind: 'N1-B';
              categoryId: 'numbers';
              difficulty: 1;
              prompt: P<'quantity'>;
              options: readonly NumberOption[];
            }>
          | Readonly<{
              kind: 'N1-C';
              categoryId: 'numbers';
              difficulty: 1;
              prompt: P<'numeral'>;
              options: readonly GroupOption[];
              countObject: CountIllustration;
            }>
          | Readonly<{
              kind: 'N2';
              categoryId: 'numbers';
              difficulty: 2;
              prompt: P<'comparison'>;
              options: readonly GroupOption[];
              countObject: CountIllustration;
            }>
          | Readonly<{
              kind: 'N3-A';
              categoryId: 'numbers';
              difficulty: 3;
              prompt: P<'addition'>;
              options: readonly NumberOption[];
            }>
          | Readonly<{
              kind: 'N3-B';
              categoryId: 'numbers';
              difficulty: 3;
              prompt: P<'subtraction'>;
              options: readonly NumberOption[];
            }>
        ))
    | Readonly<{
        kind: 'C3-A';
        categoryId: 'colors';
        difficulty: 2;
        prompt: P<'shape-request'>;
        options: readonly ShapeOption[];
        confirmation: ConfirmationPrompt;
      }>
    | Readonly<{
        kind: 'C3-B';
        categoryId: 'colors';
        difficulty: 2;
        prompt: P<'sized-shape-request'>;
        options: readonly SizedShapeOption[];
        confirmation: ConfirmationPrompt;
      }>
  );
export type Exercise = JuniorExercise | SeniorExercise;
export function audioClipIds(prompt: ConfirmationPrompt): readonly string[] {
  return prompt.type === 'clip'
    ? [prompt.clipId]
    : prompt.type === 'sequence'
      ? prompt.clipIds
      : [];
}
