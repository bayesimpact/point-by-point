// Bundles the local server into one file that Node 22 or later runs as is, the interface embedded:
// dist/point-by-point-server.mjs, attached to each release. Run after the embed of the interface.
import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/stdio.ts", import.meta.url).pathname],
  outfile: new URL("../dist/point-by-point-server.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  // Some dependencies are CommonJS and call require.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  logLevel: "warning",
});
console.log("Bundled the local server as dist/point-by-point-server.mjs");
