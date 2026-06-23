import { describe, it, expect } from 'vitest';
import { parseHeaderArray, headersToArray } from '@/core/headers';

describe('headers', () => {
  describe('parseHeaderArray', () => {
    it('parses Cookie header', () => {
      const result = parseHeaderArray(['Cookie: session=abc123']);
      expect(result).toEqual({ Cookie: 'session=abc123' });
    });

    it('parses multiple headers', () => {
      const result = parseHeaderArray([
        'Cookie: session=abc123',
        'Referer: https://example.com',
        'User-Agent: Mozilla/5.0',
      ]);
      expect(result).toEqual({
        Cookie: 'session=abc123',
        Referer: 'https://example.com',
        'User-Agent': 'Mozilla/5.0',
      });
    });

    it('handles empty array', () => {
      expect(parseHeaderArray([])).toEqual({});
      expect(parseHeaderArray(undefined as unknown as string[])).toEqual({});
    });

    it('skips malformed headers', () => {
      const result = parseHeaderArray(['NotAHeader', 'Cookie: x=1']);
      expect(result).toEqual({ Cookie: 'x=1' });
    });
  });

  describe('headersToArray', () => {
    it('converts headers record to DNR header operations', () => {
      const result = headersToArray({ Cookie: 'x=1', Referer: 'https://e.com' });
      expect(result).toEqual([
        { header: 'Cookie', operation: 'set', value: 'x=1' },
        { header: 'Referer', operation: 'set', value: 'https://e.com' },
      ]);
    });
  });
});
