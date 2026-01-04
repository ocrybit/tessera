import { nodeHash } from './crypto.js';
import { TILE_HEIGHT, TILE_WIDTH, nodeCoordsToTileAddress } from './tiles.js';

/**
 * CompactRange represents a Merkle tree as a list of right-edge perfect subtree hashes.
 * This allows efficient appending of new leaves without storing the entire tree.
 *
 * For a tree of size N, we store O(log N) hashes representing the right edge.
 * The stored hashes correspond to perfect subtrees of sizes that are powers of 2.
 *
 * @example
 * // Tree of size 5 = 4 + 1 = 2^2 + 2^0
 * // Stores 2 hashes: one for the 4-leaf subtree, one for the single leaf
 */
export class CompactRange {
  /**
   * @param {bigint} begin - Start index (always 0 for our use case)
   * @param {bigint} end - Current tree size
   * @param {Uint8Array[]} hashes - Right-edge hashes (least significant bit first)
   */
  constructor(begin, end, hashes = []) {
    this.begin = begin;
    this.end = end;
    this.hashes = [...hashes];
  }

  /**
   * Creates an empty range starting at the given index
   * @param {bigint} begin - Starting index
   * @returns {CompactRange}
   */
  static empty(begin = 0n) {
    return new CompactRange(begin, begin, []);
  }

  /**
   * Creates a range from existing hashes
   * @param {bigint} begin - Start index
   * @param {bigint} end - End index (tree size)
   * @param {Uint8Array[]} hashes - Right-edge hashes
   * @returns {CompactRange}
   */
  static fromHashes(begin, end, hashes) {
    return new CompactRange(begin, end, hashes);
  }

  /**
   * Returns the current tree size
   * @returns {bigint}
   */
  size() {
    return this.end - this.begin;
  }

  /**
   * Appends a new leaf hash to the range.
   * Calls the visitor function for each node that is created or updated.
   *
   * @param {Uint8Array} leafHash - The hash of the new leaf
   * @param {function(bigint, bigint, Uint8Array): Promise<void>} [visitor] - Called with (level, index, hash) for each node
   */
  async append(leafHash, visitor) {
    const index = this.end;
    this.end++;

    // Visit the leaf node
    if (visitor) {
      await visitor(0n, index, leafHash);
    }

    // Start with the new leaf hash
    let hash = leafHash;
    let level = 0n;
    let nodeIndex = index;

    // Merge with existing subtrees of the same size
    while (this.hashes.length > 0 && (nodeIndex & 1n) === 1n) {
      const left = this.hashes.pop();
      hash = await nodeHash(left, hash);
      level++;
      nodeIndex = nodeIndex >> 1n;

      // Visit the newly computed internal node
      if (visitor) {
        await visitor(level, nodeIndex, hash);
      }
    }

    // Store the resulting subtree hash
    this.hashes.push(hash);
  }

  /**
   * Computes the root hash of the tree.
   * Does not modify the range or call any visitor.
   *
   * @returns {Promise<Uint8Array>} The root hash
   */
  async getRoot() {
    if (this.hashes.length === 0) {
      // Empty tree - return the RFC 6962 empty tree hash
      // SHA-256 of empty string
      return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(0)));
    }

    // Hash all subtrees right-to-left to get the root
    let hash = this.hashes[this.hashes.length - 1];
    for (let i = this.hashes.length - 2; i >= 0; i--) {
      hash = await nodeHash(this.hashes[i], hash);
    }

    return hash;
  }

  /**
   * Returns a copy of the right-edge hashes
   * @returns {Uint8Array[]}
   */
  getHashes() {
    return [...this.hashes];
  }
}

/**
 * Computes the node IDs that form the compact range for a tree of the given size.
 * These are the "right edge" nodes needed to represent the tree compactly.
 * Nodes are returned in order from smallest subtree (rightmost) to largest (leftmost).
 *
 * @param {bigint} begin - Start index (typically 0)
 * @param {bigint} end - End index (tree size)
 * @returns {Array<{level: bigint, index: bigint}>} Node IDs in the compact range
 */
export function rangeNodes(begin, end) {
  const nodes = [];
  let size = end - begin;
  let rightEdge = end;
  let level = 0n;

  while (size > 0n) {
    if (size & 1n) {
      // There's a subtree of size 2^level ending at rightEdge
      const subtreeStart = rightEdge - (1n << level);
      nodes.push({ level, index: subtreeStart >> level });
      rightEdge = subtreeStart;
    }
    size >>= 1n;
    level++;
  }

  return nodes;
}

/**
 * Creates a tile visitor function that stores nodes into tiles.
 * This maps tree coordinates to tile coordinates and accumulates tile data.
 *
 * @param {Map<string, Map<string, Uint8Array>>} tiles - Map of "level:index" -> node hashes
 * @returns {function(bigint, bigint, Uint8Array): Promise<void>}
 */
export function tileVisitor(tiles) {
  return async (level, index, hash) => {
    const { tileLevel, tileIndex, nodeLevel, nodeIndex } = nodeCoordsToTileAddress(level, index);
    const tileKey = `${tileLevel}:${tileIndex}`;

    if (!tiles.has(tileKey)) {
      tiles.set(tileKey, new Map());
    }

    const tile = tiles.get(tileKey);
    const nodeKey = `${nodeLevel}:${nodeIndex}`;
    tile.set(nodeKey, hash);
  };
}

/**
 * Serializes a tile's hashes into a blob format.
 * Tiles store leaf hashes (level 0) concatenated together.
 *
 * @param {Map<string, Uint8Array>} tile - Map of "level:index" -> hash
 * @returns {Uint8Array} Concatenated leaf hashes
 */
export function serializeTile(tile) {
  // Get all level 0 nodes and sort by index
  const leaves = [];
  for (const [key, hash] of tile) {
    const [level, index] = key.split(':').map(n => BigInt(n));
    if (level === 0n) {
      leaves.push({ index, hash });
    }
  }

  leaves.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));

  // Concatenate the hashes
  const totalSize = leaves.length * 32;
  const result = new Uint8Array(totalSize);
  for (let i = 0; i < leaves.length; i++) {
    result.set(leaves[i].hash, i * 32);
  }

  return result;
}

/**
 * Deserializes a tile blob back into leaf hashes.
 *
 * @param {Uint8Array} data - Concatenated leaf hashes
 * @returns {Uint8Array[]} Array of 32-byte hashes
 */
export function deserializeTile(data) {
  const hashes = [];
  for (let i = 0; i < data.length; i += 32) {
    hashes.push(data.slice(i, i + 32));
  }
  return hashes;
}
