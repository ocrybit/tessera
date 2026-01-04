import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Tessera Worker', () => {
  it('responds with Hello from Tessera! (unit style)', async () => {
    const request = new Request('http://example.com/');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toBe('Hello from Tessera!');
  });

  it('responds with Hello from Tessera! (integration style)', async () => {
    const response = await SELF.fetch('http://example.com/');
    expect(await response.text()).toBe('Hello from Tessera!');
  });

  it('returns 404 for unknown paths', async () => {
    const response = await SELF.fetch('http://example.com/unknown');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
});

describe('Tessera Durable Object', () => {
  it('has TESSERA binding available', () => {
    expect(env.TESSERA).toBeDefined();
  });

  it('can get DO stub', async () => {
    const id = env.TESSERA.idFromName('test-log');
    const stub = env.TESSERA.get(id);
    expect(stub).toBeDefined();
  });

  it('can fetch from DO directly', async () => {
    const id = env.TESSERA.idFromName('test-log');
    const stub = env.TESSERA.get(id);
    const response = await stub.fetch('http://do/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from Tessera!');
  });
});
