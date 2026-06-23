export function parseHeaderArray(headers: string[] | undefined): Record<string, string> {
  if (!headers || !Array.isArray(headers)) return {};
  const result: Record<string, string> = {};
  for (const h of headers) {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) continue;
    const key = h.slice(0, colonIdx).trim();
    const value = h.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function headersToArray(
  headers: Record<string, string>
): Array<{ header: string; operation: string; value: string }> {
  return Object.entries(headers).map(([header, value]) => ({
    header,
    operation: 'set' as const,
    value,
  }));
}
