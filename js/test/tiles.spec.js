import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  ENTRY_BUNDLE_WIDTH,
  fmtN,
  nWithSuffix,
  partialTileSize,
  tilePath,
  entriesPath,
  entriesPathForLogIndex,
  nodeCoordsToTileAddress,
} from '../src/tiles.js';

describe('Tile Constants', () => {
  test('TILE_HEIGHT is 8', () => {
    assert.strictEqual(TILE_HEIGHT, 8n);
  });

  test('TILE_WIDTH is 256', () => {
    assert.strictEqual(TILE_WIDTH, 256n);
  });

  test('ENTRY_BUNDLE_WIDTH equals TILE_WIDTH', () => {
    assert.strictEqual(ENTRY_BUNDLE_WIDTH, TILE_WIDTH);
  });
});

describe('fmtN', () => {
  test('formats small numbers with 3 digits', () => {
    assert.strictEqual(fmtN(0n), '000');
    assert.strictEqual(fmtN(1n), '001');
    assert.strictEqual(fmtN(67n), '067');
    assert.strictEqual(fmtN(999n), '999');
  });

  test('formats larger numbers with x prefix groups', () => {
    assert.strictEqual(fmtN(1000n), 'x001/000');
    assert.strictEqual(fmtN(1234n), 'x001/234');
    assert.strictEqual(fmtN(1234067n), 'x001/x234/067');
    assert.strictEqual(fmtN(123456789n), 'x123/x456/789');
  });
});

describe('nWithSuffix', () => {
  test('returns path without suffix when partial is 0', () => {
    assert.strictEqual(nWithSuffix(0n, 67n, 0), '067');
  });

  test('returns path with partial suffix when partial > 0', () => {
    assert.strictEqual(nWithSuffix(0n, 67n, 8), '067.p/8');
    assert.strictEqual(nWithSuffix(0n, 1234n, 128), 'x001/234.p/128');
  });
});

describe('partialTileSize', () => {
  test('returns 0 for full tiles', () => {
    // Tree size 512 = 2 full tiles at level 0
    assert.strictEqual(partialTileSize(0n, 0n, 512n), 0);
    assert.strictEqual(partialTileSize(0n, 1n, 512n), 0);
  });

  test('returns partial size for incomplete tiles', () => {
    // Tree size 300 = 1 full tile (256) + 44 entries
    assert.strictEqual(partialTileSize(0n, 0n, 300n), 0);
    assert.strictEqual(partialTileSize(0n, 1n, 300n), 44);
  });

  test('returns correct partial for small trees', () => {
    assert.strictEqual(partialTileSize(0n, 0n, 100n), 100);
    assert.strictEqual(partialTileSize(0n, 0n, 1n), 1);
  });
});

describe('tilePath', () => {
  test('builds correct path for level 0 tiles', () => {
    assert.strictEqual(tilePath(0n, 0n), 'tile/0/000');
    assert.strictEqual(tilePath(0n, 67n), 'tile/0/067');
    assert.strictEqual(tilePath(0n, 1234067n), 'tile/0/x001/x234/067');
  });

  test('builds correct path for higher level tiles', () => {
    assert.strictEqual(tilePath(1n, 5n), 'tile/1/005');
    assert.strictEqual(tilePath(2n, 0n), 'tile/2/000');
  });

  test('includes partial suffix when specified', () => {
    assert.strictEqual(tilePath(0n, 67n, 8), 'tile/0/067.p/8');
  });
});

describe('entriesPath', () => {
  test('builds correct entry bundle path', () => {
    assert.strictEqual(entriesPath(0n), 'tile/entries/000');
    assert.strictEqual(entriesPath(67n), 'tile/entries/067');
    assert.strictEqual(entriesPath(1234067n), 'tile/entries/x001/x234/067');
  });

  test('includes partial suffix when specified', () => {
    assert.strictEqual(entriesPath(67n, 8), 'tile/entries/067.p/8');
  });
});

describe('entriesPathForLogIndex', () => {
  test('maps index to correct bundle', () => {
    // First 256 entries go to bundle 0
    assert.strictEqual(entriesPathForLogIndex(0n, 256n), 'tile/entries/000');
    assert.strictEqual(entriesPathForLogIndex(255n, 256n), 'tile/entries/000');
    // Entry 256 goes to bundle 1
    assert.strictEqual(entriesPathForLogIndex(256n, 512n), 'tile/entries/001');
  });

  test('adds partial suffix for incomplete bundles', () => {
    // Tree with 100 entries - bundle 0 is partial
    assert.strictEqual(entriesPathForLogIndex(0n, 100n), 'tile/entries/000.p/100');
  });
});

describe('nodeCoordsToTileAddress', () => {
  test('converts leaf coordinates', () => {
    const result = nodeCoordsToTileAddress(0n, 0n);
    assert.strictEqual(result.tileLevel, 0n);
    assert.strictEqual(result.tileIndex, 0n);
    assert.strictEqual(result.nodeLevel, 0n);
    assert.strictEqual(result.nodeIndex, 0n);
  });

  test('converts coordinates within same tile', () => {
    // Entry 100 at level 0
    const result = nodeCoordsToTileAddress(0n, 100n);
    assert.strictEqual(result.tileLevel, 0n);
    assert.strictEqual(result.tileIndex, 0n);
    assert.strictEqual(result.nodeLevel, 0n);
    assert.strictEqual(result.nodeIndex, 100n);
  });

  test('converts coordinates in second tile', () => {
    // Entry 300 at level 0 (in tile index 1)
    const result = nodeCoordsToTileAddress(0n, 300n);
    assert.strictEqual(result.tileLevel, 0n);
    assert.strictEqual(result.tileIndex, 1n);
    assert.strictEqual(result.nodeLevel, 0n);
    assert.strictEqual(result.nodeIndex, 44n);
  });

  test('handles higher tree levels', () => {
    // Level 8 in tree = level 1 in tiles
    const result = nodeCoordsToTileAddress(8n, 0n);
    assert.strictEqual(result.tileLevel, 1n);
    assert.strictEqual(result.nodeLevel, 0n);
  });
});
