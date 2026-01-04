import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CompactRange, rangeNodes, serializeTile, deserializeTile } from '../src/merkle.js';
import { leafHash } from '../src/crypto.js';

describe('CompactRange', () => {
  test('empty range has size 0', () => {
    const range = CompactRange.empty();
    assert.strictEqual(range.size(), 0n);
    assert.deepStrictEqual(range.getHashes(), []);
  });

  test('append single leaf', async () => {
    const range = CompactRange.empty();
    const hash = await leafHash(new TextEncoder().encode('hello'));

    await range.append(hash);

    assert.strictEqual(range.size(), 1n);
    assert.strictEqual(range.getHashes().length, 1);
  });

  test('append two leaves merges into single hash', async () => {
    const range = CompactRange.empty();
    const hash1 = await leafHash(new TextEncoder().encode('hello'));
    const hash2 = await leafHash(new TextEncoder().encode('world'));

    await range.append(hash1);
    await range.append(hash2);

    assert.strictEqual(range.size(), 2n);
    // Two leaves form a perfect subtree, so only one hash stored
    assert.strictEqual(range.getHashes().length, 1);
  });

  test('append three leaves stores two hashes', async () => {
    const range = CompactRange.empty();
    const hash1 = await leafHash(new TextEncoder().encode('a'));
    const hash2 = await leafHash(new TextEncoder().encode('b'));
    const hash3 = await leafHash(new TextEncoder().encode('c'));

    await range.append(hash1);
    await range.append(hash2);
    await range.append(hash3);

    assert.strictEqual(range.size(), 3n);
    // 3 = 2 + 1 = 2^1 + 2^0, so two hashes
    assert.strictEqual(range.getHashes().length, 2);
  });

  test('append four leaves merges into single hash', async () => {
    const range = CompactRange.empty();
    for (let i = 0; i < 4; i++) {
      const hash = await leafHash(new TextEncoder().encode(`leaf${i}`));
      await range.append(hash);
    }

    assert.strictEqual(range.size(), 4n);
    // 4 = 2^2, single perfect subtree
    assert.strictEqual(range.getHashes().length, 1);
  });

  test('append five leaves stores two hashes', async () => {
    const range = CompactRange.empty();
    for (let i = 0; i < 5; i++) {
      const hash = await leafHash(new TextEncoder().encode(`leaf${i}`));
      await range.append(hash);
    }

    assert.strictEqual(range.size(), 5n);
    // 5 = 4 + 1 = 2^2 + 2^0
    assert.strictEqual(range.getHashes().length, 2);
  });

  test('getRoot returns consistent hash', async () => {
    const range = CompactRange.empty();
    const hash1 = await leafHash(new TextEncoder().encode('hello'));
    const hash2 = await leafHash(new TextEncoder().encode('world'));

    await range.append(hash1);
    await range.append(hash2);

    const root1 = await range.getRoot();
    const root2 = await range.getRoot();

    assert.deepStrictEqual(root1, root2);
    assert.strictEqual(root1.length, 32);
  });

  test('different data produces different roots', async () => {
    const range1 = CompactRange.empty();
    const range2 = CompactRange.empty();

    await range1.append(await leafHash(new TextEncoder().encode('hello')));
    await range2.append(await leafHash(new TextEncoder().encode('world')));

    const root1 = await range1.getRoot();
    const root2 = await range2.getRoot();

    assert.notDeepStrictEqual(root1, root2);
  });

  test('visitor is called for each node', async () => {
    const range = CompactRange.empty();
    const visited = [];

    const visitor = async (level, index, hash) => {
      visited.push({ level, index, hashLen: hash.length });
    };

    const hash1 = await leafHash(new TextEncoder().encode('a'));
    const hash2 = await leafHash(new TextEncoder().encode('b'));

    await range.append(hash1, visitor);
    await range.append(hash2, visitor);

    // First append: 1 leaf node
    // Second append: 1 leaf node + 1 internal node
    assert.strictEqual(visited.length, 3);

    // First leaf
    assert.deepStrictEqual(visited[0], { level: 0n, index: 0n, hashLen: 32 });
    // Second leaf
    assert.deepStrictEqual(visited[1], { level: 0n, index: 1n, hashLen: 32 });
    // Internal node (parent of both leaves)
    assert.deepStrictEqual(visited[2], { level: 1n, index: 0n, hashLen: 32 });
  });
});

describe('rangeNodes', () => {
  test('empty range returns no nodes', () => {
    const nodes = rangeNodes(0n, 0n);
    assert.deepStrictEqual(nodes, []);
  });

  test('single leaf returns one node', () => {
    const nodes = rangeNodes(0n, 1n);
    assert.deepStrictEqual(nodes, [{ level: 0n, index: 0n }]);
  });

  test('two leaves returns one node at level 1', () => {
    const nodes = rangeNodes(0n, 2n);
    assert.deepStrictEqual(nodes, [{ level: 1n, index: 0n }]);
  });

  test('three leaves returns two nodes', () => {
    const nodes = rangeNodes(0n, 3n);
    // 3 = 2 + 1 = 2^1 + 2^0
    assert.deepStrictEqual(nodes, [
      { level: 0n, index: 2n },  // single leaf at index 2
      { level: 1n, index: 0n },  // subtree of 2 at index 0
    ]);
  });

  test('five leaves returns two nodes', () => {
    const nodes = rangeNodes(0n, 5n);
    // 5 = 4 + 1 = 2^2 + 2^0
    assert.deepStrictEqual(nodes, [
      { level: 0n, index: 4n },  // single leaf at index 4
      { level: 2n, index: 0n },  // subtree of 4 at index 0
    ]);
  });
});

describe('Tile Serialization', () => {
  test('serialize and deserialize roundtrip', () => {
    const tile = new Map();
    const hash1 = new Uint8Array(32).fill(1);
    const hash2 = new Uint8Array(32).fill(2);
    const hash3 = new Uint8Array(32).fill(3);

    tile.set('0:0', hash1);
    tile.set('0:1', hash2);
    tile.set('0:2', hash3);
    // Also add an internal node (should be ignored in serialization)
    tile.set('1:0', new Uint8Array(32).fill(99));

    const serialized = serializeTile(tile);
    assert.strictEqual(serialized.length, 96); // 3 * 32 bytes

    const deserialized = deserializeTile(serialized);
    assert.strictEqual(deserialized.length, 3);
    assert.deepStrictEqual(deserialized[0], hash1);
    assert.deepStrictEqual(deserialized[1], hash2);
    assert.deepStrictEqual(deserialized[2], hash3);
  });

  test('deserialize empty tile', () => {
    const deserialized = deserializeTile(new Uint8Array(0));
    assert.deepStrictEqual(deserialized, []);
  });
});
