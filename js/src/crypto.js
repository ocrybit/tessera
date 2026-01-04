/**
 * RFC 6962 compliant hashing for Certificate Transparency
 * Uses Web Crypto API (available in Cloudflare Workers)
 */

/**
 * Compute RFC 6962 leaf hash
 * @param {Uint8Array} data - Leaf data
 * @returns {Promise<Uint8Array>} 32-byte SHA-256 hash
 */
export async function leafHash(data) {
  const prefixed = new Uint8Array(1 + data.length);
  prefixed[0] = 0x00; // Leaf prefix
  prefixed.set(data, 1);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
}

/**
 * Compute RFC 6962 node hash
 * @param {Uint8Array} left - Left child hash (32 bytes)
 * @param {Uint8Array} right - Right child hash (32 bytes)
 * @returns {Promise<Uint8Array>} 32-byte SHA-256 hash
 */
export async function nodeHash(left, right) {
  const prefixed = new Uint8Array(65);
  prefixed[0] = 0x01; // Node prefix
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
}
