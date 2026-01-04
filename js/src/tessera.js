import { DurableObject } from 'cloudflare:workers';
import { leafHash, nodeHash } from './crypto.js';
import { CompactRange, tileVisitor, serializeTile } from './merkle.js';
import { TILE_WIDTH, tilePath, entriesPath, partialTileSize } from './tiles.js';

/**
 * Tessera Durable Object
 * Handles transparency log operations with SQLite storage
 */
export class Tessera extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    // Initialize SQLite schema
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tree_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        size INTEGER NOT NULL DEFAULT 0,
        root_hash BLOB
      )
    `);

    // Entry bundles: stores raw entry data grouped by bundle index
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        idx INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        leaf_hash BLOB NOT NULL
      )
    `);

    // Merkle tree tiles: stores computed tile hashes
    // Each tile contains up to 256 hashes at a specific level
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tiles (
        level INTEGER NOT NULL,
        tile_index INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (level, tile_index)
      )
    `);

    // Initialize tree_state if not exists
    this.ctx.storage.sql.exec(`
      INSERT OR IGNORE INTO tree_state (id, size) VALUES (1, 0)
    `);
  }

  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const response = await this.handleRequest(request);
    // Add CORS headers to all responses
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders())) {
      headers.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  async handleRequest(request) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Hello from Tessera!');
    }

    if (url.pathname === '/size') {
      const size = this.getTreeSize();
      return Response.json({ size });
    }

    if (url.pathname === '/hash/leaf' && request.method === 'POST') {
      const data = new Uint8Array(await request.arrayBuffer());
      const hash = await leafHash(data);
      return Response.json({ hash: toHex(hash) });
    }

    // POST /add - Add an entry to the log
    if (url.pathname === '/add' && request.method === 'POST') {
      return this.handleAdd(request);
    }

    // GET /checkpoint - Get the current checkpoint
    if (url.pathname === '/checkpoint') {
      return this.handleCheckpoint();
    }

    // GET /tile/{level}/{index...} - Get a tile
    const tileMatch = url.pathname.match(/^\/tile\/(\d+)\/(.+)$/);
    if (tileMatch) {
      const level = parseInt(tileMatch[1], 10);
      return this.handleTile(level, tileMatch[2]);
    }

    // GET /tile/entries/{index...} - Get an entry bundle
    const entriesMatch = url.pathname.match(/^\/tile\/entries\/(.+)$/);
    if (entriesMatch) {
      return this.handleEntryBundle(entriesMatch[1]);
    }

    // GET /proof/{index} - Get inclusion proof for an entry
    const proofMatch = url.pathname.match(/^\/proof\/(\d+)$/);
    if (proofMatch) {
      const index = parseInt(proofMatch[1], 10);
      return this.handleProof(index);
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handles POST /add - adds an entry and integrates it into the tree
   */
  async handleAdd(request) {
    const data = new Uint8Array(await request.arrayBuffer());
    const hash = await leafHash(data);

    const currentSize = this.getTreeSize();
    const index = currentSize;

    // Store the entry
    this.addEntry(index, data, hash);

    // Integrate into the merkle tree
    const tiles = new Map();
    const visitor = tileVisitor(tiles);

    // Load existing compact range hashes from stored tiles
    const range = await this.loadCompactRange(BigInt(currentSize));

    // Append the new leaf
    await range.append(hash, visitor);

    // Compute new root
    const newRoot = await range.getRoot();

    // Save updated tiles
    for (const [key, tileData] of tiles) {
      const [level, tileIndex] = key.split(':').map(Number);
      const serialized = serializeTile(tileData);
      this.setTile(level, tileIndex, serialized);
    }

    // Update tree state
    this.setTreeState(index + 1, newRoot);

    return Response.json({
      index,
      hash: toHex(hash),
      size: index + 1,
      root: toHex(newRoot),
    });
  }

  /**
   * Handles GET /checkpoint - returns the current tree state
   */
  handleCheckpoint() {
    const size = this.getTreeSize();
    const rootHash = this.getRootHash();

    // Format as a simple checkpoint (not signed yet)
    const checkpoint = {
      size,
      root: rootHash ? toHex(rootHash) : null,
    };

    return Response.json(checkpoint);
  }

  /**
   * Handles GET /tile/{level}/{index} - returns tile data
   */
  handleTile(level, indexPath) {
    // Parse the tile index from the path (e.g., "000" or "x001/234")
    const tileIndex = parseTileIndex(indexPath);
    if (tileIndex === null) {
      return new Response('Invalid tile index', { status: 400 });
    }

    const data = this.getTile(level, tileIndex);
    if (!data) {
      return new Response('Tile not found', { status: 404 });
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }

  /**
   * Handles GET /tile/entries/{index} - returns entry bundle data
   */
  handleEntryBundle(indexPath) {
    const bundleIndex = parseTileIndex(indexPath);
    if (bundleIndex === null) {
      return new Response('Invalid bundle index', { status: 400 });
    }

    const startIdx = bundleIndex * Number(TILE_WIDTH);
    const endIdx = startIdx + Number(TILE_WIDTH);
    const entries = this.getEntryRange(startIdx, endIdx);

    if (entries.length === 0) {
      return new Response('Bundle not found', { status: 404 });
    }

    // Concatenate entry data with length prefixes
    const parts = [];
    for (const entry of entries) {
      // SQLite returns ArrayBuffer, convert to Uint8Array
      const data = entry.data instanceof Uint8Array
        ? entry.data
        : new Uint8Array(entry.data);
      // 2-byte length prefix (big-endian)
      const lenBuf = new Uint8Array(2);
      lenBuf[0] = (data.length >> 8) & 0xff;
      lenBuf[1] = data.length & 0xff;
      parts.push(lenBuf, data);
    }

    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }

    return new Response(result, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }

  /**
   * Handles GET /proof/{index} - returns inclusion proof for an entry
   */
  async handleProof(index) {
    const size = this.getTreeSize();
    if (index < 0 || index >= size) {
      return Response.json({ error: 'Index out of bounds' }, { status: 400 });
    }

    const entry = this.getEntry(index);
    if (!entry) {
      return Response.json({ error: 'Entry not found' }, { status: 404 });
    }

    // Compute the inclusion proof (audit path)
    const proof = await this.computeInclusionProof(index, size);
    const entryLeafHash = entry.leaf_hash instanceof Uint8Array
      ? entry.leaf_hash
      : new Uint8Array(entry.leaf_hash);

    return Response.json({
      index,
      size,
      leafHash: toHex(entryLeafHash),
      proof: proof.map(h => toHex(h)),
    });
  }

  /**
   * Computes inclusion proof for a leaf at given index
   * Returns array of sibling hashes from leaf to root
   */
  async computeInclusionProof(index, size) {
    // Build a hash cache for all nodes we need
    const hashCache = new Map();

    // First, get all leaf hashes
    for (let i = 0; i < size; i++) {
      const entry = this.getEntry(i);
      if (entry) {
        const hash = entry.leaf_hash instanceof Uint8Array
          ? entry.leaf_hash
          : new Uint8Array(entry.leaf_hash);
        hashCache.set(`0:${i}`, hash);
      }
    }

    // Build internal nodes level by level
    let levelSize = size;
    let level = 0;
    while (levelSize > 1) {
      const nextLevelSize = Math.ceil(levelSize / 2);
      for (let i = 0; i < nextLevelSize; i++) {
        const leftIdx = i * 2;
        const rightIdx = i * 2 + 1;
        const leftHash = hashCache.get(`${level}:${leftIdx}`);

        if (rightIdx < levelSize) {
          const rightHash = hashCache.get(`${level}:${rightIdx}`);
          if (leftHash && rightHash) {
            const parentHash = await nodeHash(leftHash, rightHash);
            hashCache.set(`${level + 1}:${i}`, parentHash);
          }
        } else {
          // Odd node, promote to next level
          if (leftHash) {
            hashCache.set(`${level + 1}:${i}`, leftHash);
          }
        }
      }
      levelSize = nextLevelSize;
      level++;
    }

    // Now extract the proof (sibling hashes along the path)
    const proof = [];
    let idx = index;
    let proofLevel = 0;
    let remaining = size;

    while (remaining > 1) {
      const siblingIdx = idx ^ 1; // XOR to get sibling

      if (siblingIdx < remaining) {
        const siblingHash = hashCache.get(`${proofLevel}:${siblingIdx}`);
        if (siblingHash) {
          proof.push(siblingHash);
        }
      }

      idx = Math.floor(idx / 2);
      remaining = Math.ceil(remaining / 2);
      proofLevel++;
    }

    return proof;
  }

  /**
   * Loads the compact range from stored tiles for the given tree size
   */
  async loadCompactRange(size) {
    // For now, start with an empty range and rebuild
    // TODO: Optimize by loading existing subtree hashes from tiles
    return CompactRange.empty(0n);
  }

  getTreeSize() {
    const row = this.ctx.storage.sql
      .exec('SELECT size FROM tree_state WHERE id = 1')
      .one();
    return row.size;
  }

  /**
   * Updates tree size and root hash
   * @param {number} size - New tree size
   * @param {Uint8Array} rootHash - New root hash
   */
  setTreeState(size, rootHash) {
    this.ctx.storage.sql.exec(
      'UPDATE tree_state SET size = ?, root_hash = ? WHERE id = 1',
      size,
      rootHash
    );
  }

  /**
   * Gets the current root hash
   * @returns {Uint8Array|null} Root hash or null if tree is empty
   */
  getRootHash() {
    const row = this.ctx.storage.sql
      .exec('SELECT root_hash FROM tree_state WHERE id = 1')
      .one();
    // SQLite returns ArrayBuffer, convert to Uint8Array
    const hash = row.root_hash;
    if (!hash || hash.byteLength === 0) {
      return null;
    }
    return hash instanceof Uint8Array ? hash : new Uint8Array(hash);
  }

  /**
   * Adds an entry to the log
   * @param {number} idx - Entry index
   * @param {Uint8Array} data - Entry data
   * @param {Uint8Array} hash - Leaf hash
   */
  addEntry(idx, data, hash) {
    this.ctx.storage.sql.exec(
      'INSERT INTO entries (idx, data, leaf_hash) VALUES (?, ?, ?)',
      idx,
      data,
      hash
    );
  }

  /**
   * Gets an entry by index
   * @param {number} idx - Entry index
   * @returns {{data: Uint8Array, leaf_hash: Uint8Array}|null}
   */
  getEntry(idx) {
    const cursor = this.ctx.storage.sql.exec(
      'SELECT data, leaf_hash FROM entries WHERE idx = ?',
      idx
    );
    const row = cursor.toArray()[0];
    return row || null;
  }

  /**
   * Gets entries in a range (for entry bundles)
   * @param {number} startIdx - Start index (inclusive)
   * @param {number} endIdx - End index (exclusive)
   * @returns {Array<{idx: number, data: Uint8Array, leaf_hash: Uint8Array}>}
   */
  getEntryRange(startIdx, endIdx) {
    const cursor = this.ctx.storage.sql.exec(
      'SELECT idx, data, leaf_hash FROM entries WHERE idx >= ? AND idx < ? ORDER BY idx',
      startIdx,
      endIdx
    );
    return cursor.toArray();
  }

  /**
   * Saves a tile
   * @param {number} level - Tile level
   * @param {number} tileIndex - Tile index
   * @param {Uint8Array} data - Tile data (concatenated hashes)
   */
  setTile(level, tileIndex, data) {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO tiles (level, tile_index, data) VALUES (?, ?, ?)',
      level,
      tileIndex,
      data
    );
  }

  /**
   * Gets a tile
   * @param {number} level - Tile level
   * @param {number} tileIndex - Tile index
   * @returns {Uint8Array|null} Tile data or null if not found
   */
  getTile(level, tileIndex) {
    const cursor = this.ctx.storage.sql.exec(
      'SELECT data FROM tiles WHERE level = ? AND tile_index = ?',
      level,
      tileIndex
    );
    const row = cursor.toArray()[0];
    return row ? row.data : null;
  }
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Parses a tile index from a path component
 * e.g., "000" -> 0, "x001/234" -> 1234, "x001/x234/067" -> 1234067
 * @param {string} path - The path component
 * @returns {number|null} The parsed index or null if invalid
 */
function parseTileIndex(path) {
  // Remove any partial suffix like ".p/8"
  const cleanPath = path.replace(/\.p\/\d+$/, '');

  const parts = cleanPath.split('/');
  let result = 0;

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];

    // All parts except the last should have 'x' prefix
    if (i < parts.length - 1) {
      if (!part.startsWith('x')) return null;
      part = part.slice(1);
    } else {
      // Last part should NOT have 'x' prefix
      if (part.startsWith('x')) return null;
    }

    // Each part should be exactly 3 digits
    if (!/^\d{3}$/.test(part)) return null;

    const num = parseInt(part, 10);
    if (num >= 1000) return null;

    result = result * 1000 + num;
  }

  return result;
}
