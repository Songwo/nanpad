import { constants } from "node:fs";
import { open } from "node:fs/promises";

export const MAX_OAUTH_CLIENT_BYTES = 256 * 1024;

export async function readOAuthClientFile(path) {
  // 检查与读取使用同一个句柄；非阻塞打开避免误选命名管道后一直等待。
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_OAUTH_CLIENT_BYTES)
      throw new Error("所选文件不是 OAuth 客户端 JSON，或体积超过 256 KB。");
    // 最多读上限加一字节，即使检查后文件增长也不会无界占用主进程内存。
    const buffer = Buffer.alloc(MAX_OAUTH_CLIENT_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_OAUTH_CLIENT_BYTES)
      throw new Error("所选文件不是 OAuth 客户端 JSON，或体积超过 256 KB。");
    try {
      return JSON.parse(buffer.toString("utf8", 0, total));
    } catch {
      // 原始解析异常可能携带 JSON 片段，其中可能包含客户端密钥。
      throw new Error("客户端配置不是有效的 JSON 文件，请重新从服务商下载。");
    }
  } finally {
    await handle.close();
  }
}
