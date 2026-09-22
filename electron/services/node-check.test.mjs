import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { checkNode } from "./node-check.mjs";
test("真实 TCP 连通与拒绝连接，UDP 明确不适用", async () => {
  const server = createServer((s) => s.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const result = await checkNode({ protocol: "vless", host: "127.0.0.1", port });
  assert.equal(result.error, "");
  assert.equal(typeof result.latencyMs, "number");
  await new Promise((resolve) => server.close(resolve));
  const failed = await checkNode({ protocol: "vless", host: "127.0.0.1", port });
  assert.equal(failed.latencyMs, null);
  assert.match(failed.error, /失败/);
  assert.match(
    (await checkNode({ protocol: "hysteria2", host: "127.0.0.1", port })).error,
    /不适用/,
  );
  assert.throws(() => checkNode({ host: "https://test", port: 443 }));
});
