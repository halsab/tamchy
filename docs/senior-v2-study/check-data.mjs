import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const json = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));
const animals = await json('src/content/v2/animals.json');
const graphics = await json('src/content/v2/graphics.json');
const traits = await json('src/content/v2/animal-traits.json');
const silhouettes = await json('src/content/v2/silhouette-conflicts.json');
const ids = animals.map((a) => a.id);
const traitIds = ['bird', 'domestic', 'wild', 'canFly', 'canSwim'];
const sameIds = (actual, expected) =>
  assert.deepEqual([...actual].sort(), [...expected].sort());
sameIds(
  traits.animals.map((a) => a.animalId),
  ids,
);
sameIds(
  silhouettes.animals.map((a) => a.animalId),
  ids,
);
sameIds(
  traits.traits.map((t) => t.id),
  traitIds,
);
assert.equal(
  new Set(traits.sources.map((s) => s.id)).size,
  traits.sources.length,
);
const sourceIds = new Set(traits.sources.map((s) => s.id));
for (const animal of traits.animals) {
  sameIds(Object.keys(animal.values), traitIds);
  for (const [id, value] of Object.entries(animal.values)) {
    assert.ok(['yes', 'no', 'exclude'].includes(value));
    if (value === 'exclude')
      assert.ok(
        animal.exclusions[id]?.length > 10,
        `${animal.animalId}: ${id}`,
      );
  }
  for (const source of animal.sourceIds) assert.ok(sourceIds.has(source));
  assert.ok(animal.sourceIds.length > 0);
}
for (const animal of silhouettes.animals) {
  const graphic = graphics.find((g) => g.id === animal.animalId);
  assert.equal(animal.masterSha256, graphic.sha256);
  const hash = createHash('sha256')
    .update(await readFile(new URL(graphic.source, root)))
    .digest('hex');
  assert.equal(hash, animal.masterSha256);
  const item = animals.find((a) => a.id === animal.animalId);
  const outputHash = createHash('sha256')
    .update(await readFile(new URL('public/' + item.image, root)))
    .digest('hex');
  assert.equal(outputHash, animal.webpSha256);
  assert.ok(animal.observationRu.length > 20);
}

const conflicts = new Set();
const pairKey = (a, b) => [a, b].sort().join('|');
for (const pair of silhouettes.pairs) {
  assert.equal(pair.animalIds.length, 2);
  const [a, b] = pair.animalIds;
  assert.ok(ids.includes(a) && ids.includes(b) && a !== b);
  const key = pairKey(a, b);
  assert.ok(!conflicts.has(key), key);
  conflicts.add(key);
  assert.ok(pair.reasonRu.length > 20);
}
assert.ok(conflicts.size > 0);

function findSet(target, count, pool, forbidden) {
  const candidates = pool.filter((id) => id !== target);
  function visit(selected, from) {
    if (selected.length === count) return selected;
    if (selected.length + candidates.length - from < count) return null;
    for (let index = from; index < candidates.length; index++) {
      const next = candidates[index];
      if (selected.some((id) => forbidden.has(pairKey(id, next)))) continue;
      const result = visit([...selected, next], index + 1);
      if (result) return result;
    }
    return null;
  }
  return visit([target], 0);
}

// Полностью конфликтующий набор проверяет конечный отказ, а не случайную удачу поиска.
assert.equal(
  findSet('a', 4, ['a', 'b', 'c', 'd'], new Set(['a|b', 'a|c', 'a|d'])),
  null,
);
assert.equal(findSet('a', 4, ['a', 'b', 'c'], new Set()), null);
assert.deepEqual(findSet('a', 4, ['a', 'b', 'c', 'd'], new Set()), [
  'a',
  'b',
  'c',
  'd',
]);

const traitSummary = traits.traits.map((trait) => {
  const positive = traits.animals.filter((a) => a.values[trait.id] === 'yes');
  const negative = traits.animals.filter((a) => a.values[trait.id] === 'no');
  const excluded = traits.animals.filter(
    (a) => a.values[trait.id] === 'exclude',
  );
  const possible = Object.fromEntries(
    [4, 5, 6].map((count) => [
      count,
      positive.length > 0 && negative.length >= count - 1,
    ]),
  );
  if (trait.generation === 'enabled') assert.ok(possible[6], trait.id);
  return {
    trait: trait.id,
    generation: trait.generation,
    yes: positive.length,
    no: negative.length,
    exclude: excluded.length,
    possible,
  };
});

const silhouetteSets = [];
for (const target of ids)
  for (const count of [4, 5, 6]) {
    const options = findSet(target, count, ids, conflicts);
    assert.ok(options, `${target}: ${count}`);
    assert.equal(new Set(options).size, count);
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++)
        assert.ok(!conflicts.has(pairKey(options[i], options[j])));
    silhouetteSets.push({ target, count, options });
  }
console.log(
  JSON.stringify(
    {
      animalCount: ids.length,
      reviewedTraitCells: ids.length * traitIds.length,
      traits: traitSummary,
      silhouettePairs: conflicts.size,
      checkedSilhouetteSets: silhouetteSets.length,
      impossibleFixtures: 2,
      silhouetteSets,
    },
    null,
    2,
  ),
);
