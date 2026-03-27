import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:unsupported]";

/**
 * aria2.addTorrent
 *
 * Cannot be implemented: browsers cannot create TCP/UDP listeners
 * for DHT/P2P connections required by BitTorrent.
 */
export async function addTorrent(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} addTorrent called — not supported`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported(
            "BitTorrent downloads are not supported. " +
            "Browser extensions cannot establish P2P connections. " +
            "Please use the real aria2 client for torrent downloads."
        ),
    };
}

/**
 * aria2.addMetalink
 *
 * Cannot be meaningfully implemented: Metalink files describe complex
 * multi-source/multi-file downloads with chunk verification, which
 * the browser download API cannot handle.
 */
export async function addMetalink(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} addMetalink called — not supported`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported(
            "Metalink downloads are not supported. " +
            "Please parse the Metalink file and use addUri for individual HTTP URLs."
        ),
    };
}

/**
 * aria2.getPeers
 *
 * Only applicable to BitTorrent, which we don't support.
 */
export async function getPeers(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} getPeers called — not supported (no P2P)`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported("getPeers is only applicable to BitTorrent downloads"),
    };
}

/**
 * aria2.changeUri
 *
 * aria2 can reconfigure per-file mirror lists at runtime.
 * Browser downloads API has no equivalent concept once download is created.
 */
export async function changeUri(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} changeUri called — not supported`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported(
            "changeUri is not supported. Browser downloads cannot update URI mirror lists " +
            "for an existing download task."
        ),
    };
}