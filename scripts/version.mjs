// The release version is written in four files, which must agree:
//   node scripts/version.mjs check            they all carry the same version
//   node scripts/version.mjs check 0.35.0     ...and it is this one (the release tag)
//   node scripts/version.mjs set 0.35.0       writes it in the four files
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const FILES = [
  ["package.json", (json) => json, "version"],
  ["plugin/.claude-plugin/plugin.json", (json) => json, "version"],
  ["plugin/plugin.json", (json) => json, "version"],
  [".claude-plugin/marketplace.json", (json) => json.plugins[0], "plugins[0].version"],
];

const read = (file) => readFileSync(new URL(file, root), "utf8");
const [command, wanted] = process.argv.slice(2);

if (command === "set") {
  if (!/^\d+\.\d+\.\d+$/.test(wanted ?? "")) {
    console.error("Usage: node scripts/version.mjs set <major.minor.patch>");
    process.exit(1);
  }
  for (const [file, holder] of FILES) {
    const text = read(file);
    const current = holder(JSON.parse(text)).version;
    // Replaces the text itself, so the files keep their layout. Each holds its version once.
    const field = `"version": "${current}"`;
    if (text.split(field).length !== 2) {
      console.error(`${file}: expected exactly one ${field}`);
      process.exit(1);
    }
    writeFileSync(new URL(file, root), text.replace(field, `"version": "${wanted}"`));
    console.log(`${file}: ${current} → ${wanted}`);
  }
} else if (command === "check") {
  const versions = FILES.map(([file, holder, path]) => ({ file, path, version: holder(JSON.parse(read(file))).version }));
  const expected = wanted ?? versions[0].version;
  const wrong = versions.filter(({ version }) => version !== expected);
  for (const { file, path, version } of wrong) console.error(`${file} (${path}) is ${version}, expected ${expected}`);
  if (wrong.length > 0) process.exit(1);
  console.log(`Version ${expected} in ${versions.length} files`);
} else {
  console.error("Usage: node scripts/version.mjs check [version] | set <version>");
  process.exit(1);
}
