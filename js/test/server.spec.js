import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
let wranglerProcess;

async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('Server failed to start');
}

describe('Tessera', () => {
  before(async () => {
    wranglerProcess = spawn('npx', ['wrangler', 'dev'], {
      stdio: 'pipe',
      detached: false,
    });

    wranglerProcess.stderr.on('data', data => {
      if (process.env.DEBUG) console.error(data.toString());
    });

    await waitForServer(BASE_URL);
  });

  after(() => {
    if (wranglerProcess) {
      wranglerProcess.kill();
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
      assert.strictEqual(json.size, 0);
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
      assert.strictEqual(json.hash.length, 64); // hex string
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
