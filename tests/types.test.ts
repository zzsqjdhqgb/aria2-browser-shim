import { describe, it, expect } from "vitest";
import { toAria2Status, TERMINAL_STATUSES } from "@/core/types";

describe("toAria2Status", () => {
    it("maps pending to waiting", () => {
        expect(toAria2Status("pending")).toBe("waiting");
    });

    it("maps in_progress to active", () => {
        expect(toAria2Status("in_progress")).toBe("active");
    });

    it("maps paused to paused", () => {
        expect(toAria2Status("paused")).toBe("paused");
    });

    it("maps complete to complete", () => {
        expect(toAria2Status("complete")).toBe("complete");
    });

    it("maps error to error", () => {
        expect(toAria2Status("error")).toBe("error");
    });

    it("maps cancelled to removed", () => {
        expect(toAria2Status("cancelled")).toBe("removed");
    });
});

describe("TERMINAL_STATUSES", () => {
    it("includes complete, error, cancelled", () => {
        expect(TERMINAL_STATUSES.has("complete")).toBe(true);
        expect(TERMINAL_STATUSES.has("error")).toBe(true);
        expect(TERMINAL_STATUSES.has("cancelled")).toBe(true);
    });

    it("excludes pending, in_progress, paused", () => {
        expect(TERMINAL_STATUSES.has("pending")).toBe(false);
        expect(TERMINAL_STATUSES.has("in_progress")).toBe(false);
        expect(TERMINAL_STATUSES.has("paused")).toBe(false);
    });
});
