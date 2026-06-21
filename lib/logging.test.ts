import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, type Logger } from './logging';

describe('createLogger', () => {
  it('returns an object with debug, info, warn, error methods', () => {
    const logger = createLogger('[Test]');
    expect(logger).toHaveProperty('debug');
    expect(logger).toHaveProperty('info');
    expect(logger).toHaveProperty('warn');
    expect(logger).toHaveProperty('error');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

describe('Logger', () => {
  let logger: Logger;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = createLogger('[App]');
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('debug', () => {
    it('calls console.debug with prefix prepended', () => {
      logger.debug('message');
      expect(debugSpy).toHaveBeenCalledWith('[App]', 'message');
    });

    it('supports multiple arguments', () => {
      logger.debug('msg', 123, { key: 'val' });
      expect(debugSpy).toHaveBeenCalledWith('[App]', 'msg', 123, { key: 'val' });
    });

    it('works with empty string message', () => {
      logger.debug('');
      expect(debugSpy).toHaveBeenCalledWith('[App]', '');
    });
  });

  describe('info', () => {
    it('calls console.info with prefix prepended', () => {
      logger.info('started');
      expect(infoSpy).toHaveBeenCalledWith('[App]', 'started');
    });

    it('supports multiple arguments', () => {
      logger.info('status', 200, { ok: true });
      expect(infoSpy).toHaveBeenCalledWith('[App]', 'status', 200, { ok: true });
    });
  });

  describe('warn', () => {
    it('calls console.warn with prefix prepended', () => {
      logger.warn('low memory');
      expect(warnSpy).toHaveBeenCalledWith('[App]', 'low memory');
    });

    it('supports multiple arguments', () => {
      logger.warn('retry', 3, { max: 5 });
      expect(warnSpy).toHaveBeenCalledWith('[App]', 'retry', 3, { max: 5 });
    });
  });

  describe('error', () => {
    it('calls console.error with prefix prepended', () => {
      logger.error('failed');
      expect(errorSpy).toHaveBeenCalledWith('[App]', 'failed');
    });

    it('supports Error objects as arguments', () => {
      const err = new Error('boom');
      logger.error('caught', err);
      expect(errorSpy).toHaveBeenCalledWith('[App]', 'caught', err);
    });

    it('supports multiple arguments', () => {
      logger.error('operation failed', 500, { detail: 'timeout' });
      expect(errorSpy).toHaveBeenCalledWith('[App]', 'operation failed', 500, { detail: 'timeout' });
    });
  });
});

describe('createLogger with different prefixes', () => {
  it('uses the provided prefix for debug', () => {
    const dbg = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const dlLogger = createLogger('[DL]');
    dlLogger.debug('download start');
    expect(dbg).toHaveBeenCalledWith('[DL]', 'download start');
    dbg.mockRestore();
  });

  it('uses the provided prefix for info', () => {
    const inf = vi.spyOn(console, 'info').mockImplementation(() => {});
    const rpcLogger = createLogger('[RPC]');
    rpcLogger.info('call received');
    expect(inf).toHaveBeenCalledWith('[RPC]', 'call received');
    inf.mockRestore();
  });

  it('uses the provided prefix for warn', () => {
    const wrn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wsLogger = createLogger('[WS]');
    wsLogger.warn('reconnecting');
    expect(wrn).toHaveBeenCalledWith('[WS]', 'reconnecting');
    wrn.mockRestore();
  });

  it('uses the provided prefix for error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbLogger = createLogger('[DB]');
    dbLogger.error('connection lost');
    expect(err).toHaveBeenCalledWith('[DB]', 'connection lost');
    err.mockRestore();
  });

  it('creates independent loggers that do not share state', () => {
    const dbg1 = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const loggerA = createLogger('[A]');
    const loggerB = createLogger('[B]');
    loggerA.debug('msg-a');
    expect(dbg1).toHaveBeenCalledWith('[A]', 'msg-a');
    dbg1.mockClear();
    loggerB.debug('msg-b');
    expect(dbg1).toHaveBeenCalledWith('[B]', 'msg-b');
    dbg1.mockRestore();
  });
});

describe('Logger interface type guard', () => {
  it('is assignable to the Logger interface', () => {
    const loggers: Logger[] = [
      createLogger('[One]'),
      createLogger('[two]'),
      createLogger('[3]'),
    ];
    expect(loggers).toHaveLength(3);
    expect(loggers.every((l) => typeof l.debug === 'function')).toBe(true);
    expect(loggers.every((l) => typeof l.info === 'function')).toBe(true);
    expect(loggers.every((l) => typeof l.warn === 'function')).toBe(true);
    expect(loggers.every((l) => typeof l.error === 'function')).toBe(true);
  });
});
