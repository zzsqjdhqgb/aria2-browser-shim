export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(prefix: string): Logger {
  return {
    debug(...args: unknown[]): void {
      console.debug(prefix, ...args);
    },
    info(...args: unknown[]): void {
      console.info(prefix, ...args);
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...args);
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...args);
    },
  };
}
