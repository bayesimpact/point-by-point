import { defineConfig } from "vitest/config";

// One readable ES module and one stylesheet, for a site to vendor as they are: no minification, so
// a reviewer on the vendoring side can read what they ship.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "pins.js",
      cssFileName: "pins",
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
