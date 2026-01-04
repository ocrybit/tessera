import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';

const PORT = 8787;
const BASE_URL = `http://localhost:${PORT}`;

let wranglerProcess;

beforeAll(async () => {
  // Start wrangler dev server
  wranglerProcess = spawn('npx', ['wrangler', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Wrangler dev server failed to start within 30s'));
    }, 30000);

    wranglerProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Ready on')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    wranglerProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // Wrangler outputs to stderr for some messages
      if (output.includes('Ready on')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    wranglerProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    wranglerProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Wrangler exited with code ${code}`));
      }
    });
  });
}, 60000);

afterAll(async () => {
  if (wranglerProcess) {
    wranglerProcess.kill('SIGTERM');
    // Wait for process to exit
    await new Promise((resolve) => {
      wranglerProcess.on('exit', resolve);
      setTimeout(resolve, 2000);
    });
  }
});

describe('Tessera Server', () => {
  it('should return hello message on root path', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe('Hello from Tessera!');
  });

  it('should return 404 for unknown paths', async () => {
    const response = await fetch(`${BASE_URL}/unknown`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
});
