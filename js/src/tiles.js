/**
 * Tile math for tlog-tiles API
 * @see https://c2sp.org/tlog-tiles
 */

/** Maximum number of Merkle tree levels a tile represents (fixed by tlog-tiles spec) */
export const TILE_HEIGHT = 8n;

/** Maximum number of hashes in the bottom row of a tile (2^8 = 256) */
export const TILE_WIDTH = 1n << TILE_HEIGHT;

/** Maximum entries per bundle (same as TILE_WIDTH by spec) */
export const ENTRY_BUNDLE_WIDTH = TILE_WIDTH;

/** Path to the checkpoint file */
export const CHECKPOINT_PATH = 'checkpoint';

/**
 * Formats the "N" part of a tlog-tiles path.
 * N is grouped into chunks of 3 decimal digits, prefixed with "x" except the last group.
 * @param {bigint} n - The index to format
 * @returns {string} Formatted path component
 * @example fmtN(1234067n) => "x001/x234/067"
 * @example fmtN(67n) => "067"
 */
export function fmtN(n) {
  let result = String(n % 1000n).padStart(3, '0');
  n = n / 1000n;
  while (n > 0n) {
    result = `x${String(n % 1000n).padStart(3, '0')}/${result}`;
    n = n / 1000n;
  }
  return result;
}

/**
 * Returns suffix for partial tiles
 * @param {bigint} level - Tile level
 * @param {bigint} n - Tile index
 * @param {number} partial - Partial tile size (0 for full)
 * @returns {string} Path with optional partial suffix
 */
export function nWithSuffix(level, n, partial) {
  const suffix = partial > 0 ? `.p/${partial}` : '';
  return `${fmtN(n)}${suffix}`;
}

/**
 * Calculates expected number of leaves in a tile
 * @param {bigint} level - Tile level
 * @param {bigint} index - Tile index
 * @param {bigint} logSize - Current tree size
 * @returns {number} Partial size (0 if fully populated)
 */
export function partialTileSize(level, index, logSize) {
  const sizeAtLevel = logSize >> (level * TILE_HEIGHT);
  const fullTiles = sizeAtLevel / TILE_WIDTH;
  if (index < fullTiles) {
    return 0;
  }
  return Number(sizeAtLevel % TILE_WIDTH);
}

/**
 * Builds path to a subtree tile
 * @param {bigint} level - Tile level in tile space
 * @param {bigint} index - Tile index in tile space
 * @param {number} partial - Partial tile size (0 for full)
 * @returns {string} Tile path
 * @example tilePath(0n, 1234067n, 0) => "tile/0/x001/x234/067"
 */
export function tilePath(level, index, partial = 0) {
  return `tile/${level}/${nWithSuffix(level, index, partial)}`;
}

/**
 * Builds path to an entry bundle
 * @param {bigint} n - Bundle index
 * @param {number} partial - Partial size (0 for full)
 * @returns {string} Entry bundle path
 * @example entriesPath(1234067n, 0) => "tile/entries/x001/x234/067"
 */
export function entriesPath(n, partial = 0) {
  return `tile/entries/${nWithSuffix(0n, n, partial)}`;
}

/**
 * Gets entry bundle path for a specific log index
 * @param {bigint} seq - Log sequence number
 * @param {bigint} logSize - Current tree size
 * @returns {string} Entry bundle path
 */
export function entriesPathForLogIndex(seq, logSize) {
  const bundleIndex = seq / ENTRY_BUNDLE_WIDTH;
  return entriesPath(bundleIndex, partialTileSize(0n, bundleIndex, logSize));
}

/**
 * Converts tree node coordinates to tile address
 * @param {bigint} treeLevel - Level in the tree (0 = leaves)
 * @param {bigint} treeIndex - Index at that level
 * @returns {{tileLevel: bigint, tileIndex: bigint, nodeLevel: bigint, nodeIndex: bigint}}
 */
export function nodeCoordsToTileAddress(treeLevel, treeIndex) {
  const tileRowWidth = 1n << (TILE_HEIGHT - treeLevel % TILE_HEIGHT);
  const tileLevel = treeLevel / TILE_HEIGHT;
  const tileIndex = treeIndex / tileRowWidth;
  const nodeLevel = treeLevel % TILE_HEIGHT;
  const nodeIndex = treeIndex % tileRowWidth;

  return { tileLevel, tileIndex, nodeLevel, nodeIndex };
}
