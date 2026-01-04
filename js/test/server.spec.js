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

describe('Tessera Server', () => {
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

  test('returns tree size', async () => {
    const res = await fetch(`${BASE_URL}/size`);
    const json = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.size, 0);
  });
});
