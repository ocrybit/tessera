import { describe, it, expect } from 'vitest';
import { leafHash, nodeHash } from '../src/crypto.js';

describe('crypto', () => {
  describe('leafHash', () => {
    it('computes RFC 6962 leaf hash with 0x00 prefix', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await leafHash(data);

      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('produces different hashes for different data', async () => {
      const hash1 = await leafHash(new TextEncoder().encode('hello'));
      const hash2 = await leafHash(new TextEncoder().encode('world'));

      expect(hash1).not.toEqual(hash2);
    });

    it('produces consistent hash for same data', async () => {
      const data = new TextEncoder().encode('test');
      const hash1 = await leafHash(data);
      const hash2 = await leafHash(data);

      expect(hash1).toEqual(hash2);
    });

    it('matches known computation for empty data', async () => {
      const hash = await leafHash(new Uint8Array(0));
      const expected = await crypto.subtle.digest('SHA-256', new Uint8Array([0x00]));

      expect(hash).toEqual(new Uint8Array(expected));
    });
  });

  describe('nodeHash', () => {
    it('computes RFC 6962 node hash with 0x01 prefix', async () => {
      const left = new Uint8Array(32).fill(0xaa);
      const right = new Uint8Array(32).fill(0xbb);
      const hash = await nodeHash(left, right);

      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('produces different hashes for different children', async () => {
      const a = new Uint8Array(32).fill(0x11);
      const b = new Uint8Array(32).fill(0x22);
      const c = new Uint8Array(32).fill(0x33);

      const hash1 = await nodeHash(a, b);
      const hash2 = await nodeHash(a, c);

      expect(hash1).not.toEqual(hash2);
    });

    it('is order-sensitive (not commutative)', async () => {
      const a = new Uint8Array(32).fill(0x11);
      const b = new Uint8Array(32).fill(0x22);

      const hash1 = await nodeHash(a, b);
      const hash2 = await nodeHash(b, a);

      expect(hash1).not.toEqual(hash2);
    });

    it('matches known computation', async () => {
      const left = new Uint8Array(32).fill(0);
      const right = new Uint8Array(32).fill(0);
      const hash = await nodeHash(left, right);

      const input = new Uint8Array(65);
      input[0] = 0x01;
      const expected = await crypto.subtle.digest('SHA-256', input);

      expect(hash).toEqual(new Uint8Array(expected));
    });
  });
});
