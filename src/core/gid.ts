const HEX_CHARS = '0123456789abcdef';

export function generateGid(): string {
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += HEX_CHARS[Math.floor(Math.random() * 16)];
  }
  return result;
}

export function toHexGid(num: number): string {
  return num.toString(16).padStart(16, '0');
}

export function parseGid(gid: string): number {
  return parseInt(gid, 16);
}
