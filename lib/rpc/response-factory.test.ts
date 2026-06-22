import { describe, it, expect } from 'vitest';
import {
  successResponse,
  errorResponse,
  notImplementedResponse,
  internalErrorResponse,
  notSupportedResponse,
  ErrorCode,
} from './response-factory';
import type { Aria2RpcResponse } from './types';

// ==========================================================================
// successResponse
// ==========================================================================
describe('successResponse', () => {
  it('returns a JSON-RPC success response with string id', () => {
    const result = successResponse('1', { status: 'ok' });

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      result: { status: 'ok' },
    } as Aria2RpcResponse);
  });

  it('returns a JSON-RPC success response with number id', () => {
    const result = successResponse(42, 'hello');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: 'hello',
    } as Aria2RpcResponse);
  });

  it('returns a JSON-RPC success response with null id', () => {
    const result = successResponse(null, []);

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: null,
      result: [],
    } as Aria2RpcResponse);
  });

  it('returns a JSON-RPC success response with undefined result', () => {
    const result = successResponse('1', undefined);

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      result: undefined,
    } as Aria2RpcResponse);
  });

  it('does not include an error property', () => {
    const result = successResponse('1', { data: 123 });

    expect(result).not.toHaveProperty('error');
  });
});

// ==========================================================================
// errorResponse
// ==========================================================================
describe('errorResponse', () => {
  it('returns a JSON-RPC error response with standard code', () => {
    const result = errorResponse('1', -32602, 'Invalid params');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      error: {
        code: -32602,
        message: 'Invalid params',
      },
    } as Aria2RpcResponse);
  });

  it('returns a JSON-RPC error response with null id', () => {
    const result = errorResponse(null, -32700, 'Parse error');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
      },
    } as Aria2RpcResponse);
  });

  it('returns a JSON-RPC error response with number id', () => {
    const result = errorResponse(99, -32600, 'Invalid Request');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 99,
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
    } as Aria2RpcResponse);
  });

  it('does not include a result property', () => {
    const result = errorResponse('1', -32603, 'Internal error');

    expect(result).not.toHaveProperty('result');
  });
});

// ==========================================================================
// notImplementedResponse
// ==========================================================================
describe('notImplementedResponse', () => {
  it('returns an error response with METHOD_NOT_FOUND code', () => {
    const result = notImplementedResponse('1');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      error: {
        code: ErrorCode.METHOD_NOT_FOUND,
        message: expect.any(String) as string,
      },
    } as Aria2RpcResponse);
  });

  it('uses ErrorCode.METHOD_NOT_FOUND which equals -32601', () => {
    expect(ErrorCode.METHOD_NOT_FOUND).toBe(-32601);
  });

  it('works with null id', () => {
    const result = notImplementedResponse(null);

    expect(result.id).toBeNull();
    expect(result.error!.code).toBe(ErrorCode.METHOD_NOT_FOUND);
  });
});

// ==========================================================================
// internalErrorResponse
// ==========================================================================
describe('internalErrorResponse', () => {
  it('returns an error response with INTERNAL_ERROR code from an Error instance', () => {
    const err = new Error('Something went wrong');
    const result = internalErrorResponse('1', err);

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong',
      },
    } as Aria2RpcResponse);
  });

  it('extracts message from a string error', () => {
    const result = internalErrorResponse('1', 'plain error string');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'plain error string',
      },
    } as Aria2RpcResponse);
  });

  it('extracts message from an Error subclass', () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }
    const err = new CustomError('custom failure');
    const result = internalErrorResponse(42, err);

    expect(result.error!.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.error!.message).toBe('custom failure');
    expect(result.id).toBe(42);
  });

  it('uses String() conversion for non-Error, non-string values', () => {
    const result = internalErrorResponse('1', 404);

    expect(result.error!.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.error!.message).toBe('404');
  });

  it('handles undefined error gracefully', () => {
    const result = internalErrorResponse('1', undefined);

    expect(result.error!.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(typeof result.error!.message).toBe('string');
  });

  it('handles null error gracefully', () => {
    const result = internalErrorResponse('1', null);

    expect(result.error!.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(typeof result.error!.message).toBe('string');
  });
});

// ==========================================================================
// notSupportedResponse
// ==========================================================================
describe('notSupportedResponse', () => {
  it('returns an error response with SERVER_ERROR code for a feature name', () => {
    const result = notSupportedResponse('1', 'BitTorrent');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: '1',
      error: {
        code: ErrorCode.SERVER_ERROR,
        message: 'BitTorrent is not supported — this is a browser-based aria2 emulator',
      },
    } as Aria2RpcResponse);
  });

  it('uses the exact message format from the spec', () => {
    const result = notSupportedResponse(42, 'Metalink');

    expect(result.error!.message).toBe(
      'Metalink is not supported — this is a browser-based aria2 emulator',
    );
  });

  it('works with null id', () => {
    const result = notSupportedResponse(null, 'FTP');

    expect(result.id).toBeNull();
    expect(result.error!.code).toBe(ErrorCode.SERVER_ERROR);
  });

  it('handles multi-word feature names', () => {
    const result = notSupportedResponse('1', 'HTTP/2 Push');

    expect(result.error!.message).toBe(
      'HTTP/2 Push is not supported — this is a browser-based aria2 emulator',
    );
  });
});

// ==========================================================================
// ErrorCode constants
// ==========================================================================
describe('ErrorCode', () => {
  it('defines PARSE_ERROR as -32700', () => {
    expect(ErrorCode.PARSE_ERROR).toBe(-32700);
  });

  it('defines INVALID_REQUEST as -32600', () => {
    expect(ErrorCode.INVALID_REQUEST).toBe(-32600);
  });

  it('defines METHOD_NOT_FOUND as -32601', () => {
    expect(ErrorCode.METHOD_NOT_FOUND).toBe(-32601);
  });

  it('defines INVALID_PARAMS as -32602', () => {
    expect(ErrorCode.INVALID_PARAMS).toBe(-32602);
  });

  it('defines INTERNAL_ERROR as -32603', () => {
    expect(ErrorCode.INTERNAL_ERROR).toBe(-32603);
  });

  it('defines SERVER_ERROR as -32000', () => {
    expect(ErrorCode.SERVER_ERROR).toBe(-32000);
  });
});
