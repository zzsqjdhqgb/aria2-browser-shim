import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname } from "path";

export default defineConfig({
    test: {
        globals: true,
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            "@": dirname(fileURLToPath(import.meta.url)),
        },
    },
});
