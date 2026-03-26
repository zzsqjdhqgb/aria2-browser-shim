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

    if (lower.includes("timeout")) return "7";       // timed out
    if (lower.includes("not found") || lower.includes("404")) return "3"; // resource not found
    if (lower.includes("unauthorized") || lower.includes("403")) return "6"; // authorization failed
    if (lower.includes("network") || lower.includes("dns")) return "19"; // DNS resolve failed / network
    if (lower.includes("interrupted")) return "1";   // unknown error / interrupted
    if (lower.includes("cancelled")) return "0";     // user cancelled (not an error per se)

    return "1"; // generic unknown error
}