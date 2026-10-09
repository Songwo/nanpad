import { readFile } from "node:fs/promises";
import { createIdentityLoginServer } from "./server.mjs";

try {
  const filename = process.env.ZHIYU_IDENTITY_CONFIG;
  const file = filename ? JSON.parse(await readFile(filename, "utf8")) : {};
  if (!file || typeof file !== "object" || Array.isArray(file))
    throw new Error("配置文件须为 JSON 对象。");
  const value = (key) => process.env[key] ?? file[key];
  const port = Number(value("PORT") || 49284);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT 无效。");
  const server = createIdentityLoginServer({
    config: {
      publicOrigin: value("PUBLIC_ORIGIN"),
      clientId: value("LINUXDO_CLIENT_ID"),
      clientSecret: value("LINUXDO_CLIENT_SECRET"),
      sessionEncryptionKey: value("SESSION_ENCRYPTION_KEY"),
      trustCloudflareProxy: [true, "true"].includes(value("TRUST_CLOUDFLARE_PROXY")),
    },
  });
  server.on("error", () => {
    process.stderr.write("知屿登录服务无法启动，请检查监听端口和服务配置。\n");
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write("知屿登录服务已启动。\n"));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => {
      server.closeAllConnections();
    }, 10_000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch {
  // 避免 JSON 解析错误把配置中的敏感片段输出到日志。
  process.stderr.write("知屿登录服务配置无效或无法读取，请检查受保护的配置文件。\n");
  process.exitCode = 1;
}
