import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const PORT = 8798;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let wranglerProcess;

async function waitForServer(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes('Tessera')) {
          console.log(`Server ready after ${i + 1} attempts`);
          return true;
        }
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Server failed to start within 30 seconds');
}

describe('Tessera', () => {
  before(async () => {
    console.log('Starting wrangler dev...');

    wranglerProcess = spawn('npx', ['wrangler', 'dev', '--port', String(PORT)], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    wranglerProcess.stdout.on('data', data => {
      if (process.env.DEBUG) console.log('[stdout]', data.toString());
    });

    wranglerProcess.stderr.on('data', data => {
      if (process.env.DEBUG) console.log('[stderr]', data.toString());
    });

    wranglerProcess.on('error', err => {
      console.error('Failed to start wrangler:', err);
    });

    await waitForServer();
  });

  after(() => {
    if (wranglerProcess) {
      console.log('Stopping wrangler...');
      wranglerProcess.kill('SIGTERM');
    }
  });

  describe('Worker', () => {
    test('returns hello on root path', async () => {
      const res = await fetch(`${BASE_URL}/`);
      const text = await res.text();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(text, 'Hello from Tessera!');
    });

    test('returns 404 for unknown paths', async () => {
      const res = await fetch(`${BASE_URL}/unknown`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(await res.text(), 'Not Found');
    });
  });

  describe('SQLite', () => {
    test('returns tree size', async () => {
      const res = await fetch(`${BASE_URL}/size`);
      const json = await res.json();

      assert.strictEqual(res.status, 200);
      assert.ok(typeof json.size === 'number');
    });
  });

  describe('Log Operations', () => {
    test('adds entry and returns index', async () => {
      const res = await fetch(`${BASE_URL}/add`, {
        method: 'POST',
        body: 'test entry 1',
      });
      const json = await res.json();

      assert.strictEqual(res.status, 200);
      assert.ok(typeof json.index === 'number');
      assert.strictEqual(json.hash.length, 64);
      assert.ok(json.size > 0);
      assert.strictEqual(json.root.length, 64);
    });

    test('adds multiple entries with incrementing indices', async () => {
      const res1 = await fetch(`${BASE_URL}/add`, {
        method: 'POST',
        body: 'entry A',
      });
      const json1 = await res1.json();

      const res2 = await fetch(`${BASE_URL}/add`, {
        method: 'POST',
        body: 'entry B',
      });
      const json2 = await res2.json();

      assert.strictEqual(json2.index, json1.index + 1);
      assert.strictEqual(json2.size, json1.size + 1);
      // Root hash should change after adding new entry
      assert.notStrictEqual(json2.root, json1.root);
    });

    test('checkpoint reflects current tree state', async () => {
      // Add an entry first
      const addRes = await fetch(`${BASE_URL}/add`, {
        method: 'POST',
        body: 'checkpoint test entry',
      });
      const addJson = await addRes.json();

      // Get checkpoint
      const cpRes = await fetch(`${BASE_URL}/checkpoint`);
      const cpJson = await cpRes.json();

      assert.strictEqual(cpRes.status, 200);
      assert.strictEqual(cpJson.size, addJson.size);
      assert.strictEqual(cpJson.root, addJson.root);
    });
  });

  describe('Tile API', () => {
    test('returns 404 for non-existent tile', async () => {
      const res = await fetch(`${BASE_URL}/tile/0/999`);
      assert.strictEqual(res.status, 404);
    });

    test('returns 404 for non-existent entry bundle', async () => {
      const res = await fetch(`${BASE_URL}/tile/entries/999`);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('Crypto', () => {
    test('computes leaf hash', async () => {
      const res = await fetch(`${BASE_URL}/hash/leaf`, {
        method: 'POST',
        body: 'hello',
      });
      const json = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(json.hash.length, 64);
    });

    test('leaf hash is consistent', async () => {
      const res1 = await fetch(`${BASE_URL}/hash/leaf`, {
        method: 'POST',
        body: 'test',
      });
      const res2 = await fetch(`${BASE_URL}/hash/leaf`, {
        method: 'POST',
        body: 'test',
      });

      const json1 = await res1.json();
      const json2 = await res2.json();

      assert.strictEqual(json1.hash, json2.hash);
    });

    test('different data produces different hashes', async () => {
      const res1 = await fetch(`${BASE_URL}/hash/leaf`, {
        method: 'POST',
        body: 'hello',
      });
      const res2 = await fetch(`${BASE_URL}/hash/leaf`, {
        method: 'POST',
        body: 'world',
      });

      const json1 = await res1.json();
      const json2 = await res2.json();

      assert.notStrictEqual(json1.hash, json2.hash);
    });
  });
});
