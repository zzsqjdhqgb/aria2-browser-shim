const GID_LENGTH = 16;
const BROWSER_ID_LENGTH = 8;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

export const PLACEHOLDER_BROWSER_ID = 0;
export const EXTENSION_PREFIX = '48';

export function generateSalt(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function encodeGid(prefix: string, salt: string, browserId: number): string {
  const hexId = browserId.toString(16).padStart(BROWSER_ID_LENGTH, '0');
  return `${prefix}${salt}${hexId}`;
}

interface DecodedGid {
  prefix: string;
  salt: string;
  browserId: number;
}

export function decodeGid(gid: string): DecodedGid | null {
  if (gid.length !== GID_LENGTH) {
    return null;
  }
  if (!HEX_PATTERN.test(gid)) {
    return null;
  }
  const prefix = gid.slice(0, 2);
  const salt = gid.slice(2, 8);
  const browserIdHex = gid.slice(8, 16);
  const browserId = parseInt(browserIdHex, 16);
  return { prefix, salt, browserId };
}
