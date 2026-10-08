import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export async function createPackageStage(parent = tmpdir()) {
  // macOS 的 /var、/tmp 可能指向 /private。npm 和 builder 必须使用同一真实路径。
  return realpath(await mkdtemp(join(await realpath(parent), "nanpad-package-")));
}

export function packageEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^npm_/i.test(key) || key === "INIT_CWD") delete env[key];
  }
  return env;
}

export function runPackageCommand(stage, script, args, env = packageEnvironment()) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: stage,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`构建子进程退出：${result.status ?? 1}`);
}

export async function installPackageDependencies(stage, npmCli, dependencies, env) {
  // 只通过 cwd 定位暂存项目。额外传 --prefix 会让 npm 在 macOS 符号链接路径中
  // 生成不同的依赖解析基准，造成刚生成的 lock 随后被 npm ci 判断为不同步。
  runPackageCommand(
    stage,
    npmCli,
    ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    env,
  );
  const lock = JSON.parse(await readFile(join(stage, "package-lock.json"), "utf8"));
  for (const [name, version] of Object.entries(dependencies)) {
    if (
      lock.packages?.[""]?.dependencies?.[name] !== version ||
      lock.packages?.[`node_modules/${name}`]?.version !== version
    ) {
      throw new Error(`暂存依赖与仓库锁定版本不一致：${name}`);
    }
  }
  runPackageCommand(
    stage,
    npmCli,
    ["ci", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"],
    env,
  );
}
