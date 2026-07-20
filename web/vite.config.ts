import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    /**
     * Browser cannot call cloud parsers cross-origin (CORS → NetworkError).
     * Dev proxies forward Authorization headers to LlamaParse / Document AI.
     */
    proxy: {
      "/api/llamaparse": {
        target: "https://api.cloud.llamaindex.ai",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/llamaparse/, "/api/v1/parsing"),
      },
      // Document AI: /api/docai/us/... → https://us-documentai.googleapis.com/...
      "/api/docai": {
        target: "https://us-documentai.googleapis.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/docai/, ""),
        configure: (proxy) => {
          // Support eu region via Host header override when path contains /locations/eu/
          proxy.on("proxyReq", (proxyReq, req) => {
            const url = req.url ?? "";
            if (url.includes("/locations/eu/")) {
              proxyReq.setHeader("host", "eu-documentai.googleapis.com");
            }
          });
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Ensure PDFium WASM is treated as a static asset (browser init needs wasmUrl).
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["@hyzyla/pdfium"],
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
