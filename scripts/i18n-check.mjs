import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { EN } from "../src/lib/i18n-en.ts";

const used = new Map();
const problems = [];
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (!/\.tsx?$/.test(path) || /\.test\.ts$/.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const diagnostic of source.parseDiagnostics)
      problems.push(`${path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t"
      ) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)))
          used.set(arg.text.replace(/\r\n/g, "\n"), path);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan("src");
for (const [key, path] of used)
  if (/\p{Script=Han}/u.test(key) && !(key in EN))
    problems.push(`${path}: missing ${JSON.stringify(key)}`);
const placeholders = (text) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort().join(",");
for (const [key, value] of Object.entries(EN)) {
  if (placeholders(key) !== placeholders(value))
    problems.push(`Placeholder mismatch: ${JSON.stringify(key)}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `i18n: ${used.size} literal call keys and ${Object.keys(EN).length} translations checked`,
  );
