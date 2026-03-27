import type { DownloadStatus } from "@/core/types";
import type { Aria2Status } from "./types";

/**
 * Maps internal DownloadStatus to Aria2 status string
 */
export function toAria2Status(status: DownloadStatus): Aria2Status {
    switch (status) {
        case "pending":
            return "waiting";
        case "in_progress":
            return "active";
        case "paused":
            return "paused";
        case "complete":
            return "complete";
        case "error":
            return "error";
        case "cancelled":
            return "removed";
        default:
            return "error";
    }
}

/**
 * Aria2 error codes mapped from our error strings
 * @see https://aria2.github.io/manual/en/html/aria2c.html#exit-status
 */
export function toAria2ErrorCode(error?: string): string {
    if (!error) return "0";

    const lower = error.toLowerCase();

    if (lower.includes("timeout")) return "2"; // timeout
    if (lower.includes("not found") || lower.includes("404")) return "3"; // resource not found
    if (
        lower.includes("unauthorized") ||
        lower.includes("forbidden") ||
        lower.includes("401") ||
        lower.includes("403")
    ) {
        return "24"; // HTTP authorization failed
    }
    if (lower.includes("dns") || lower.includes("resolve")) return "19"; // name resolution failed
    if (lower.includes("network") || lower.includes("connection")) return "6"; // network problem
    if (lower.includes("interrupted")) return "1"; // unknown error / interrupted
    if (lower.includes("cancelled")) return "1"; // removed by user maps to generic non-success code

    return "1"; // generic unknown error
}