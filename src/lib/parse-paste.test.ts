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
  const m = top(
    ["Host edge", "  HostName 10.1.2.3", "  User deploy", "  Port 2022"].join("\n"),
  );
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
  const m = top(
    ["IMAP: imap.qq.com 993", "SMTP: smtp.qq.com 465", "me@qq.com"].join("\n"),
    "mail",
  );
  assert.equal(m?.id, "mail-settings");
  assert.match(m?.detail ?? "", /imap\.qq\.com/);
  assert.equal(m?.fields.address, "me@qq.com");
});

test("empty input yields nothing", () => {
  assert.deepEqual(parsePaste("   "), []);
});
