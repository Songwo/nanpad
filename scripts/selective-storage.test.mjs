import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../node_modules/zustand/esm/vanilla.mjs";
import { persist, createJSONStorage } from "../node_modules/zustand/esm/middleware.mjs";
import { selectiveStorage } from "../src/lib/selective-storage.ts";

test("切页和输入筛选词不重复写入，资产修改仍立即保存", () => {
  const writes = [];
  const storage = selectiveStorage(
    createJSONStorage(() => ({
      getItem: () => null,
      setItem: (_key, value) => writes.push(JSON.parse(value)),
      removeItem() {},
    })),
  );
  const store = createStore(
    persist(() => ({ assets: [{ id: "a" }], view: "overview", query: "" }), {
      name: "test",
      storage,
      partialize: (s) => ({ assets: s.assets }),
    }),
  );
  store.setState({ view: "servers" });
  const count = writes.length;
  for (let i = 0; i < 200; i++)
    store.setState({ view: i % 2 ? "overview" : "servers", query: String(i) });
  assert.equal(writes.length, count);
  store.setState({ assets: [...store.getState().assets, { id: "b" }] });
  assert.equal(writes.length, count + 1);
  assert.deepEqual(
    writes.at(-1).state.assets.map((a) => a.id),
    ["a", "b"],
  );
});

test("异步保存失败后允许重试", async () => {
  let attempts = 0;
  const storage = selectiveStorage({
    getItem: () => null,
    setItem: async () => {
      if (++attempts === 1) throw new Error("disk failure");
    },
    removeItem() {},
  });
  const value = { state: { assets: [] }, version: 0 };
  await assert.rejects(storage.setItem("test", value), /disk failure/);
  await storage.setItem("test", value);
  assert.equal(attempts, 2);
});

test("删除、版本变化和键名变化均不会被错误跳过", async () => {
  const writes = [];
  const storage = selectiveStorage({
    getItem: () => null,
    setItem: (key, value) => {
      writes.push([key, value]);
    },
    removeItem() {},
  });
  const value = { state: { assets: [] }, version: 0 };
  await storage.setItem("a", value);
  await storage.setItem("b", value);
  await storage.setItem("a", { ...value, version: 1 });
  await storage.removeItem("a");
  await storage.setItem("a", value);
  assert.equal(writes.length, 4);
});

test("同步保存失败会清除去重记录", () => {
  let attempts = 0;
  const storage = selectiveStorage({
    getItem: () => null,
    setItem: () => {
      if (++attempts === 1) throw new Error("quota");
    },
    removeItem() {},
  });
  const value = { state: { assets: [] }, version: 0 };
  assert.throws(() => storage.setItem("a", value), /quota/);
  storage.setItem("a", value);
  assert.equal(attempts, 2);
});
