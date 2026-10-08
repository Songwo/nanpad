import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

assert.equal(process.platform, "win32", "安装目录回归必须在 Windows 执行真实 NSIS 程序");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const cache =
  process.env.ELECTRON_BUILDER_CACHE ||
  join(
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
    "electron-builder",
    "Cache",
  );

async function findCompiler(directory, depth = 0) {
  const entries = await readdir(directory, { withFileTypes: true });
  const compiler = entries.find((entry) => entry.isFile() && entry.name === "makensis.exe");
  if (compiler) return join(directory, compiler.name);
  if (depth >= 4) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || (depth === 0 && !entry.name.startsWith("nsis"))) continue;
    const found = await findCompiler(join(directory, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

const compiler = process.argv[2] ? resolve(process.argv[2]) : await findCompiler(cache);
assert.ok(compiler, "未找到 electron-builder 缓存的 makensis.exe，请先执行 desktop:dist");
const template = await readFile(
  join(root, "node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh"),
  "utf8",
);
// 直接编译当前依赖的函数和项目钩子，避免用 JavaScript 模拟 NSIS 目录逻辑。
const originalFunction = template.match(
  /^\s*Function instFilesPre\s*\r?\n[\s\S]*?^\s*FunctionEnd\s*$/m,
)?.[0];
assert.ok(originalFunction, "electron-builder 安装模板变化，未找到真实 instFilesPre");
const directory = await mkdtemp(join(tmpdir(), "installer-directory-regression-"));
const nsisString = (value) => String(value).replaceAll("$", "$$").replaceAll('"', '$\\"');
const quote = (value) => `"${nsisString(value)}"`;
const results = [];

try {
  for (const mode of ["both", "per-user", "per-machine"]) {
    const executable = join(directory, `${mode}.exe`);
    const output = join(directory, `${mode}.txt`);
    const script = join(directory, `${mode}.nsi`);
    const legacyUser = join(directory, "legacy-user", "nanpad");
    const legacyMachine = join(directory, "legacy-machine", "nanpad");
    const scenarios = [
      ...(mode !== "per-machine"
        ? [{ name: "existing-user", input: legacyUser, expected: legacyUser }]
        : []),
      ...(mode !== "per-user"
        ? [{ name: "existing-machine", input: legacyMachine, expected: legacyMachine }]
        : []),
      {
        name: "fresh-folder",
        input: join(directory, "fresh"),
        expected: join(directory, "fresh", "Zhiyu"),
      },
      {
        name: "drive-root",
        input: parse(directory).root,
        expected: join(parse(directory).root, "Zhiyu"),
      },
      {
        name: "already-named",
        input: join(directory, "Zhiyu"),
        expected: join(directory, "Zhiyu"),
      },
      {
        name: "different-legacy-folder",
        input: join(directory, "other-nanpad"),
        expected: join(directory, "other-nanpad", "Zhiyu"),
      },
    ];
    const lines = [
      "Unicode true",
      'Name "Zhiyu isolated installer directory regression"',
      `OutFile ${quote(executable)}`,
      "RequestExecutionLevel user",
      "SilentInstall silent",
      "AutoCloseWindow true",
      '!include "LogicLib.nsh"',
      `!include ${quote(join(root, "node_modules/app-builder-lib/templates/nsis/include/StrContains.nsh"))}`,
      '!define APP_FILENAME "Zhiyu"',
      ...(mode !== "per-user" ? ["!define INSTALL_MODE_PER_ALL_USERS_REQUIRED"] : []),
      ...(mode === "per-machine" ? ["!define INSTALL_MODE_PER_ALL_USERS"] : []),
      ...(mode !== "per-machine" ? ["Var perUserInstallationFolder"] : []),
      ...(mode !== "per-user" ? ["Var perMachineInstallationFolder"] : []),
      originalFunction,
      "!define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre",
      `!include ${quote(join(root, "build/installer.nsh"))}`,
      "!insertmacro customPageAfterChangeDir",
      'Section "Directory assertions only"',
      ...(mode !== "per-machine" ? [`StrCpy $perUserInstallationFolder ${quote(legacyUser)}`] : []),
      ...(mode !== "per-user"
        ? [`StrCpy $perMachineInstallationFolder ${quote(legacyMachine)}`]
        : []),
      `FileOpen $9 ${quote(output)} w`,
      "IfErrors failed",
      `StrCpy $INSTDIR ${quote(mode === "per-machine" ? legacyMachine : legacyUser)}`,
      "Call instFilesPre",
      'FileWrite $9 "original-template=$INSTDIR$\\r$\\n"',
      ...scenarios.flatMap(({ name, input }) => [
        `StrCpy $INSTDIR ${quote(input)}`,
        "Call ${MUI_PAGE_CUSTOMFUNCTION_PRE}",
        `FileWrite $9 "${name}=$INSTDIR$\\r$\\n"`,
      ]),
      "FileClose $9",
      "SetErrorLevel 0",
      "Goto done",
      "failed:",
      "SetErrorLevel 2",
      "done:",
      "SectionEnd",
    ];
    await writeFile(script, lines.join("\r\n"), "utf8");
    await run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", script], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    await run(executable, ["/S"], { windowsHide: true, timeout: 30000 });
    const actual = Object.fromEntries(
      (await readFile(output, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const delimiter = line.indexOf("=");
          return [line.slice(0, delimiter), line.slice(delimiter + 1)];
        }),
    );
    assert.equal(
      actual["original-template"],
      join(mode === "per-machine" ? legacyMachine : legacyUser, "Zhiyu"),
      "必须先重现未修复模板向旧目录追加应用名的行为",
    );
    for (const { name, expected } of scenarios) {
      assert.equal(actual[name], expected, `${mode}/${name} 安装目录不符`);
    }
    results.push({
      mode,
      compiled: true,
      executed: true,
      originalBugReproduced: true,
      checks: scenarios.map(({ name }) => name),
    });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        realNsis: true,
        isolated: true,
        registryUntouched: true,
        appNotInstalled: true,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  const child = relative(resolve(tmpdir()), resolve(directory));
  assert.ok(child && !child.startsWith("..") && !isAbsolute(child));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
