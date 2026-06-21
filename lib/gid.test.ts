import { describe, it, expect } from 'vitest';
import { encodeGid, decodeGid, generateSalt, PLACEHOLDER_BROWSER_ID, EXTENSION_PREFIX } from './gid';

describe('encodeGid', () => {
  it('encodes GID with prefix "48", salt "a1b2c3", browserId 45', () => {
    const result = encodeGid('48', 'a1b2c3', 45);
    expect(result).toBe('48a1b2c30000002d');
    expect(result.length).toBe(16);
  });

  it('zero-pads browserId when 0', () => {
    const result = encodeGid('48', 'ffffff', 0);
    expect(result).toBe('48ffffff00000000');
  });

  it('handles large browserId (2147483647)', () => {
    const result = encodeGid('48', '000000', 2147483647);
    expect(result).toBe('480000007fffffff');
  });
});

describe('decodeGid', () => {
  it('decodes a valid GID correctly', () => {
    const result = decodeGid('48a1b2c30000002d');
    expect(result).toEqual({ prefix: '48', salt: 'a1b2c3', browserId: 45 });
  });

  it('returns null for 15-char string (wrong length)', () => {
    const result = decodeGid('48a1b2c30000002');
    expect(result).toBeNull();
  });

  it('returns null for 17-char string (wrong length)', () => {
    const result = decodeGid('48a1b2c30000002dd');
    expect(result).toBeNull();
  });

  it('returns null for string with non-hex characters', () => {
    const result = decodeGid('48a1b2c30000002g');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = decodeGid('');
    expect(result).toBeNull();
  });

  it('decodes GID with uppercase hex characters correctly', () => {
    // The brief test for non-hex uses 'g' which is non-hex.
    // Uppercase hex chars like 'A' are still valid hex and should be preserved.
    const result = decodeGid('48A1B2C30000002D');
    expect(result).toEqual({ prefix: '48', salt: 'A1B2C3', browserId: 45 });
  });
});

describe('round-trip', () => {
  it('round-trips browserId 1 with random salt', () => {
    const salt = generateSalt();
    const gid = encodeGid('48', salt, 1);
    const decoded = decodeGid(gid);
    expect(decoded).toEqual({ prefix: '48', salt, browserId: 1 });
  });

  it('round-trips browserId 99999 with random salt', () => {
    const salt = generateSalt();
    const gid = encodeGid('48', salt, 99999);
    const decoded = decodeGid(gid);
    expect(decoded).toEqual({ prefix: '48', salt, browserId: 99999 });
  });

  it('round-trips browserId 0 with random salt', () => {
    const salt = generateSalt();
    const gid = encodeGid('48', salt, 0);
    const decoded = decodeGid(gid);
    expect(decoded).toEqual({ prefix: '48', salt, browserId: 0 });
  });
});

describe('generateSalt', () => {
  it('returns 6-character hex string', () => {
    for (let i = 0; i < 50; i++) {
      const salt = generateSalt();
      expect(salt).toHaveLength(6);
      expect(salt).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it('produces unique values across 100 calls', () => {
    const salts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      salts.add(generateSalt());
    }
    // With 16^6 = ~16.7M possible values, 100 should yield no collisions
    // (statistically, collision probability is ~0.0003%)
    expect(salts.size).toBe(100);
  });
});

describe('constants', () => {
  it('PLACEHOLDER_BROWSER_ID is 0', () => {
    expect(PLACEHOLDER_BROWSER_ID).toBe(0);
  });

  it('EXTENSION_PREFIX is "48"', () => {
    expect(EXTENSION_PREFIX).toBe('48');
  });
});
