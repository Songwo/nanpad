import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePaste } from "./parse-paste.ts";

/** The first match for `kind`, or undefined. */
function top(text: string, kind?: Parameters<typeof parsePaste>[1]) {
  return parsePaste(text, kind)[0];
}

test("ssh command: a flag value is never taken for the host", () => {
  const m = top("ssh -p 2222 deploy@10.20.30.40");
  assert.equal(m?.id, "ssh-command");
  assert.equal(m?.fields.host, "10.20.30.40");
  assert.equal(m?.fields.port, "2222");
  assert.equal(m?.fields.username, "deploy");
});

test("ssh command: identity flag, -l user, joined port", () => {
  const m = top("ssh -i ~/.ssh/id_ed25519 example.com -l ops -p2200");
  assert.equal(m?.fields.host, "example.com");
  assert.equal(m?.fields.username, "ops");
  assert.equal(m?.fields.port, "2200");
  assert.equal(m?.fields._privateKeyPath, "~/.ssh/id_ed25519");
});

test("ssh command: bare host", () => {
  const m = top("ssh myhost.internal");
  assert.equal(m?.fields.host, "myhost.internal");
  assert.equal(m?.fields.username, undefined);
});

test("ssh config stanza wins over the looser detectors", () => {
  const m = top(["Host edge", "  HostName 10.1.2.3", "  User deploy", "  Port 2022"].join("\n"));
  assert.equal(m?.id, "ssh-config");
  assert.equal(m?.fields.host, "10.1.2.3");
  assert.equal(m?.fields.label, "edge");
  assert.equal(m?.fields.port, "2022");
});

test("api keys are recognised by prefix", () => {
  const m = top("OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123");
  assert.equal(m?.id, "api-key");
  assert.equal(m?.kind, "secret");
  assert.equal(m?.fields.name, "OpenAI API");
});

test("the mailbox form is not offered ssh parsing", () => {
  const matches = parsePaste("ssh -p 22 root@10.0.0.1", "mail");
  assert.deepEqual(matches, []);
});

test("the server form is not offered a mailbox", () => {
  const matches = parsePaste("hello@example.com", "server");
  assert.deepEqual(matches, []);
});

test("mailbox address fills address and domain", () => {
  const m = top("billing@studio.app", "mail");
  assert.equal(m?.id, "mailbox");
  assert.equal(m?.fields.address, "billing@studio.app");
  assert.equal(m?.fields.domain, "studio.app");
});

test("imap/smtp settings are picked up on the mail form", () => {
  const m = top(["IMAP: imap.qq.com 993", "SMTP: smtp.qq.com 465", "me@qq.com"].join("\n"), "mail");
  assert.equal(m?.id, "mail-settings");
  assert.match(m?.detail ?? "", /imap\.qq\.com/);
  assert.equal(m?.fields.address, "me@qq.com");
});

test("empty input yields nothing", () => {
  assert.deepEqual(parsePaste("   "), []);
});

test("网站网址在密钥表单预填网站账号和加密登录地址", () => {
  const match = top("https://accounts.example.com/sign-in", "secret");
  assert.equal(match?.kind, "secret");
  assert.deepEqual(match?.fields, {
    name: "accounts.example.com",
    kind: "password",
    _url: "https://accounts.example.com/sign-in",
  });
});

test("网址中的账号、密码和回调参数不进入粘贴结果", () => {
  const raw =
    "https://alice:private-password@accounts.example.com/login?token=sk-proj-abcdefghijklmnopqrstuvwxyz0123&email=private@example.com#access_token=fixture";
  for (const kind of ["secret", "domain", "mail", "ai", undefined] as const) {
    const matches = parsePaste(raw, kind);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].fields._url, "https://accounts.example.com/login");
    const result = JSON.stringify(matches);
    for (const forbidden of [
      "alice",
      "private-password",
      "sk-proj-",
      "private@example.com",
      "fixture",
    ]) {
      assert.equal(result.includes(forbidden), false);
    }
  }
});

test("网站网址不会覆盖已有的 API Key 粘贴能力", () => {
  assert.equal(top("ghp_abcdefghijklmnopqrstuvwxyz0123456789", "secret")?.fields.kind, "token");
  assert.deepEqual(parsePaste("javascript:alert(1)", "secret"), []);
  assert.deepEqual(parsePaste("https://", "secret"), []);
  assert.equal(
    top("HTTPS://alice:private@EXAMPLE.COM/login?token=temporary", "secret")?.fields._url,
    "https://example.com/login",
  );
});
