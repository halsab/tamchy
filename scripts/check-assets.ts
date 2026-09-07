import { inspectArtifact } from './lib/artifact.ts';
const artifact = await inspectArtifact();
console.log(
  `Проверены dist и precache: ${artifact.metadata.entries.length} обязательных файлов, base ${artifact.metadata.base}, выпуск ${artifact.metadata.release}.`,
);
