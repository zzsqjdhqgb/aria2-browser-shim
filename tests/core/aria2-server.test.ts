import { describe, it, expect } from 'vitest';
import { Aria2Server } from '../../src/core/aria2-server';

function echo(params: unknown[]): Promise<unknown> {
  return Promise.resolve(params[0]);
}

function throwError(): Promise<unknown> {
  return Promise.reject({ code: 42, message: 'test error' });
}

describe('Aria2Server', () => {
  const methods = {
    'aria2.echo': echo,
    'aria2.throwError': throwError,
  };

  describe('handleRequest', () => {
    it('handles single request', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req1',
        result: 'hello',
      });
    });

    it('handles notification (no id)', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toBeNull();
    });

    it('handles batch requests', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest([
        { jsonrpc: '2.0', id: 'req1', method: 'aria2.echo', params: ['a'] },
        { jsonrpc: '2.0', id: 'req2', method: 'aria2.echo', params: ['b'] },
      ]);
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty('result', 'a');
        expect(result[1]).toHaveProperty('result', 'b');
      }
    });

    it('handles batch with mixed errors', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest([
        { jsonrpc: '2.0', id: 'req1', method: 'aria2.echo', params: ['ok'] },
        { jsonrpc: '2.0', id: 'req2', method: 'aria2.throwError', params: [] },
      ]);
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result[0]).toHaveProperty('result', 'ok');
        expect(result[1]).toHaveProperty('error');
        expect(result[1].error).toEqual({ code: 42, message: 'test error' });
      }
    });

    it('returns parse error for invalid body', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest(42);
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    });

    it('returns parse error for invalid JSON string', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest('not json');
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    });

    it('returns method not found', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'nonexistent',
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32601 },
      });
    });

    it('validates jsonrpc version', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '1.0',
        id: 'req1',
        method: 'aria2.echo',
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32600 },
      });
    });

    it('handles token authentication with correct token', async () => {
      const server = new Aria2Server(methods, { token: 'secret' });
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['token:secret', 'hello'],
      });
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req1',
        result: 'hello',
      });
    });

    it('rejects wrong token', async () => {
      const server = new Aria2Server(methods, { token: 'secret' });
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['token:wrong', 'hello'],
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32600 },
      });
    });

    it('rejects missing token when token is required', async () => {
      const server = new Aria2Server(methods, { token: 'secret' });
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32600 },
      });
    });

    it('allows requests without token when no token is configured', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req1',
        result: 'hello',
      });
    });

    it('handles null id', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: null,
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toBeNull();
    });
  });
});
