import type { DownloadRequest } from "@/core/types";

const LOG_PREFIX = "[ParamUtils]";

/**
 * Strip optional "token:xxx" prefix from params array.
 * Aria2 RPC calls optionally pass a secret token as the first parameter.
 */
export function stripToken(params: unknown[]): unknown[] {
    if (
        params.length > 0 &&
        typeof params[0] === "string" &&
        (params[0] as string).startsWith("token:")
    ) {
        return params.slice(1);
    }
    return params;
}

/**
 * Parse aria2.addUri parameters into a DownloadRequest.
 *
 * aria2.addUri([secret], uris, [options], [position])
 *   - uris:    string[]  — list of HTTP/HTTPS URIs (we only use the first)
 *   - options: object    — { dir, out, header, referer, ... }
 *   - position: number   — insertion position (ignored in shim)
 *
 * @returns DownloadRequest or null if params are invalid
 */
export function parseAddUriParams(params: unknown[]): DownloadRequest | null {
    const uris = params[0] as string[] | undefined;
    if (!Array.isArray(uris) || uris.length === 0) {
        console.warn(`${LOG_PREFIX} addUri: no URIs provided`);
        return null;
    }

    // Validate that the first URI is a valid HTTP(S) URL
    const primaryUri = uris[0];
    try {
        const parsed = new URL(primaryUri);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            console.warn(`${LOG_PREFIX} addUri: unsupported protocol ${parsed.protocol}`);
            return null;
        }
    } catch {
        console.warn(`${LOG_PREFIX} addUri: invalid URL "${primaryUri}"`);
        return null;
    }

    const options = (params[1] as Record<string, unknown>) ?? {};
    const headers: Record<string, string> = {};

    // aria2 sends headers as string array: ["Cookie: xxx", "Referer: yyy"]
    const headerList = options.header as string[] | undefined;
    if (Array.isArray(headerList)) {
        for (const h of headerList) {
            const colonIdx = h.indexOf(":");
            if (colonIdx > 0) {
                const key = h.slice(0, colonIdx).trim();
                const value = h.slice(colonIdx + 1).trim();
                if (key && value) {
                    headers[key] = value;
                }
            }
        }
    }

    // aria2 also supports a top-level "referer" option
    if (typeof options.referer === "string" && options.referer && !headers["Referer"]) {
        headers["Referer"] = options.referer;
    }

    // "user-agent" option
    if (typeof options["user-agent"] === "string" && options["user-agent"] && !headers["User-Agent"]) {
        headers["User-Agent"] = options["user-agent"];
    }

    const result: DownloadRequest = {
        url: primaryUri,
        filename: typeof options.out === "string" ? options.out : undefined,
        directory: typeof options.dir === "string" ? options.dir : undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
    };

    return result;
}

/**
 * Extract option values from aria2 option object.
 * Returns a cleaned Record with only the options we actually support.
 */
export function parseOptions(raw: Record<string, unknown>): Record<string, string> {
    const supported: Record<string, string> = {};

    const stringKeys = [
        "dir", "out", "referer", "user-agent",
        "max-connection-per-server", "split", "min-split-size",
        "max-download-limit",
    ];

    for (const key of stringKeys) {
        if (typeof raw[key] === "string") {
            supported[key] = raw[key] as string;
        }
    }

    // header is an array, store as JSON
    if (Array.isArray(raw.header)) {
        supported["header"] = JSON.stringify(raw.header);
    }

    return supported;
}

/**
 * Filter an object to only include specified keys.
 * Used for tellStatus key filtering.
 */
export function filterKeys<T extends Record<string, unknown>>(
    obj: T,
    keys?: string[]
): Partial<T> {
    if (!keys || keys.length === 0) return obj;

    const filtered: Record<string, unknown> = {};
    for (const key of keys) {
        if (key in obj) {
            filtered[key] = obj[key];
        }
    }
    return filtered as Partial<T>;
}

/**
 * Parse an optional RPC keys parameter.
 *
 * - undefined => undefined
 * - string[]  => string[]
 * - otherwise => null (invalid)
 */
export function parseOptionalStringArray(
    value: unknown
): string[] | undefined | null {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return null;
    if (!value.every((item) => typeof item === "string")) return null;
    return value as string[];
}