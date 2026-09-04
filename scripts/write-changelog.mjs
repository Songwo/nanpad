#!/usr/bin/env node
/**
 * Regenerate CHANGELOG.md from `src/lib/changelog.ts`.
 *
 * The TS file is the source of truth because the settings dialog renders from
 * it; this keeps the repo's own changelog from drifting out of step. Run it
 * after editing a release entry.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "src/lib/changelog.ts"), "utf8");

// A tiny extractor rather than a TS pipeline: the file is a plain array literal
// and adding a compiler to a 40-line script would be the expensive option.
const QUOTED = /"((?:[^"\\]|\\.)*)"/g;
const body = source.slice(source.indexOf("export const RELEASES"));
const releases = [];

for (const block of body.split(/\n {2}\{\n/).slice(1)) {
  const field = (name) => {
    const match = new RegExp(`${name}:\\s*` + QUOTED.source).exec(block);
    return match ? match[1] : undefined;
  };
  const version = field("version");
  if (!version) continue;
  const changesRaw = /changes:\s*\[([\s\S]*?)\n {4}\]/.exec(block);
  const changes = changesRaw
    ? [...changesRaw[1].matchAll(QUOTED)].map((m) => m[1].replaceAll('\\"', '"'))
    : [];
  releases.push({ version, date: field("date"), title: field("title"), changes });
}

if (releases.length === 0) {
  console.error("no releases parsed from src/lib/changelog.ts");
  process.exit(1);
}

const lines = [
  "# 更新日志",
  "",
  "> 本文件由 `node scripts/write-changelog.mjs` 从 `src/lib/changelog.ts` 生成，",
  "> 请改那个文件而不是这里 —— 应用内的「设置 → 更新日志」读的是同一份数据。",
  "",
];
for (const release of releases) {
  lines.push(`## ${release.version} — ${release.title}`, "", `*${release.date}*`, "");
  for (const change of release.changes) lines.push(`- ${change}`);
  lines.push("");
}

writeFileSync(join(root, "CHANGELOG.md"), lines.join("\n"), "utf8");
console.log(`CHANGELOG.md written (${releases.length} release${releases.length > 1 ? "s" : ""})`);
