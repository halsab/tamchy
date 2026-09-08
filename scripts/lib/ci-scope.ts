const tooling = new Set([
  'scripts/ci-scope.ts',
  'scripts/lib/ci-scope.ts',
  'scripts/lib/ci-scope.test.ts',
  'scripts/select-deployment.ts',
  'scripts/lib/deployment.ts',
  'scripts/lib/deployment.test.ts',
  'scripts/verify-release.ts',
  'scripts/lib/release.ts',
  'scripts/lib/release.test.ts',
]);

export function classifyChanges(paths: string[]): 'docs' | 'tooling' | 'app' {
  if (!paths.length) return 'app';
  let result: 'docs' | 'tooling' = 'docs';
  for (const path of paths) {
    if (/^(docs\/|README\.md$|AGENTS\.md$|LICENSE$)/.test(path)) continue;
    if (path.startsWith('.github/') || tooling.has(path)) result = 'tooling';
    else return 'app';
  }
  return result;
}
