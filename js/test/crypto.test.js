import { describe, it, expect } from 'vitest';
import { leafHash, nodeHash } from '../src/crypto.js';

describe('crypto', () => {
  describe('leafHash', () => {
    it('should compute RFC 6962 leaf hash with 0x00 prefix', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await leafHash(data);

      // Leaf hash = SHA256(0x00 || data)
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('should produce different hashes for different data', async () => {
      const hash1 = await leafHash(new TextEncoder().encode('hello'));
      const hash2 = await leafHash(new TextEncoder().encode('world'));

      expect(hash1).not.toEqual(hash2);
    });

    it('should produce consistent hash for same data', async () => {
      const data = new TextEncoder().encode('test');
      const hash1 = await leafHash(data);
      const hash2 = await leafHash(data);

      expect(hash1).toEqual(hash2);
    });

    it('should match known RFC 6962 test vector', async () => {
      // Empty leaf: SHA256(0x00) = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855... with prefix
      // Actually for empty data: SHA256(0x00)
      const hash = await leafHash(new Uint8Array(0));
      expect(hash.length).toBe(32);

      // Verify it's SHA256 of just the 0x00 prefix byte
      const expected = await crypto.subtle.digest('SHA-256', new Uint8Array([0x00]));
      expect(hash).toEqual(new Uint8Array(expected));
    });
  });

  describe('nodeHash', () => {
    it('should compute RFC 6962 node hash with 0x01 prefix', async () => {
      const left = new Uint8Array(32).fill(0xaa);
      const right = new Uint8Array(32).fill(0xbb);
      const hash = await nodeHash(left, right);

      // Node hash = SHA256(0x01 || left || right)
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('should produce different hashes for different children', async () => {
      const a = new Uint8Array(32).fill(0x11);
      const b = new Uint8Array(32).fill(0x22);
      const c = new Uint8Array(32).fill(0x33);

      const hash1 = await nodeHash(a, b);
      const hash2 = await nodeHash(a, c);

      expect(hash1).not.toEqual(hash2);
    });

    it('should be order-sensitive (not commutative)', async () => {
      const a = new Uint8Array(32).fill(0x11);
      const b = new Uint8Array(32).fill(0x22);

      const hash1 = await nodeHash(a, b);
      const hash2 = await nodeHash(b, a);

      expect(hash1).not.toEqual(hash2);
    });

    it('should match known computation', async () => {
      const left = new Uint8Array(32).fill(0);
      const right = new Uint8Array(32).fill(0);

      const hash = await nodeHash(left, right);

      // Verify: SHA256(0x01 || 32 zero bytes || 32 zero bytes)
      const input = new Uint8Array(65);
      input[0] = 0x01;
      const expected = await crypto.subtle.digest('SHA-256', input);

      expect(hash).toEqual(new Uint8Array(expected));
    });
  });
});
