import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The Core serves the build at /faces/web-react/ (the plugin @madar/web-react publishes the Face `web-react`).
const core = process.env.NUAH_CORE ?? "http://127.0.0.1:3941";

export default defineConfig({
  base: "/faces/web-react/",
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
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
    proxy: {
      "/link": { target: core, changeOrigin: true },
      "/pulse": { target: core, changeOrigin: true },
      "/files": { target: core, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
