# Tessera JavaScript/TypeScript Implementation

A complete JavaScript/TypeScript port of [Tessera](https://github.com/transparency-dev/tessera) - a tile-based transparency log library implementing the [tlog-tiles API specification](https://c2sp.org/tlog-tiles).

## Overview

Tessera is a library for building tile-based transparency logs (tlogs). It is the production-ready successor to Trillian v1, introducing modern best practices learned from a decade of transparency ecosystem operation.

### Key Features

- **Tile-based logging** - Implements the C2SP tlog-tiles API for immutable, cacheable log tiles
- **Multiple storage backends** - Support for cloud and on-premises deployments
- **Low operational complexity** - Library-first approach for custom "personalities"
- **Certificate Transparency support** - RFC 6962 compliant leaf hashing
- **Witness protocol** - C2SP witness protocol for checkpoint countersigning
- **OpenTelemetry observability** - Built-in tracing and metrics

---

## Architecture Overview

Tessera follows a **three-phase pipeline architecture**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          TESSERA PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌─────────────────┐    ┌─────────────────┐             │
│  │  Entry   │───▶│   SEQUENCING    │───▶│   INTEGRATION   │             │
│  │  Queue   │    │   (Batching)    │    │  (Merkle Tree)  │             │
│  └──────────┘    └─────────────────┘    └────────┬────────┘             │
│       ▲                                          │                       │
│       │                                          ▼                       │
│  ┌────┴─────┐                          ┌─────────────────┐              │
│  │  Client  │                          │   PUBLISHING    │              │
│  │   Add    │                          │  (Checkpoints)  │              │
│  └──────────┘                          └────────┬────────┘              │
│                                                  │                       │
│                                                  ▼                       │
│                                         ┌─────────────────┐             │
│                                         │   WITNESSES     │             │
│                                         │ (Countersign)   │             │
│                                         └─────────────────┘             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: Sequencing
- Entries buffered in memory with configurable batch parameters
- When batch is full OR timeout occurs, entries get durable sequential indices
- Enables high-throughput ingestion with controlled batching

### Phase 2: Integration
- Sequenced entries merged into the Merkle tree structure
- Produces new tiles and subtrees as entries are integrated
- Uses RFC 6962 (Certificate Transparency) compliant hashing

### Phase 3: Publishing
- Periodic creation and signing of checkpoints
- Contacts configured witnesses for countersignatures
- Only publishes if witness policy is satisfied

---

## Implementation Roadmap

### Phase 1: Core Foundation (Priority: Critical)

#### 1.1 Project Setup
- [ ] Initialize npm/pnpm workspace with TypeScript
- [ ] Configure ESLint, Prettier, and TypeScript strict mode
- [ ] Set up Jest/Vitest for testing
- [ ] Configure build system (tsup/esbuild)
- [ ] Set up CI/CD pipeline

#### 1.2 Core Data Structures (`src/core/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `entry.ts` | Entry structure with leaf data, identity hash, merkle hash, index | `entry.go` |
| `index.ts` | Sequence index with dedup flag | `entry.go` |
| `checkpoint.ts` | Tree size, root hash, signatures, witness countersigns | `api/state.go` |
| `tile.ts` | HashTile (merkle nodes) and EntryBundle structures | `api/layout/tile.go` |

#### 1.3 Cryptography (`src/crypto/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `hasher.ts` | RFC 6962 compliant SHA-256 leaf/node hashing | `transparency-dev/merkle` |
| `signer.ts` | Ed25519 signing for checkpoints | `golang.org/x/mod/sumdb/note` |
| `verifier.ts` | Signature verification | `golang.org/x/mod/sumdb/note` |

#### 1.4 API Layout (`src/api/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `paths.ts` | tlog-tiles API path generation | `api/layout/paths.go` |
| `tile-coords.ts` | Tile coordinate calculations (level, index, width) | `storage/internal/tileid.go` |
| `marshal.ts` | Entry/tile serialization (BigEndian uint16 length prefix) | `api/layout/tile.go` |

---

### Phase 2: Merkle Tree Implementation (Priority: Critical)

#### 2.1 Compact Merkle Tree (`src/merkle/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `compact-range.ts` | Compact representation of tree ranges | `transparency-dev/merkle/compact` |
| `tree-builder.ts` | Incremental tree construction | `storage/internal/integrate.go` |
| `proof.ts` | Inclusion and consistency proof generation | `transparency-dev/merkle/proof` |

#### 2.2 Integration Logic (`src/integration/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `integrate.ts` | Merkle tree integration algorithm | `storage/internal/integrate.go` |
| `tile-writer.ts` | Write tiles to storage backend | `storage/internal/integrate.go` |

**Key Algorithm: Tree Integration**
```typescript
// Pseudocode for the integration algorithm
async function integrate(
  fromSize: bigint,
  entries: Entry[],
  getTiles: TileReader,
  writeTiles: TileWriter
): Promise<IntegrationResult> {
  // 1. Load existing compact range from tiles
  // 2. Append new entries to the range
  // 3. Calculate new tile hashes
  // 4. Write updated tiles to storage
  // 5. Return new tree size and root hash
}
```

---

### Phase 3: Storage Abstraction (Priority: High)

#### 3.1 Storage Interfaces (`src/storage/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `driver.ts` | Storage driver interface definition | `log.go` |
| `reader.ts` | LogReader interface (ReadCheckpoint, ReadTile, ReadEntryBundle) | `lifecycle.go` |
| `writer.ts` | Storage write operations | `append_lifecycle.go` |

#### 3.2 Storage Internal (`src/storage/internal/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `queue.ts` | Entry batching queue with timeout/size triggers | `storage/internal/queue.go` |
| `tile-id.ts` | Tile coordinate types and helpers | `storage/internal/tileid.go` |

**Queue Configuration:**
```typescript
interface QueueOptions {
  maxBatchSize: number;    // Default: 256
  maxBatchAge: number;     // Default: 250ms
  maxPushback: number;     // Default: 4096 outstanding entries
}
```

---

### Phase 4: Lifecycle Implementation (Priority: High)

#### 4.1 Appender Lifecycle (`src/lifecycle/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `appender.ts` | Main Appender class with Add function | `append_lifecycle.go` |
| `sequencer.ts` | Entry sequencing logic | `append_lifecycle.go` |
| `publisher.ts` | Checkpoint publishing with intervals | `append_lifecycle.go` |

**Appender Options:**
```typescript
interface AppenderOptions {
  // Batching
  batchMaxSize?: number;        // Default: 256
  batchMaxAge?: number;         // Default: 250ms

  // Publishing
  checkpointInterval?: number;  // Default: 10s
  republishInterval?: number;   // Default: 10min

  // Pushback
  maxOutstanding?: number;      // Default: 4096
}
```

#### 4.2 Migration Lifecycle (`src/lifecycle/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `migration-target.ts` | Target lifecycle for log migrations | `migrate_lifecycle.go` |
| `migrate.ts` | Entry bundle copying utilities | `migrate.go` |

---

### Phase 5: Witness Protocol (Priority: Medium)

#### 5.1 Witness Implementation (`src/witness/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `policy.ts` | Witness policy parsing (Sigsum format) | `witness.go` |
| `group.ts` | WitnessGroup with N-of-M quorum | `witness.go` |
| `client.ts` | C2SP witness protocol client | `internal/witness/` |

**Policy Format (Sigsum):**
```
# Example witness policy
witness1+key1@url1
witness2+key2@url2
-- 2 of 2 --
```

---

### Phase 6: Antispam / Deduplication (Priority: Medium)

#### 6.1 Antispam Implementation (`src/antispam/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `memory.ts` | In-memory LRU cache (default 256KB) | `antispam.go` |
| `persistent.ts` | Interface for persistent dedup storage | `lifecycle.go` |
| `decorator.ts` | Decorator pattern for Add function | `antispam.go` |

---

### Phase 7: Client Library (Priority: Medium)

#### 7.1 Verification Client (`src/client/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `client.ts` | Log verification, inclusion/consistency proofs | `client/client.go` |
| `fetcher.ts` | HTTP fetcher for remote logs | `client/fetcher.go` |
| `stream.ts` | Streaming entry verification | `client/stream.go` |

---

### Phase 8: Storage Backends (Priority: Varies)

#### 8.1 Filesystem Storage (`src/storage/posix/`) - Priority: High
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `files.ts` | Filesystem storage driver | `storage/posix/files.go` |
| `file-ops.ts` | Atomic file operations | `storage/posix/file_ops.go` |

#### 8.2 MySQL Storage (`src/storage/mysql/`) - Priority: Medium
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `mysql.ts` | MySQL storage driver | `storage/mysql/mysql.go` |

#### 8.3 AWS Storage (`src/storage/aws/`) - Priority: Low
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `s3.ts` | S3 object storage | `storage/aws/aws.go` |
| `mysql-coord.ts` | MySQL coordination layer | `storage/aws/aws.go` |

#### 8.4 GCP Storage (`src/storage/gcp/`) - Priority: Low
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `gcs.ts` | Google Cloud Storage | `storage/gcp/gcp.go` |
| `spanner.ts` | Cloud Spanner coordination | `storage/gcp/gcp.go` |

---

### Phase 9: Certificate Transparency Support (Priority: Low)

#### 9.1 CT-specific Features (`src/ct/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `entry.ts` | CT entry encoding/decoding | `ct_only.go` |
| `layout.ts` | Static CT API layout | `ct_only.go` |

---

### Phase 10: Observability (Priority: Low)

#### 10.1 OpenTelemetry Integration (`src/otel/`)
| Module | Description | Go Reference |
|--------|-------------|--------------|
| `tracer.ts` | Distributed tracing | `otel.go` |
| `metrics.ts` | Metrics (counters, histograms, gauges) | `otel.go` |

**Key Metrics:**
- `add_calls_total` - Total add operations
- `add_duration_seconds` - Add operation latency histogram
- `integrate_latency_seconds` - Integration latency
- `witness_latency_seconds` - Witness response time

---

## Package Structure

```
js/
├── package.json
├── tsconfig.json
├── README.md
│
├── src/
│   ├── index.ts                    # Main exports
│   │
│   ├── core/                       # Core data structures
│   │   ├── entry.ts
│   │   ├── index.ts
│   │   ├── checkpoint.ts
│   │   └── tile.ts
│   │
│   ├── crypto/                     # Cryptographic operations
│   │   ├── hasher.ts               # RFC 6962 SHA-256
│   │   ├── signer.ts               # Ed25519 signing
│   │   └── verifier.ts
│   │
│   ├── api/                        # tlog-tiles API
│   │   ├── paths.ts                # Path generation
│   │   ├── tile-coords.ts          # Coordinate math
│   │   └── marshal.ts              # Serialization
│   │
│   ├── merkle/                     # Merkle tree operations
│   │   ├── compact-range.ts
│   │   ├── tree-builder.ts
│   │   └── proof.ts
│   │
│   ├── integration/                # Tree integration
│   │   ├── integrate.ts
│   │   └── tile-writer.ts
│   │
│   ├── storage/                    # Storage abstraction
│   │   ├── driver.ts               # Driver interface
│   │   ├── reader.ts               # LogReader interface
│   │   ├── writer.ts
│   │   │
│   │   ├── internal/               # Shared internals
│   │   │   ├── queue.ts
│   │   │   └── tile-id.ts
│   │   │
│   │   ├── posix/                  # Filesystem backend
│   │   │   ├── files.ts
│   │   │   └── file-ops.ts
│   │   │
│   │   ├── mysql/                  # MySQL backend
│   │   │   └── mysql.ts
│   │   │
│   │   ├── aws/                    # AWS backend
│   │   │   ├── s3.ts
│   │   │   └── mysql-coord.ts
│   │   │
│   │   └── gcp/                    # GCP backend
│   │       ├── gcs.ts
│   │       └── spanner.ts
│   │
│   ├── lifecycle/                  # Lifecycles
│   │   ├── appender.ts
│   │   ├── sequencer.ts
│   │   ├── publisher.ts
│   │   └── migration-target.ts
│   │
│   ├── witness/                    # Witness protocol
│   │   ├── policy.ts
│   │   ├── group.ts
│   │   └── client.ts
│   │
│   ├── antispam/                   # Deduplication
│   │   ├── memory.ts
│   │   ├── persistent.ts
│   │   └── decorator.ts
│   │
│   ├── client/                     # Verification client
│   │   ├── client.ts
│   │   ├── fetcher.ts
│   │   └── stream.ts
│   │
│   ├── ct/                         # CT support
│   │   ├── entry.ts
│   │   └── layout.ts
│   │
│   └── otel/                       # Observability
│       ├── tracer.ts
│       └── metrics.ts
│
├── examples/                       # Example personalities
│   ├── posix-server/
│   ├── mysql-server/
│   └── simple-log/
│
└── test/                           # Test suites
    ├── unit/
    ├── integration/
    └── conformance/
```

---

## Dependencies

### Runtime Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `@noble/hashes` | SHA-256 hashing | Fast, audited crypto |
| `@noble/ed25519` | Ed25519 signatures | For checkpoint signing |
| `lru-cache` | In-memory LRU cache | Antispam layer |
| `p-queue` | Promise queue | Batching control |

### Storage Backend Dependencies

| Package | Purpose | Backend |
|---------|---------|---------|
| `mysql2` | MySQL client | MySQL, AWS |
| `@google-cloud/storage` | GCS client | GCP |
| `@google-cloud/spanner` | Spanner client | GCP |
| `@aws-sdk/client-s3` | S3 client | AWS |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type system |
| `tsup` | Build/bundle |
| `vitest` | Testing |
| `eslint` | Linting |
| `prettier` | Formatting |

---

## Key Algorithms

### 1. RFC 6962 Leaf Hash
```typescript
function leafHash(data: Uint8Array): Uint8Array {
  const hasher = sha256.create();
  hasher.update(new Uint8Array([0x00])); // Leaf prefix
  hasher.update(data);
  return hasher.digest();
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const hasher = sha256.create();
  hasher.update(new Uint8Array([0x01])); // Node prefix
  hasher.update(left);
  hasher.update(right);
  return hasher.digest();
}
```

### 2. Tile Coordinate Calculation
```typescript
// Tiles are 256 entries (2^8) high
const TILE_HEIGHT = 8n;

function tileCoords(level: number, index: bigint, treeSize: bigint): TileID {
  const tileIndex = index >> TILE_HEIGHT;
  const width = calculateTileWidth(level, tileIndex, treeSize);
  return { level, index: tileIndex, width };
}
```

### 3. Entry Bundle Marshaling
```typescript
function marshalEntryBundle(entries: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    // BigEndian uint16 length prefix
    const len = new Uint8Array(2);
    new DataView(len.buffer).setUint16(0, entry.length, false);
    chunks.push(len, entry);
  }
  return concat(chunks);
}
```

---

## Testing Strategy

### Unit Tests
- Core data structure serialization
- Cryptographic operations (hash, sign, verify)
- Tile coordinate calculations
- Merkle tree operations

### Integration Tests
- Full pipeline: add → sequence → integrate → publish
- Storage backend operations
- Checkpoint signing and verification

### Conformance Tests
- tlog-tiles API compliance
- RFC 6962 compatibility
- Interoperability with Go implementation

---

## Configuration Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `batchMaxSize` | 256 | Max entries per batch |
| `batchMaxAge` | 250ms | Max time before batch flush |
| `maxOutstanding` | 4096 | Max pending entries (pushback) |
| `checkpointInterval` | 10s | Checkpoint publish frequency |
| `republishInterval` | 10min | Checkpoint re-sign frequency |
| `antispamCacheSize` | 256KB | In-memory dedup cache |
| `witnessTimeout` | 5s | Witness response timeout |
| `tileHeight` | 8 | Entries per tile level (2^8 = 256) |

---

## API Example

```typescript
import { Tessera, PosixStorage } from '@tessera/js';

// Initialize storage
const storage = new PosixStorage({
  path: './log-data',
  checkpoint: './checkpoint'
});

// Create appender
const appender = await Tessera.newAppender(storage, {
  signer: myEd25519Signer,
  batchMaxSize: 256,
  checkpointInterval: 10_000, // 10s
});

// Add entries
const index = await appender.add(new TextEncoder().encode('my log entry'));
console.log(`Entry assigned index: ${index}`);

// Wait for publication
await appender.awaitPublication(index);

// Read checkpoint
const checkpoint = await storage.readCheckpoint();
console.log(`Tree size: ${checkpoint.size}, Root: ${checkpoint.rootHash}`);
```

---

## Milestone Timeline

| Phase | Components | Priority |
|-------|------------|----------|
| **M1** | Core + Crypto + API Layout | Critical |
| **M2** | Merkle Tree + Integration | Critical |
| **M3** | Storage Abstraction + Queue | High |
| **M4** | Appender Lifecycle | High |
| **M5** | POSIX Storage Backend | High |
| **M6** | Witness Protocol | Medium |
| **M7** | Client Library | Medium |
| **M8** | MySQL Backend | Medium |
| **M9** | AWS/GCP Backends | Low |
| **M10** | CT Support + Observability | Low |

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
- [Trillian Concepts](https://github.com/google/trillian)
