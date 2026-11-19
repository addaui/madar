import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The Core serves the build at /faces/web-react/ (the plugin @madar/web-react publishes the Face `web-react`).
const core = process.env.NUAH_CORE ?? "http://127.0.0.1:3941";

export default defineConfig({
  base: "/faces/web-react/",
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  // one Loro on the page: every import of loro-crdt (the Live documents, loro-prosemirror's Presence) is its web build, started with the
  // Face's loro.wasm and shared with the editor and its element plugins (ADR 0093, 0095); tests keep Node's build
  resolve: { dedupe: ["react", "react-dom"], alias: process.env.VITEST ? [] : [{ find: /^loro-crdt$/, replacement: "loro-crdt/web" }] },
  // a build's own id: what this device kept for offline is forgotten when a new build arrives (src/app/offline.ts)
  define: { __MADAR_BUILD__: JSON.stringify(process.env.MADAR_BUILD ?? new Date().toISOString()) },
  build: {
    // the list of the build's files, so the service worker can keep all of them for offline (public/sw.js)
    manifest: "asset-manifest.json",
    outDir: "../faces/madar/web-react",
    emptyOutDir: true,
    target: "es2023",
    sourcemap: false,
    // no inline script or style: the Core's policy forbids both
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    // named vendor chunks: cacheable across releases, and their sizes show where the weight is
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/, priority: 30 },
            { name: "aria", test: /node_modules[\\/](react-aria-components|react-aria|react-stately|@react-aria|@react-stately|@react-types|@internationalized)[\\/]/, priority: 20 },
            { name: "tanstack", test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
            { name: "dnd", test: /node_modules[\\/]@atlaskit[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3942,
    fs: { allow: ["..", "../../nuah-plugins"] },
    // The Core refuses a request whose Origin is not its Host (cross-site writes), so the proxy keeps the Host the browser used
    // (`changeOrigin: false`); the Core must then answer to that name: NUAH_ALLOW_HOSTS=localhost:3942 (or the machine's address and port).
    proxy: {
      "/link": { target: core, changeOrigin: false },
      "/pulse": { target: core, changeOrigin: false },
      "/files": { target: core, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
