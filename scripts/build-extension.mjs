import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookmarkPlus,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  RefreshCw,
} from "lucide-react";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const out = join(root, "release", `v${version}`, "nanpad-browser-extension");
await mkdir(out, { recursive: true });
await cp(join(root, "browser-extension"), out, { recursive: true });
await cp(join(root, "electron/services/browser-capture.mjs"), join(out, "browser-capture.mjs"));
await cp(join(root, "build/icon.png"), join(out, "icon.png"));
await mkdir(join(out, "icons"), { recursive: true });
const icons = {
  "arrow-down-to-line": ArrowDownToLine,
  "arrow-up-right": ArrowUpRight,
  "bookmark-plus": BookmarkPlus,
  "chevron-down": ChevronDown,
  "external-link": ExternalLink,
  eye: Eye,
  "eye-off": EyeOff,
  globe: Globe,
  "refresh-cw": RefreshCw,
};
for (const [name, component] of Object.entries(icons)) {
  await writeFile(
    join(out, "icons", `${name}.svg`),
    renderToStaticMarkup(
      createElement(component, {
        size: 24,
        color: "#202a29",
        strokeWidth: 1.8,
        xmlns: "http://www.w3.org/2000/svg",
      }),
    ),
  );
}
const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify({ ...manifest, version }, null, 2) + "\n",
);
console.log(out);
