/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    outDir: "../backend/engram/static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "jsdom",
  },
});
