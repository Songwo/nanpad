import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountFromForm,
  accountMetadataFromForm,
  clearAccountDraft,
} from "../src/lib/account-record.mjs";

const previous = {
  username: "owner@example.test",
  password: "original-password",
  url: "https://account.example.test",
  note: "sensitive-recovery-code",
  updatedAt: "2026-01-01T00:00:00Z",
};

test("独立账号编辑留空密码保留旧密码，允许修改或清空其他敏感字段", () => {
  const saved = accountFromForm(
    { _username: " next@example.test ", _password: "", _note: "", _url: "" },
    previous,
  );
  assert.equal(saved.username, "next@example.test");
  assert.equal(saved.password, "original-password");
  assert.equal(saved.note, undefined);
  assert.equal(saved.url, undefined);
  assert.equal(
    accountFromForm({ _password: " replacement with spaces " }, previous).password,
    " replacement with spaces ",
  );
});

test("只改显示名称时保留未读入表单的凭据与已有OAuth信息", () => {
  const oauth = {
    provider: "example",
    refreshToken: "encrypted-refresh",
    expiresAt: null,
    scope: "mail",
  };
  const saved = accountFromForm({ name: "新名称" }, { ...previous, oauth });
  for (const key of ["username", "password", "url", "note"])
    assert.equal(saved[key], previous[key]);
  assert.deepEqual(saved.oauth, oauth);
  assert.equal(accountFromForm({ name: "没有凭据" }), null);
});

test("账号元数据与锁库草稿不包含账户名、密码、登录网址和敏感备注", () => {
  const form = {
    name: " Apple ID ",
    kind: "account",
    tags: "个人",
    hint: "private-hint",
    notes: "private-note",
    value: "legacy-password",
    _username: previous.username,
    _password: previous.password,
    _url: previous.url,
    _note: previous.note,
  };
  assert.deepEqual(accountMetadataFromForm(form), {
    name: "Apple ID",
    kind: "account",
    hint: "",
    value: "",
    notes: "",
  });
  const cleared = clearAccountDraft(form);
  for (const key of ["_username", "_password", "_url", "_note"])
    assert.equal(Object.hasOwn(cleared, key), false);
  assert.equal(cleared.name, form.name);
  assert.equal(form._password, previous.password);
});
