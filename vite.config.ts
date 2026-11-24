import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const API_TARGET = `http://127.0.0.1:${process.env.NEXUSS_API_PORT ?? 5175}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5174,
    open: false,
    // Migrated Nexuss Lab / OpenCode backend (src/server) runs as a separate
    // Node process; proxy the API surface + SSE stream to it.
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: false,
        // SSE must not be buffered by the proxy.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
            }
          });
        }
      }
    }
  },
  preview: {
    port: 5174,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: false
      }
    }
  }
});
