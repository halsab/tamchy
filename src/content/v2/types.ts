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
  recipes: Readonly<Record<DirectKind, readonly AudioRecipe[]>>;
}>;
