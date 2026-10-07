import test from "node:test";
import assert from "node:assert/strict";
import * as phones from "../src/lib/phone-view.mjs";

test("一万条号码分页时只返回当前50条，末页和删除后页码有效", () => {
  assert.equal(typeof phones.phonePage, "function", "号码列表需要分页");
  const records = Array.from({ length: 10000 }, (_, id) => ({ id }));
  const first = phones.phonePage(records, 1);
  assert.equal(first.items.length, 50);
  assert.equal(first.totalPages, 200);
  const last = phones.phonePage(records, 999);
  assert.equal(last.page, 200);
  assert.equal(last.items[49].id, 9999);
  const afterDelete = phones.phonePage(records.slice(0, 50), 2);
  assert.equal(afterDelete.page, 1);
  assert.equal(afterDelete.items.length, 50);
  assert.deepEqual(phones.phonePage([], 5), { items: [], page: 1, totalPages: 1, total: 0 });
});

test("分页拒绝非数字或负页码，保留源数组", () => {
  assert.equal(typeof phones.phonePage, "function");
  const records = [{ id: 1 }];
  for (const page of [NaN, Infinity, -1, 0]) assert.equal(phones.phonePage(records, page).page, 1);
  assert.equal(records.length, 1);
});

test("全局搜索先匹配完整数据再限制渲染，末尾号码可找到", async () => {
  const { commandResults } = await import("../src/lib/command-results.mjs");
  const entries = Array.from({ length: 10000 }, (_, index) => ({
    id: `phone-${index}`,
    label: `号码 ${index}`,
    search: `phone-${index} +44 7700 ${String(index).padStart(6, "0")}`,
  }));
  const groups = [{ heading: "资产", entries }];
  const initial = commandResults(groups, "");
  assert.equal(initial.sections[0].entries.length, 60);
  assert.equal(initial.total, 10000);
  assert.equal(initial.shown, 60);
  const found = commandResults(groups, "447700009999");
  assert.deepEqual(
    found.sections[0].entries.map((item) => item.id),
    ["phone-9999"],
  );
  assert.equal(groups[0].entries.length, 10000);
});

test("搜索匹配中英文、多关键词和全角字符，并去掉空分组", async () => {
  const { commandResults } = await import("../src/lib/command-results.mjs");
  const groups = [
    { heading: "页面", entries: [{ id: "page", label: "号码管理", search: "号码管理 页面" }] },
    {
      heading: "资产",
      entries: [
        { id: "claude", label: "Claude 工作账号", search: "Claude 工作账号 a@example.test" },
      ],
    },
  ];
  assert.equal(commandResults(groups, "ＣＬＡＵＤＥ example").sections[0].entries[0].id, "claude");
  assert.equal(commandResults(groups, "号码").sections[0].entries[0].id, "page");
  assert.equal(commandResults(groups, "没有这个数据").total, 0);
});

test("同名结果保留独立身份，跨分组总渲染数量受限", async () => {
  const { commandResults } = await import("../src/lib/command-results.mjs");
  const groups = ["一", "二", "三"].map((heading, group) => ({
    heading,
    entries: Array.from({ length: 30 }, (_, i) => ({
      id: `${group}-${i}`,
      label: "同名",
      search: "同名",
    })),
  }));
  const result = commandResults(groups, "同名");
  assert.equal(result.total, 90);
  assert.equal(result.shown, 60);
  assert.equal(
    new Set(result.sections.flatMap((group) => group.entries.map((item) => item.id))).size,
    60,
  );
});
