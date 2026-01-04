import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('Tessera Durable Object', () => {
  describe('hello world', () => {
    it('should return hello message on root path', async () => {
      const response = await SELF.fetch('https://example.com/');
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toBe('Hello from Tessera!');
    });

    it('should return 404 for unknown paths', async () => {
      const response = await SELF.fetch('https://example.com/unknown');

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not Found');
    });
  });

  describe('Durable Object binding', () => {
    it('should have TESSERA binding available', () => {
      expect(env.TESSERA).toBeDefined();
    });

    it('should be able to get DO stub', async () => {
      const id = env.TESSERA.idFromName('test-log');
      const stub = env.TESSERA.get(id);

      expect(stub).toBeDefined();
    });

    it('should be able to fetch from DO directly', async () => {
      const id = env.TESSERA.idFromName('test-log');
      const stub = env.TESSERA.get(id);

      const response = await stub.fetch('https://do/');
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toBe('Hello from Tessera!');
    });
  });
});
