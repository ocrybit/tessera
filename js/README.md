# Tessera JavaScript Implementation

A pure JavaScript implementation of [Tessera](https://github.com/transparency-dev/tessera) - a tile-based transparency log library implementing the [tlog-tiles API specification](https://c2sp.org/tlog-tiles).

**Target Environment:** Cloudflare Durable Objects with SQLite

## Overview

Tessera is a library for building tile-based transparency logs (tlogs). This JavaScript implementation is designed specifically for Cloudflare's edge computing platform, leveraging Durable Objects for coordination and SQLite for persistent storage.

### Key Features

- **Pure JavaScript** - No TypeScript, uses JSDoc for type hints
- **Cloudflare Durable Objects** - Single-threaded coordination with global consistency
- **SQLite Storage** - Uses DO's built-in SQLite for entries, tiles, and tree state
- **Edge-native** - Designed for Cloudflare Workers runtime
- **tlog-tiles API** - Full C2SP specification compliance
- **RFC 6962 Compatible** - Certificate Transparency compliant hashing

### Why Cloudflare Durable Objects?

Durable Objects provide unique advantages for transparency logs:

| Feature | Benefit for Tessera |
|---------|---------------------|
| **Single-threaded execution** | No coordination complexity - one DO handles all writes |
| **Built-in SQLite** | Transactional storage for entries, tiles, and tree state |
| **Global consistency** | Strong consistency guarantees across regions |
| **Hibernation** | Cost-effective - only pay when processing requests |
| **WebSocket support** | Real-time checkpoint notifications |
| **Alarm API** | Scheduled checkpoint publishing |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TESSERA ON CLOUDFLARE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐         ┌─────────────────────────────────────────┐   │
│  │  Cloudflare      │         │        DURABLE OBJECT                   │   │
│  │  Worker          │────────▶│  ┌─────────────────────────────────┐    │   │
│  │  (Router)        │         │  │         Tessera Log             │    │   │
│  └──────────────────┘         │  │                                 │    │   │
│           │                   │  │  ┌───────────┐  ┌───────────┐   │    │   │
│           │                   │  │  │  Sequencer│─▶│ Integrator│   │    │   │
│           ▼                   │  │  └───────────┘  └─────┬─────┘   │    │   │
│  ┌──────────────────┐         │  │                       │         │    │   │
│  │  R2 Bucket       │◀────────│  │  ┌───────────┐        │         │    │   │
│  │  (Tile Cache)    │         │  │  │ Publisher │◀───────┘         │    │   │
│  └──────────────────┘         │  │  └─────┬─────┘                  │    │   │
│                               │  │        │                        │    │   │
│                               │  │        ▼                        │    │   │
│                               │  │  ┌───────────┐                  │    │   │
│                               │  │  │  SQLite   │                  │    │   │
│                               │  │  │  Storage  │                  │    │   │
│                               │  │  └───────────┘                  │    │   │
│                               │  └─────────────────────────────────┘    │   │
│                               └─────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Worker** | Routes requests, serves cached tiles from R2, forwards writes to DO |
| **Durable Object** | Single writer, handles sequencing/integration/publishing |
| **SQLite** | Stores entries, tiles, tree state, checkpoints (inside DO) |
| **R2 Bucket** | Optional tile cache for read scalability |
| **Alarms** | Triggers periodic checkpoint publishing |

---

## Implementation Roadmap

### Phase 1: Core Foundation (Priority: Critical)

#### 1.1 Project Setup
- [ ] Initialize npm workspace with ESM modules
- [ ] Configure ESLint and Prettier for JavaScript
- [ ] Set up Vitest for testing (Workers-compatible)
- [ ] Configure Wrangler for Cloudflare deployment
- [ ] Set up Miniflare for local development

#### 1.2 Core Data Structures (`src/core/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `entry.js` | Entry structure with leaf data, identity hash, merkle hash, index | `entry.go` |
| `checkpoint.js` | Tree size, root hash, signatures, witness countersigns | `api/state.go` |
| `tile.js` | HashTile (merkle nodes) and EntryBundle structures | `api/layout/tile.go` |

```javascript
/**
 * @typedef {Object} Entry
 * @property {Uint8Array} data - Raw entry data
 * @property {Uint8Array} identityHash - SHA-256 of data (for dedup)
 * @property {Uint8Array} leafHash - RFC 6962 leaf hash
 * @property {bigint} index - Assigned sequence number
 */

/**
 * @typedef {Object} Checkpoint
 * @property {bigint} size - Tree size
 * @property {Uint8Array} rootHash - Merkle root (32 bytes)
 * @property {string} signature - Base64 encoded signature
 * @property {string[]} witnesses - Witness countersignatures
 */
```

#### 1.3 Cryptography (`src/crypto/`)
| Module | Description | Notes |
|--------|-------------|-------|
| `hasher.js` | RFC 6962 compliant SHA-256 leaf/node hashing | Uses Web Crypto API |
| `signer.js` | Ed25519 signing for checkpoints | Uses Web Crypto API |
| `verifier.js` | Signature verification | Uses Web Crypto API |

**Web Crypto Advantage:** Cloudflare Workers have native Web Crypto API - no external dependencies needed!

```javascript
// RFC 6962 leaf hash using Web Crypto
async function leafHash(data) {
  const prefixed = new Uint8Array(1 + data.length);
  prefixed[0] = 0x00; // Leaf prefix
  prefixed.set(data, 1);
  const hash = await crypto.subtle.digest('SHA-256', prefixed);
  return new Uint8Array(hash);
}

// RFC 6962 node hash
async function nodeHash(left, right) {
  const prefixed = new Uint8Array(1 + 32 + 32);
  prefixed[0] = 0x01; // Node prefix
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  const hash = await crypto.subtle.digest('SHA-256', prefixed);
  return new Uint8Array(hash);
}
```

#### 1.4 API Layout (`src/api/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `paths.js` | tlog-tiles API path generation | `api/layout/paths.go` |
| `tile-coords.js` | Tile coordinate calculations (level, index, width) | `storage/internal/tileid.go` |
| `marshal.js` | Entry/tile serialization (BigEndian uint16 length prefix) | `api/layout/tile.go` |

---

### Phase 2: Merkle Tree Implementation (Priority: Critical)

#### 2.1 Compact Merkle Tree (`src/merkle/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `compact-range.js` | Compact representation of tree ranges | `transparency-dev/merkle/compact` |
| `tree-builder.js` | Incremental tree construction | `storage/internal/integrate.go` |
| `proof.js` | Inclusion and consistency proof generation | `transparency-dev/merkle/proof` |

#### 2.2 Integration Logic (`src/integration/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `integrate.js` | Merkle tree integration algorithm | `storage/internal/integrate.go` |
| `tile-writer.js` | Write tiles to SQLite storage | `storage/internal/integrate.go` |

```javascript
/**
 * Integrate new entries into the Merkle tree
 * @param {bigint} fromSize - Current tree size
 * @param {Entry[]} entries - New entries to integrate
 * @param {SQLiteStorage} storage - DO SQLite storage
 * @returns {Promise<{size: bigint, rootHash: Uint8Array, tiles: Map}>}
 */
async function integrate(fromSize, entries, storage) {
  // 1. Load existing compact range from SQLite
  // 2. Append new entries to the range
  // 3. Calculate new tile hashes
  // 4. Write updated tiles to SQLite in transaction
  // 5. Return new tree size and root hash
}
```

---

### Phase 3: SQLite Storage Layer (Priority: Critical)

#### 3.1 Database Schema (`src/storage/schema.js`)

```sql
-- Tree state (single row)
CREATE TABLE IF NOT EXISTS tree_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  size INTEGER NOT NULL DEFAULT 0,
  root_hash BLOB
);

-- Sequenced entries
CREATE TABLE IF NOT EXISTS entries (
  idx INTEGER PRIMARY KEY,
  data BLOB NOT NULL,
  identity_hash BLOB NOT NULL,
  leaf_hash BLOB NOT NULL
);

-- Merkle tree tiles (hash tiles)
CREATE TABLE IF NOT EXISTS tiles (
  level INTEGER NOT NULL,
  tile_index INTEGER NOT NULL,
  width INTEGER NOT NULL,
  hashes BLOB NOT NULL,
  PRIMARY KEY (level, tile_index)
);

-- Entry bundles (for serving)
CREATE TABLE IF NOT EXISTS entry_bundles (
  bundle_index INTEGER PRIMARY KEY,
  data BLOB NOT NULL
);

-- Published checkpoints
CREATE TABLE IF NOT EXISTS checkpoints (
  size INTEGER PRIMARY KEY,
  checkpoint_text TEXT NOT NULL,
  published_at INTEGER NOT NULL
);

-- Antispam deduplication index
CREATE TABLE IF NOT EXISTS antispam (
  identity_hash BLOB PRIMARY KEY,
  entry_index INTEGER NOT NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_entries_identity ON entries(identity_hash);
CREATE INDEX IF NOT EXISTS idx_checkpoints_published ON checkpoints(published_at);
```

#### 3.2 Storage Interface (`src/storage/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `sqlite.js` | SQLite storage driver for DO | `storage/mysql/mysql.go` |
| `reader.js` | LogReader interface implementation | `lifecycle.go` |
| `writer.js` | Atomic write operations with transactions | `append_lifecycle.go` |

```javascript
/**
 * SQLite storage for Durable Objects
 */
export class SQLiteStorage {
  /** @param {DurableObjectStorage} storage */
  constructor(storage) {
    this.sql = storage.sql;
  }

  async getTreeState() {
    const row = this.sql.exec('SELECT size, root_hash FROM tree_state WHERE id = 1').one();
    return row ? { size: BigInt(row.size), rootHash: row.root_hash } : null;
  }

  async setTreeState(size, rootHash) {
    this.sql.exec(
      'INSERT OR REPLACE INTO tree_state (id, size, root_hash) VALUES (1, ?, ?)',
      [Number(size), rootHash]
    );
  }

  async appendEntry(index, entry) {
    this.sql.exec(
      'INSERT INTO entries (idx, data, identity_hash, leaf_hash) VALUES (?, ?, ?, ?)',
      [Number(index), entry.data, entry.identityHash, entry.leafHash]
    );
  }

  // ... more methods
}
```

---

### Phase 4: Durable Object Implementation (Priority: Critical)

#### 4.1 Main Durable Object (`src/do/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `tessera-log.js` | Main DO class with request handling | `append_lifecycle.go` |
| `sequencer.js` | Entry sequencing with batching | `storage/internal/queue.go` |
| `publisher.js` | Checkpoint publishing with alarms | `append_lifecycle.go` |

```javascript
/**
 * Tessera Log Durable Object
 * Handles all write operations for a single transparency log
 */
export class TesseraLog {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = new SQLiteStorage(state.storage);

    // Initialize schema on first access
    this.state.blockConcurrencyWhile(async () => {
      await this.storage.initSchema();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/add':
        return this.handleAdd(request);
      case '/checkpoint':
        return this.handleGetCheckpoint();
      case '/tile':
        return this.handleGetTile(url);
      case '/entries':
        return this.handleGetEntries(url);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  async handleAdd(request) {
    const data = new Uint8Array(await request.arrayBuffer());
    const index = await this.sequencer.add(data);
    return Response.json({ index: index.toString() });
  }

  async alarm() {
    // Periodic checkpoint publishing
    await this.publisher.publishCheckpoint();

    // Schedule next alarm
    await this.state.storage.setAlarm(Date.now() + 10_000); // 10s
  }
}
```

#### 4.2 Batching Queue (`src/do/queue.js`)

```javascript
/**
 * Entry batching queue for efficient sequencing
 * Accumulates entries and flushes on size or timeout
 */
export class BatchQueue {
  constructor(options = {}) {
    this.maxSize = options.maxSize ?? 256;
    this.maxAge = options.maxAge ?? 250; // ms
    this.pending = [];
    this.resolvers = [];
    this.flushTimer = null;
  }

  /**
   * Add entry to queue, returns promise that resolves with index
   * @param {Uint8Array} data
   * @returns {Promise<bigint>}
   */
  async add(data) {
    return new Promise((resolve, reject) => {
      this.pending.push({ data, resolve, reject });

      if (this.pending.length >= this.maxSize) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.maxAge);
      }
    });
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.pending;
    this.pending = [];

    // Process batch...
  }
}
```

---

### Phase 5: Worker Router (Priority: High)

#### 5.1 Worker Implementation (`src/worker/`)
| Module | Description |
|--------|-------------|
| `index.js` | Main worker entry point, routes requests |
| `router.js` | Request routing logic |
| `cache.js` | R2 tile caching layer |

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve tiles from R2 cache if available
    if (url.pathname.startsWith('/tile/')) {
      const cached = await env.TILE_BUCKET.get(url.pathname);
      if (cached) {
        return new Response(cached.body, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
    }

    // Forward to Durable Object
    const logId = env.TESSERA_LOG.idFromName('default');
    const log = env.TESSERA_LOG.get(logId);
    return log.fetch(request);
  }
};
```

---

### Phase 6: Witness Protocol (Priority: Medium)

#### 6.1 Witness Implementation (`src/witness/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `policy.js` | Witness policy parsing (Sigsum format) | `witness.go` |
| `group.js` | WitnessGroup with N-of-M quorum | `witness.go` |
| `client.js` | C2SP witness protocol client (uses fetch) | `internal/witness/` |

```javascript
/**
 * Contact witnesses for checkpoint countersigning
 * Uses native fetch - perfect for Workers
 */
export class WitnessClient {
  constructor(witnesses, options = {}) {
    this.witnesses = witnesses;
    this.timeout = options.timeout ?? 5000; // 5s
  }

  async getCountersignatures(checkpoint) {
    const requests = this.witnesses.map(async (witness) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(witness.url, {
          method: 'POST',
          body: checkpoint,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return { witness: witness.name, signature: await response.text() };
      } catch (e) {
        clearTimeout(timeoutId);
        return { witness: witness.name, error: e.message };
      }
    });

    return Promise.allSettled(requests);
  }
}
```

---

### Phase 7: Client Library (Priority: Medium)

#### 7.1 Verification Client (`src/client/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `client.js` | Log verification, inclusion/consistency proofs | `client/client.go` |
| `fetcher.js` | HTTP fetcher using native fetch | `client/fetcher.go` |
| `stream.js` | Streaming entry verification | `client/stream.go` |

```javascript
/**
 * Client for verifying transparency log entries
 * Can run in Workers, browsers, or Node.js
 */
export class TesseraClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async getCheckpoint() {
    const response = await fetch(`${this.baseUrl}/checkpoint`);
    return parseCheckpoint(await response.text());
  }

  async getInclusionProof(index, treeSize) {
    // Fetch required tiles and compute proof
  }

  async verifyInclusion(entry, index, checkpoint) {
    const proof = await this.getInclusionProof(index, checkpoint.size);
    return verifyInclusionProof(entry, index, proof, checkpoint.rootHash);
  }
}
```

---

### Phase 8: Antispam / Deduplication (Priority: Medium)

#### 8.1 Antispam Implementation (`src/antispam/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `sqlite.js` | SQLite-based persistent dedup | `storage/mysql/antispam/` |
| `decorator.js` | Decorator pattern for Add function | `antispam.go` |

```javascript
/**
 * SQLite-based antispam for Durable Objects
 * Persistent deduplication using identity hash index
 */
export class SQLiteAntispam {
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Check if entry already exists
   * @param {Uint8Array} identityHash
   * @returns {Promise<bigint|null>} Existing index or null
   */
  async check(identityHash) {
    const row = this.storage.sql.exec(
      'SELECT entry_index FROM antispam WHERE identity_hash = ?',
      [identityHash]
    ).one();
    return row ? BigInt(row.entry_index) : null;
  }

  async record(identityHash, index) {
    this.storage.sql.exec(
      'INSERT OR IGNORE INTO antispam (identity_hash, entry_index) VALUES (?, ?)',
      [identityHash, Number(index)]
    );
  }
}
```

---

### Phase 9: R2 Tile Cache (Priority: Medium)

#### 9.1 R2 Integration (`src/cache/`)
| Module | Description |
|--------|-------------|
| `r2-cache.js` | Write-through cache to R2 for tile reads |
| `invalidation.js` | Cache invalidation for partial tiles |

```javascript
/**
 * R2 tile cache for horizontal read scaling
 * Tiles are immutable once full (256 entries)
 */
export class R2TileCache {
  constructor(bucket) {
    this.bucket = bucket;
  }

  async writeTile(level, index, width, data) {
    const path = this.tilePath(level, index, width);

    // Only cache full tiles (width = 256)
    // Partial tiles may be updated
    if (width === 256) {
      await this.bucket.put(path, data, {
        httpMetadata: {
          contentType: 'application/octet-stream',
          cacheControl: 'public, max-age=31536000, immutable'
        }
      });
    }
  }

  tilePath(level, index, width) {
    if (width === 256) {
      return `tile/${level}/${index}`;
    }
    return `tile/${level}/${index}.p/${width}`;
  }
}
```

---

### Phase 10: Observability (Priority: Low)

#### 10.1 Workers Analytics (`src/observability/`)
| Module | Description |
|--------|-------------|
| `analytics.js` | Workers Analytics Engine integration |
| `logging.js` | Structured logging with `console.log` |

```javascript
/**
 * Observability using Workers Analytics Engine
 * No external dependencies needed
 */
export class TesseraAnalytics {
  constructor(env) {
    this.analytics = env.TESSERA_ANALYTICS;
  }

  recordAdd(duration, batchSize) {
    this.analytics?.writeDataPoint({
      blobs: ['add'],
      doubles: [duration, batchSize],
      indexes: ['operation']
    });
  }

  recordIntegration(duration, entriesIntegrated) {
    this.analytics?.writeDataPoint({
      blobs: ['integrate'],
      doubles: [duration, entriesIntegrated],
      indexes: ['operation']
    });
  }
}
```

---

## Package Structure

```
js/
├── package.json
├── wrangler.toml               # Cloudflare configuration
├── README.md
│
├── src/
│   ├── index.js                # Main exports
│   │
│   ├── core/                   # Core data structures
│   │   ├── entry.js
│   │   ├── checkpoint.js
│   │   └── tile.js
│   │
│   ├── crypto/                 # Cryptographic operations (Web Crypto)
│   │   ├── hasher.js           # RFC 6962 SHA-256
│   │   ├── signer.js           # Ed25519 signing
│   │   └── verifier.js
│   │
│   ├── api/                    # tlog-tiles API
│   │   ├── paths.js            # Path generation
│   │   ├── tile-coords.js      # Coordinate math
│   │   └── marshal.js          # Serialization
│   │
│   ├── merkle/                 # Merkle tree operations
│   │   ├── compact-range.js
│   │   ├── tree-builder.js
│   │   └── proof.js
│   │
│   ├── integration/            # Tree integration
│   │   ├── integrate.js
│   │   └── tile-writer.js
│   │
│   ├── storage/                # SQLite storage layer
│   │   ├── schema.js           # Database schema
│   │   ├── sqlite.js           # SQLite driver for DO
│   │   ├── reader.js           # Read operations
│   │   └── writer.js           # Write operations
│   │
│   ├── do/                     # Durable Object
│   │   ├── tessera-log.js      # Main DO class
│   │   ├── sequencer.js        # Entry sequencing
│   │   ├── queue.js            # Batching queue
│   │   └── publisher.js        # Checkpoint publishing
│   │
│   ├── worker/                 # Cloudflare Worker
│   │   ├── index.js            # Worker entry point
│   │   ├── router.js           # Request routing
│   │   └── cache.js            # R2 caching
│   │
│   ├── witness/                # Witness protocol
│   │   ├── policy.js           # Policy parsing
│   │   ├── group.js            # Witness groups
│   │   └── client.js           # HTTP client
│   │
│   ├── antispam/               # Deduplication
│   │   ├── sqlite.js           # SQLite-based
│   │   └── decorator.js
│   │
│   ├── client/                 # Verification client
│   │   ├── client.js
│   │   ├── fetcher.js
│   │   └── stream.js
│   │
│   ├── cache/                  # R2 tile cache
│   │   ├── r2-cache.js
│   │   └── invalidation.js
│   │
│   └── observability/          # Analytics
│       ├── analytics.js
│       └── logging.js
│
├── examples/                   # Example deployments
│   ├── simple-log/             # Basic transparency log
│   ├── ct-log/                 # Certificate Transparency
│   └── witness/                # Witness server
│
└── test/                       # Test suites
    ├── unit/                   # Unit tests (Vitest)
    ├── integration/            # Integration tests (Miniflare)
    └── conformance/            # Interop with Go implementation
```

---

## Cloudflare Configuration

### wrangler.toml

```toml
name = "tessera-log"
main = "src/worker/index.js"
compatibility_date = "2024-01-01"

# Durable Objects
[[durable_objects.bindings]]
name = "TESSERA_LOG"
class_name = "TesseraLog"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TesseraLog"]

# R2 Bucket for tile caching (optional)
[[r2_buckets]]
binding = "TILE_BUCKET"
bucket_name = "tessera-tiles"

# Analytics Engine (optional)
[[analytics_engine_datasets]]
binding = "TESSERA_ANALYTICS"
dataset = "tessera_metrics"

# Environment variables
[vars]
CHECKPOINT_INTERVAL = "10000"
BATCH_MAX_SIZE = "256"
BATCH_MAX_AGE = "250"
```

---

## Dependencies

### Runtime Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| None! | - | Uses Web Crypto API, native fetch |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `wrangler` | Cloudflare CLI |
| `miniflare` | Local development |
| `vitest` | Testing framework |
| `eslint` | Linting |
| `prettier` | Formatting |
| `@cloudflare/workers-types` | JSDoc type hints |

**Zero runtime dependencies!** The implementation uses only Web Platform APIs available in Cloudflare Workers.

---

## Key Algorithms

### 1. RFC 6962 Leaf Hash (Web Crypto)
```javascript
/**
 * Compute RFC 6962 leaf hash
 * @param {Uint8Array} data - Leaf data
 * @returns {Promise<Uint8Array>} 32-byte hash
 */
async function leafHash(data) {
  const prefixed = new Uint8Array(1 + data.length);
  prefixed[0] = 0x00; // Leaf prefix
  prefixed.set(data, 1);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
}

/**
 * Compute RFC 6962 node hash
 * @param {Uint8Array} left - Left child hash (32 bytes)
 * @param {Uint8Array} right - Right child hash (32 bytes)
 * @returns {Promise<Uint8Array>} 32-byte hash
 */
async function nodeHash(left, right) {
  const prefixed = new Uint8Array(65);
  prefixed[0] = 0x01; // Node prefix
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
}
```

### 2. Tile Coordinate Calculation
```javascript
// Tiles are 256 entries (2^8) high
const TILE_HEIGHT = 8n;
const TILE_SIZE = 256n;

/**
 * Calculate tile coordinates for a given tree position
 * @param {number} level - Tree level
 * @param {bigint} index - Node index at level
 * @param {bigint} treeSize - Current tree size
 * @returns {{level: number, index: bigint, width: number}}
 */
function tileCoords(level, index, treeSize) {
  const tileIndex = index >> TILE_HEIGHT;
  const width = calculateTileWidth(level, tileIndex, treeSize);
  return { level, index: tileIndex, width };
}

function calculateTileWidth(level, tileIndex, treeSize) {
  const levelSize = treeSize >> BigInt(level);
  const fullTiles = levelSize >> TILE_HEIGHT;

  if (tileIndex < fullTiles) return 256;
  if (tileIndex === fullTiles) return Number(levelSize % TILE_SIZE);
  return 0;
}
```

### 3. Entry Bundle Marshaling
```javascript
/**
 * Marshal entries into a bundle with length prefixes
 * @param {Uint8Array[]} entries
 * @returns {Uint8Array}
 */
function marshalEntryBundle(entries) {
  // Calculate total size
  let totalSize = 0;
  for (const entry of entries) {
    totalSize += 2 + entry.length; // 2-byte length prefix + data
  }

  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);
  let offset = 0;

  for (const entry of entries) {
    view.setUint16(offset, entry.length, false); // Big-endian
    result.set(entry, offset + 2);
    offset += 2 + entry.length;
  }

  return result;
}

/**
 * Unmarshal entry bundle
 * @param {Uint8Array} bundle
 * @returns {Uint8Array[]}
 */
function unmarshalEntryBundle(bundle) {
  const entries = [];
  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  let offset = 0;

  while (offset < bundle.length) {
    const len = view.getUint16(offset, false); // Big-endian
    offset += 2;
    entries.push(bundle.slice(offset, offset + len));
    offset += len;
  }

  return entries;
}
```

---

## API Example

```javascript
// Worker entry point
export { TesseraLog } from './do/tessera-log.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Get the Durable Object
    const logId = env.TESSERA_LOG.idFromName('my-log');
    const log = env.TESSERA_LOG.get(logId);

    // Add an entry
    if (request.method === 'POST' && url.pathname === '/add') {
      const data = new Uint8Array(await request.arrayBuffer());
      const response = await log.fetch(new Request('https://do/add', {
        method: 'POST',
        body: data
      }));
      return response;
    }

    // Get checkpoint
    if (url.pathname === '/checkpoint') {
      return log.fetch(new Request('https://do/checkpoint'));
    }

    // Serve tiles (with R2 cache)
    if (url.pathname.startsWith('/tile/')) {
      // Try R2 first
      const cached = await env.TILE_BUCKET.get(url.pathname);
      if (cached) {
        return new Response(cached.body, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
      // Fall back to DO
      return log.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

---

## Milestone Summary

| Phase | Components | Priority |
|-------|------------|----------|
| **M1** | Core + Crypto (Web Crypto) + API Layout | Critical |
| **M2** | Merkle Tree + Integration | Critical |
| **M3** | SQLite Storage Layer | Critical |
| **M4** | Durable Object + Sequencer + Publisher | Critical |
| **M5** | Worker Router | High |
| **M6** | Witness Protocol | Medium |
| **M7** | Client Library | Medium |
| **M8** | Antispam (SQLite) | Medium |
| **M9** | R2 Tile Cache | Medium |
| **M10** | Observability (Analytics Engine) | Low |

---

## Testing Strategy

### Unit Tests (Vitest)
- Core data structure serialization
- Cryptographic operations (mock Web Crypto)
- Tile coordinate calculations
- Merkle tree operations

### Integration Tests (Miniflare)
- Full pipeline: add -> sequence -> integrate -> publish
- SQLite storage operations
- Durable Object lifecycle

### Conformance Tests
- tlog-tiles API compliance
- RFC 6962 compatibility
- **Interoperability with Go implementation**

```bash
# Run tests
npm test

# Run with Miniflare (local DO simulation)
npm run test:integration

# Deploy to Cloudflare
npm run deploy
```

---

## Configuration Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `BATCH_MAX_SIZE` | 256 | Max entries per batch |
| `BATCH_MAX_AGE` | 250ms | Max time before batch flush |
| `CHECKPOINT_INTERVAL` | 10s | Checkpoint publish frequency (alarm) |
| `WITNESS_TIMEOUT` | 5s | Witness response timeout |
| `TILE_HEIGHT` | 8 | Entries per tile level (2^8 = 256) |

---

## Contributing

See the main [Tessera contribution guidelines](../CONTRIBUTING.md).

## License

Apache 2.0 - See [LICENSE](../LICENSE)

## References

- [tlog-tiles API Specification](https://c2sp.org/tlog-tiles)
- [C2SP Witness Protocol](https://c2sp.org/tlog-witness)
- [RFC 6962 - Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962)
- [Go Implementation](https://github.com/transparency-dev/tessera)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workers SQLite](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
