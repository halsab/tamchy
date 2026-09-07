import { inspectArtifact, measureBudgets } from './lib/artifact.ts';
console.log(await measureBudgets(await inspectArtifact()));
