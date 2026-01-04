# Tessera JavaScript Implementation

A pure JavaScript implementation of [Tessera](https://github.com/transparency-dev/tessera) for Cloudflare Durable Objects.

**Target:** Single Durable Object with SQLite

## Architecture

```
Client → Worker → Durable Object (SQLite)
```

That's it. One DO handles everything:
- Entry sequencing and batching
- Merkle tree integration
- Checkpoint publishing (via Alarm API)
- Serving tiles and entries

## Why This Works

| DO Feature | What It Solves |
|------------|----------------|
| Single-threaded | No coordination needed |
| Built-in SQLite | All storage in one place |
| Alarm API | Scheduled checkpoint publishing |
| Global routing | Requests route to the same DO |

---

## Implementation Roadmap

### Phase 1: Project Setup

```bash
js/
├── package.json
├── wrangler.toml
├── src/
│   ├── index.js          # Worker + DO exports
│   ├── tessera.js        # Main DO class
│   ├── crypto.js         # RFC 6962 hashing (Web Crypto)
│   ├── merkle.js         # Tree building + proofs
│   ├── tiles.js          # Tile coords + marshaling
│   └── checkpoint.js     # Checkpoint format + signing
└── test/
```

### Phase 2: Core Crypto (`src/crypto.js`)

```javascript
// RFC 6962 hashing - Web Crypto, no dependencies
export async function leafHash(data) {
  const prefixed = new Uint8Array(1 + data.length);
  prefixed[0] = 0x00;
  prefixed.set(data, 1);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
}

export async function nodeHash(left, right) {
  const prefixed = new Uint8Array(65);
  prefixed[0] = 0x01;
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
}
```

### Phase 3: Tile Math (`src/tiles.js`)

```javascript
export const TILE_HEIGHT = 8n;  // 2^8 = 256 entries per tile

export function tileIndex(index) {
  return index >> TILE_HEIGHT;
}

export function tilePath(level, index, width) {
  const p = width < 256 ? `.p/${width}` : '';
  return `tile/${level}/${index}${p}`;
}

export function entryBundlePath(index) {
  const n = index >> TILE_HEIGHT;
  return `tile/entries/${n}`;
}
```

### Phase 4: SQLite Schema

```sql
-- Tree state
CREATE TABLE tree_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  size INTEGER NOT NULL DEFAULT 0,
  root_hash BLOB
);

-- Entries (sequenced)
CREATE TABLE entries (
  idx INTEGER PRIMARY KEY,
  data BLOB NOT NULL,
  leaf_hash BLOB NOT NULL
);

-- Merkle tiles
CREATE TABLE tiles (
  level INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  hashes BLOB NOT NULL,
  PRIMARY KEY (level, idx)
);

-- Entry bundles
CREATE TABLE entry_bundles (
  idx INTEGER PRIMARY KEY,
  data BLOB NOT NULL
);

-- Checkpoints
CREATE TABLE checkpoints (
  size INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);
```

### Phase 5: Merkle Tree (`src/merkle.js`)

```javascript
// Compact range for incremental tree building
export class CompactRange {
  constructor(size, hashes) {
    this.size = size;
    this.hashes = hashes; // Right-edge hashes
  }

  async append(leafHash) {
    // Add leaf, compute new internal nodes
  }

  rootHash() {
    // Fold hashes to get root
  }
}

// Integration: entries → tree updates
export async function integrate(storage, entries) {
  // 1. Get current tree state
  // 2. Append entries to compact range
  // 3. Write new/updated tiles
  // 4. Update tree state
}
```

### Phase 6: Durable Object (`src/tessera.js`)

```javascript
export class Tessera {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.queue = [];

    state.blockConcurrencyWhile(() => this.init());
  }

  async init() {
    // Create tables if not exist
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ...`);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/add') {
      return this.add(request);
    }
    if (url.pathname === '/checkpoint') {
      return this.getCheckpoint();
    }
    if (url.pathname.startsWith('/tile/')) {
      return this.getTile(url.pathname);
    }

    return new Response('Not Found', { status: 404 });
  }

  async add(request) {
    const data = new Uint8Array(await request.arrayBuffer());
    const leaf = await leafHash(data);

    // Get next index
    const { size } = this.sql.exec('SELECT size FROM tree_state WHERE id = 1').one()
      ?? { size: 0 };
    const index = BigInt(size);

    // Store entry
    this.sql.exec('INSERT INTO entries (idx, data, leaf_hash) VALUES (?, ?, ?)',
      [Number(index), data, leaf]);

    // Integrate into tree
    await integrate(this.sql, [{ index, data, leaf }]);

    return Response.json({ index: index.toString() });
  }

  async alarm() {
    // Publish checkpoint
    await this.publishCheckpoint();

    // Schedule next
    this.state.storage.setAlarm(Date.now() + 10_000);
  }
}
```

### Phase 7: Worker (`src/index.js`)

```javascript
export { Tessera } from './tessera.js';

export default {
  async fetch(request, env) {
    const id = env.TESSERA.idFromName('log');
    const stub = env.TESSERA.get(id);
    return stub.fetch(request);
  }
};
```

### Phase 8: Wrangler Config

```toml
name = "tessera"
main = "src/index.js"
compatibility_date = "2024-12-01"

[[durable_objects.bindings]]
name = "TESSERA"
class_name = "Tessera"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Tessera"]
```

---

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/add` | POST | Add entry, returns `{ index }` |
| `/checkpoint` | GET | Get latest checkpoint |
| `/tile/{level}/{index}` | GET | Get hash tile |
| `/tile/{level}/{index}.p/{width}` | GET | Get partial tile |
| `/tile/entries/{n}` | GET | Get entry bundle |

---

## Roadmap Summary

| Phase | What | Files |
|-------|------|-------|
| 1 | Project setup | `package.json`, `wrangler.toml` |
| 2 | Crypto | `src/crypto.js` |
| 3 | Tile math | `src/tiles.js` |
| 4 | SQLite schema | (in `tessera.js`) |
| 5 | Merkle tree | `src/merkle.js` |
| 6 | Durable Object | `src/tessera.js` |
| 7 | Worker | `src/index.js` |
| 8 | Config | `wrangler.toml` |

**Optional later:**
- Checkpoint signing (Ed25519)
- Witness protocol
- Inclusion/consistency proofs
- Batching queue optimization

---

## Dependencies

**Runtime:** None (Web Crypto + native fetch)

**Dev:**
- `wrangler` - Cloudflare CLI
- `vitest` - Testing

---

## References

- [tlog-tiles API](https://c2sp.org/tlog-tiles)
- [RFC 6962](https://datatracker.ietf.org/doc/html/rfc6962)
- [Cloudflare DO SQLite](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
