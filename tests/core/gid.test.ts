import { describe, it, expect } from 'vitest';
import { generateGid, toHexGid, parseGid } from '@/core/gid';

describe('gid', () => {
  describe('generateGid', () => {
    it('returns a 16-char lowercase hex string', () => {
      const gid = generateGid();
      expect(gid).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces unique values', () => {
      const gids = new Set(Array.from({ length: 100 }, () => generateGid()));
      expect(gids.size).toBe(100);
    });
  });

  describe('toHexGid', () => {
    it('converts number to 16-char hex', () => {
      expect(toHexGid(0)).toBe('0000000000000000');
      expect(toHexGid(255)).toBe('00000000000000ff');
    });
  });

  describe('parseGid', () => {
    it('parses hex gid to number', () => {
      expect(parseGid('00000000000000ff')).toBe(255);
      expect(parseGid('0000000000000000')).toBe(0);
    });
  });
});
