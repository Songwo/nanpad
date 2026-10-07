import assert from "node:assert/strict";
import test from "node:test";
import { deleteEncryptedAccount } from "../src/lib/account-delete.mjs";

test("取消解锁不会删除账号资料或凭据", async () => {
  const calls = [];
  assert.equal(
    await deleteEncryptedAccount({
      id: "one",
      requireUnlocked: async () => false,
      removeCredential: async () => calls.push("vault"),
      removeAsset: () => calls.push("asset"),
    }),
    false,
  );
  assert.deepEqual(calls, []);
});
test("加密记录删除失败仍保留账号入口", async () => {
  let removed = false;
  await assert.rejects(
    deleteEncryptedAccount({
      id: "one",
      requireUnlocked: async () => true,
      removeCredential: async () => {
        throw new Error("write failed");
      },
      removeAsset: () => {
        removed = true;
      },
    }),
    /write failed/,
  );
  assert.equal(removed, false);
});
test("成功时先删除指定账号加密记录，再移除资料", async () => {
  const calls = [];
  assert.equal(
    await deleteEncryptedAccount({
      id: "one",
      requireUnlocked: async () => true,
      removeCredential: async (key) => calls.push(key),
      removeAsset: (id) => calls.push(id),
    }),
    true,
  );
  assert.deepEqual(calls, ["account:one", "one"]);
});
