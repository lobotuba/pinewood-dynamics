// Browser build of the design workspace (PLT-002/003): one static bundle, fully offline once loaded.
import { defineConfig } from "vite";

export default defineConfig({
  // manifold-3d ships its own WebAssembly loader; pre-bundling it breaks the .wasm lookup.
  optimizeDeps: { exclude: ["manifold-3d"] },
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist" },
});
