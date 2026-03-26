/**
 * Session management for the Aria2 shim.
 * Generates and stores a session ID that persists for the lifetime
 * of the background service worker.
 */

let sessionId: string | null = null;

/**
 * Get or create the current session ID.
 * The session ID is a 16-character hex string, generated once per
 * service worker lifetime (analogous to one aria2 process run).
 */
export function getSessionId(): string {
    if (!sessionId) {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        sessionId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return sessionId;
}