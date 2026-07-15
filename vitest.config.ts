import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    // Workspace tests execute one source module identity; consumers use dist.
    alias: {
      "@pixel-point/aval-compiler": fileURLToPath(
        new URL("./packages/compiler/src/index.ts", import.meta.url)
      ),
      "@pixel-point/aval-format": fileURLToPath(
        new URL("./packages/format/src/index.ts", import.meta.url)
      ),
      "@pixel-point/aval-graph": fileURLToPath(
        new URL("./packages/graph/src/index.ts", import.meta.url)
      ),
      "@pixel-point/aval-player-web": fileURLToPath(
        new URL("./packages/player-web/src/index.ts", import.meta.url)
      ),
      "@pixel-point/aval-element/auto": fileURLToPath(
        new URL("./packages/element/src/auto.ts", import.meta.url)
      ),
      "@pixel-point/aval-element": fileURLToPath(
        new URL("./packages/element/src/index.ts", import.meta.url)
      )
    }
  }
});
