import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";

/**
 * Wrap user-facing Chinese literals in `t(...)`.
 *
 * Driven by the TypeScript AST rather than by regex, because the difference
 * that matters here is invisible to a regex: `agent.ts` holds Chinese inside
 * *regular expression literals* used to match what the user typed, and
 * translating a matcher would break the feature it powers. The AST knows a
 * RegularExpressionLiteral is not a StringLiteral; a regex scan does not.
 *
 * Run with `--apply` to write, otherwise it reports.
 */
const APPLY = process.argv.includes("--apply");
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/;

// Normalise to forward slashes so the exclusions never have to think about
// Windows separators.
const FILES = globSync("src/{components,lib}/**/*.{ts,tsx}", { cwd: process.cwd() })
  .map((f) => f.split(sep).join("/"))
  .filter(
    (f) =>
      !/\.test\.[tj]sx?$/.test(f) &&
      !/^src\/lib\/(seed|i18n|i18n-en|changelog)\.ts$/.test(f) &&
      !/^src\/lib\/(app-data|auth|multiplayer|og)\//.test(f),
  );

/** Strings that are data for matching, not text for reading. */
const SKIP_DECLARATIONS = new Set(["PATTERNS", "KEYWORDS", "STOPWORDS", "NON_WORD", "UNITS"]);

const strings = new Map(); // source text -> {files:Set, interpolated:bool}
const deferred = []; // module-scope sites we must not freeze
let edits = 0;

for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const patches = [];

  const record = (raw, interpolated) => {
    const entry = strings.get(raw) ?? { files: new Set(), interpolated };
    entry.files.add(file);
    entry.interpolated ||= interpolated;
    strings.set(raw, entry);
  };

  /** Does this node get evaluated per render, or once at import time? */
  const isModuleScope = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (
        ts.isFunctionDeclaration(p) ||
        ts.isArrowFunction(p) ||
        ts.isFunctionExpression(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isGetAccessor(p)
      )
        return false;
    }
    return true;
  };

  /** Inside a declaration whose strings are matcher data. */
  const inSkippedDeclaration = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && SKIP_DECLARATIONS.has(p.name.text))
        return true;
    }
    return false;
  };

  const alreadyWrapped = (node) =>
    node.parent &&
    ts.isCallExpression(node.parent) &&
    ts.isIdentifier(node.parent.expression) &&
    node.parent.expression.text === "t" &&
    node.parent.arguments[0] === node;

  const visit = (node) => {
    // Never touch module specifiers, property keys, or JSX element names.
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      return;
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CJK.test(node.text) &&
      !alreadyWrapped(node) &&
      !inSkippedDeclaration(node)
    ) {
      const isKey =
        (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        ts.isEnumMember(node.parent) ||
        (ts.isLiteralTypeNode(node.parent));
      if (!isKey) {
        if (isModuleScope(node)) {
          deferred.push({ file, text: node.text, line: sf.getLineAndCharacterOfPosition(node.pos).line + 1 });
        } else {
          record(node.text, false);
          const literal = JSON.stringify(node.text);
          // A JSX attribute needs braces; everywhere else is an expression already.
          const inAttr = ts.isJsxAttribute(node.parent);
          patches.push({
            start: node.getStart(sf),
            end: node.getEnd(),
            text: inAttr ? `{t(${literal})}` : `t(${literal})`,
          });
        }
      }
    }

    if (ts.isJsxText(node) && CJK.test(node.text)) {
      const raw = node.text;
      const trimmed = raw.trim();
      if (trimmed) {
        record(trimmed, false);
        const lead = raw.slice(0, raw.indexOf(trimmed[0]));
        const tail = raw.slice(lead.length + trimmed.length);
        patches.push({
          start: node.getStart(sf),
          end: node.getEnd(),
          text: `${lead}{t(${JSON.stringify(trimmed)})}${tail}`,
        });
      }
    }

    if (ts.isTemplateExpression(node) && CJK.test(node.getText(sf)) && !inSkippedDeclaration(node)) {
      if (ts.isTaggedTemplateExpression(node.parent)) return;
      const args = [];
      let pattern = node.head.text;
      node.templateSpans.forEach((span, i) => {
        args.push(span.expression.getText(sf));
        pattern += `{${i}}` + span.literal.text;
      });
      if (CJK.test(pattern)) {
        if (isModuleScope(node)) {
          deferred.push({ file, text: pattern, line: sf.getLineAndCharacterOfPosition(node.pos).line + 1 });
        } else {
          record(pattern, true);
          patches.push({
            start: node.getStart(sf),
            end: node.getEnd(),
            text: `t(${JSON.stringify(pattern)}${args.length ? ", " + args.join(", ") : ""})`,
          });
        }
        return; // do not descend: the spans are already captured
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);

  if (!patches.length) continue;
  edits += patches.length;

  if (APPLY) {
    patches.sort((a, b) => b.start - a.start);
    let out = text;
    for (const p of patches) out = out.slice(0, p.start) + p.text + out.slice(p.end);
    // `src/lib` also runs under `node --test`, whose ESM resolver knows neither
    // the `@/` alias nor extensionless specifiers.
    const spec = file.startsWith("src/lib/") ? "./i18n.ts" : "@/lib/i18n";
    if (!out.includes(`} from "${spec}"`)) {
      const lastImport = [...out.matchAll(/^import .*?;$/gms)].pop();
      const at = lastImport ? lastImport.index + lastImport[0].length : 0;
      out = out.slice(0, at) + `\nimport { t } from "${spec}";` + out.slice(at);
    }
    writeFileSync(file, out);
  }
}

const all = [...strings.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
writeFileSync(
  "scratchpad-i18n-strings.json",
  JSON.stringify(all.map(([k, v]) => ({ zh: k, interpolated: v.interpolated, files: [...v.files] })), null, 1),
);

console.log(`files scanned: ${FILES.length}`);
console.log(`wrappable sites: ${edits}  unique strings: ${strings.size}`);
console.log(`module-scope (needs manual lazy fix): ${deferred.length}`);
for (const d of deferred) console.log(`  ${d.file}:${d.line}  ${d.text.slice(0, 40)}`);
