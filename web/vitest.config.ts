import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["src/**/*.browser.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // Silence Node experimental localStorage warning during remote-engine tests
    env: {
      NODE_OPTIONS: "--no-warnings=ExperimentalWarning",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Node-safe PDF.js (eliminates "use the legacy build" + font warnings)
      "pdfjs-dist": path.resolve(
        __dirname,
        "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      ),
    },
  },
});
