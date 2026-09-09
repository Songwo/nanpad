import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const out = join(root, "release", `v${version}`, "nanpad-browser-extension");
await mkdir(out, { recursive: true });
await cp(join(root, "browser-extension"), out, { recursive: true });
await cp(join(root, "electron/services/browser-capture.mjs"), join(out, "browser-capture.mjs"));
await cp(join(root, "build/icon.png"), join(out, "icon.png"));
const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify({ ...manifest, version }, null, 2) + "\n",
);
console.log(out);
