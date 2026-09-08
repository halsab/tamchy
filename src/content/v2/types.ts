import type { CategoryId } from '../types.ts';

export type CategoryDefinition = Readonly<{
  id: CategoryId;
  labelTt: string;
  image: string;
}>;
export type ColorDefinition = Readonly<{
  id: string;
  labelTt: string;
  hex: string;
  labelClipId: string;
}>;
export type AnimalDefinition = Readonly<{
  id: string;
  labelTt: string;
  labelClipId: string;
  targetClipId: string;
  image: string;
}>;
export type NumberDefinition = Readonly<{
  id: string;
  value: number;
  labelTt: string;
  labelClipId: string;
  targetClipId: string;
}>;
export type CountObject = Readonly<{
  id: string;
  kind: 'raster' | 'tinted';
  labelTt: string;
  labelClipId: string;
  image: string;
}>;
export type AudioClip = Readonly<{
  id: string;
  textTt: string;
  path: string;
  master: string | null;
}>;
export type DirectKind = 'C1' | 'A1' | 'N1-A';
export type AudioRecipe = Readonly<{
  id: string;
  parts: readonly string[];
  ending: '.' | '?';
}>;
export type ContentV2 = Readonly<{
  categories: readonly CategoryDefinition[];
  colors: readonly ColorDefinition[];
  animals: readonly AnimalDefinition[];
  numbers: readonly NumberDefinition[];
  countObjects: readonly CountObject[];
  audio: readonly AudioClip[];
  shapes: readonly ShapeDefinition[];
  sizes: readonly SizeDefinition[];
  animalTraits: AnimalTraits;
  silhouetteConflicts: SilhouetteConflicts;
  recipes: Readonly<Record<ExerciseKind, readonly AudioRecipe[]>>;
}>;

export type ShapeId =
  'circle' | 'square' | 'triangle' | 'rectangle' | 'oval' | 'star';
export type SizeId = 'big' | 'small';
export type ShapeDefinition = Readonly<{
  id: ShapeId;
  countObjectId: string;
  targetClipId: string;
}>;
export type SizeDefinition = Readonly<{
  id: SizeId;
  labelTt: string;
  labelClipId: string;
}>;
export type ExerciseKind =
  | DirectKind
  | 'C2'
  | 'C3-A'
  | 'C3-B'
  | 'C4'
  | 'A2'
  | 'A3'
  | 'N1-B'
  | 'N1-C'
  | 'N2'
  | 'N3-A'
  | 'N3-B';
export type TraitId = 'bird' | 'domestic' | 'wild' | 'canFly' | 'canSwim';
export type TraitValue = 'yes' | 'no' | 'exclude';
export type AnimalTraits = Readonly<{
  version: number;
  evaluatedOn: string;
  scopeRu: string;
  valueMeaning: Readonly<Record<TraitValue, string>>;
  traits: readonly (Readonly<{ id: TraitId; clipId: string }> &
    (
      | Readonly<{ generation: 'enabled' }>
      | Readonly<{ generation: 'disabled'; decisionRu: string }>
    ))[];
  sources: readonly Readonly<{
    id: string;
    title: string;
    url: string;
    useRu: string;
  }>[];
  animals: readonly Readonly<{
    animalId: string;
    values: Readonly<Record<TraitId, TraitValue>>;
    exclusions: Readonly<Partial<Record<TraitId, string>>>;
    sourceIds: readonly string[];
  }>[];
}>;
export type SilhouetteConflicts = Readonly<{
  version: number;
  evaluatedOn: string;
  scopeRu: string;
  reviewSizesCssPx: readonly number[];
  renderingRu: string;
  pairRuleRu: string;
  animals: readonly Readonly<{
    animalId: string;
    masterSha256: string;
    webpSha256: string;
    observationRu: string;
  }>[];
  pairs: readonly Readonly<{
    animalIds: readonly [string, string];
    reasonRu: string;
  }>[];
}>;
