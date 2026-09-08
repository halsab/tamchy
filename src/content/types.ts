export type { InteractionId } from './interactions.ts';
export type {
  AudioClip,
  AudioRecipe,
  ContentV2,
  CountObject,
} from './v2/types.ts';
export type CategoryId = 'colors' | 'animals' | 'numbers';

type ItemBase = {
  id: string;
  labelTt: string;
  promptTt: string;
  labelAudio: string;
  promptAudio: string;
};

export type LearningItem = ItemBase &
  (
    | { kind: 'color'; hex: string }
    | { kind: 'animal'; image: string }
    | { kind: 'number'; value: number; countImage: string }
  );

export type Category = {
  id: CategoryId;
  labelTt: string;
  image: string;
  items: LearningItem[];
};

export type Catalog = { categories: Category[] };
