import test from "node:test";
import assert from "node:assert/strict";
import { parseProxyUri, formatProxyUri, validateProxyNode } from "../src/lib/proxy-nodes.ts";
test("中文 VMess 分享链接往返与凭据校验", () => {
  const node = {
    id: "n",
    name: "香港 节点",
    protocol: "vmess",
    host: "example.com",
    port: 443,
    uuid: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  };
  assert.equal(parseProxyUri(formatProxyUri(node)).name, node.name);
  validateProxyNode(node);
  assert.throws(() => validateProxyNode({ ...node, uuid: "uuid-123" }));
  assert.throws(() => validateProxyNode({ ...node, port: 65536 }));
});
test("Shadowsocks IPv6 和密码保留", () => {
  const node = parseProxyUri("ss://YWVzLTI1Ni1nY206cGFzcw==@[::1]:8388#test");
  assert.equal(node.host, "[::1]");
  assert.equal(node.port, 8388);
  assert.equal(node.password, "aes-256-gcm:pass");
  validateProxyNode(node);
});

test("HY2 两种协议前缀、完整认证信息与原始扩展参数保留", () => {
  for (const scheme of ["hy2", "hysteria2"]) {
    const uri = `${scheme}://user:pass%3Aword@[::1]:8443?sni=example.com&obfs=salamander&obfs-password=fixture&insecure=1#香港`;
    const node = parseProxyUri(uri);
    assert.equal(node.protocol, "hysteria2");
    assert.equal(node.password, "user:pass:word");
    assert.equal(node.host, "[::1]");
    assert.equal(node.port, 8443);
    assert.equal(node.name, "香港");
    validateProxyNode(node);
    assert.equal(formatProxyUri(node), uri);
  }
});

test("HY2 编码密码往返及默认端口，HY1 不误判为 HY2", () => {
  const node = parseProxyUri("hy2://p%40ss%3Aword@example.com#test");
  assert.equal(node.password, "p@ss:word");
  assert.equal(node.port, 443);
  assert.equal(
    parseProxyUri(formatProxyUri({ ...node, rawUri: undefined })).password,
    node.password,
  );
  assert.equal(parseProxyUri("hysteria://example.com:443?auth=fixture"), null);
});
