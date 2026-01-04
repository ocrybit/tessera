import { DurableObject } from 'cloudflare:workers';
import { leafHash } from './crypto.js';

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

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        idx INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        leaf_hash BLOB NOT NULL
      )
    `);

    // Initialize tree_state if not exists
    this.ctx.storage.sql.exec(`
      INSERT OR IGNORE INTO tree_state (id, size) VALUES (1, 0)
    `);
  }

  async fetch(request) {
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

    return new Response('Not Found', { status: 404 });
  }

  getTreeSize() {
    const row = this.ctx.storage.sql
      .exec('SELECT size FROM tree_state WHERE id = 1')
      .one();
    return row.size;
  }
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
