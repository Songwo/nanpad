import { createConnection } from "node:net";
export function checkNode(node) {
  if (
    !node ||
    typeof node.host !== "string" ||
    !node.host.trim() ||
    /[\s/\\@?#]/.test(node.host) ||
    !Number.isInteger(node.port) ||
    node.port < 1 ||
    node.port > 65535
  )
    throw new Error("节点主机或端口无效");
  const checkedAt = new Date().toISOString();
  if (node.protocol === "hysteria2")
    return Promise.resolve({
      checkedAt,
      latencyMs: null,
      error: "Hysteria2 使用 UDP，TCP 检测不适用",
    });
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = createConnection({ host: node.host.replace(/^\[|\]$/g, ""), port: node.port });
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        checkedAt,
        latencyMs: error ? null : Math.round(performance.now() - start),
        error: error ?? "",
      });
    };
    const timer = setTimeout(() => finish("TCP 连接超时"), 5000);
    socket.once("connect", () => finish());
    socket.once("error", (e) => finish(`TCP 连接失败：${e.code ?? "NETWORK_ERROR"}`));
  });
}
