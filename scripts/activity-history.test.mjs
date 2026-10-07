import test from "node:test";
import assert from "node:assert/strict";
import {
  activityDays,
  activityPage,
  localDateKey,
  retainActivity,
} from "../src/lib/activity-history.mjs";

const now = new Date(2026, 9, 6, 15, 0, 0);
const item = (id, at, kind = "server") => ({
  id,
  at: new Date(at).toISOString(),
  text: "测试活动",
  kind,
});

test("本地日期采用本机日历，不用 UTC 日期截断", () => {
  const local = new Date(2026, 9, 6, 0, 5);
  assert.equal(localDateKey(local.toISOString()), "2026-10-06");
  assert.equal(localDateKey("invalid"), "");
});

test("活动保留90个本地日期，移除未来、过期和无效记录", () => {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - 89);
  oldest.setHours(0, 0, 0, 0);
  const records = [
    item("boundary", oldest),
    item("expired", oldest.getTime() - 1),
    item("today", now),
    item("future", now.getTime() + 1),
    { id: "invalid", at: "bad", text: "旧数据", kind: "system" },
    null,
  ];
  assert.deepEqual(
    retainActivity(records, now).map((entry) => entry.id),
    ["today", "boundary"],
  );
  assert.equal(records.length, 6);
});

test("同ID保留最新事件，最多保留3000条且不更改旧内容", () => {
  const records = Array.from({ length: 3200 }, (_, index) =>
    item(`event-${index}`, now.getTime() - index * 1000),
  );
  records.push({
    ...records[0],
    at: new Date(now.getTime() - 5000).toISOString(),
    text: "更早同ID",
  });
  const kept = retainActivity(records, now);
  assert.equal(kept.length, 3000);
  assert.equal(kept[0].id, "event-0");
  assert.equal(kept[0].text, "测试活动");
  assert.equal(kept.at(-1).id, "event-2999");
  assert.equal(records.length, 3201);
});

test("近14天包含零活动日期，类别筛选只统计该类别", () => {
  const yesterday = new Date(2026, 9, 5, 23, 58);
  const records = [
    item("a", now),
    item("b", now, "domain"),
    item("c", yesterday),
    item("old", new Date(2026, 8, 1)),
  ];
  const days = activityDays(records, now);
  assert.equal(days.length, 14);
  assert.equal(days[0].date, "2026-09-23");
  assert.deepEqual(days.slice(-2), [
    { date: "2026-10-05", count: 1 },
    { date: "2026-10-06", count: 2 },
  ]);
  assert.equal(days[1].count, 0);
  assert.equal(activityDays(records, now, "domain").at(-1).count, 1);
});

test("已规范化活动保留数组引用，纯界面变化不引发资产快照写盘", () => {
  const records = [item("latest", now), item("previous", now.getTime() - 1000)];
  assert.equal(retainActivity(records, now), records);
});

test("明细先按本地日期和类别筛选再分页，超范围页回退", () => {
  const records = Array.from({ length: 45 }, (_, index) =>
    item(`event-${index}`, now.getTime() - index * 1000),
  );
  records.push(item("other-kind", now, "domain"), item("other-date", new Date(2026, 9, 5, 23, 59)));
  const page = activityPage(records, { date: "2026-10-06", kind: "server", page: 2 });
  assert.equal(page.total, 45);
  assert.equal(page.totalPages, 3);
  assert.equal(page.items.length, 20);
  assert.equal(page.items[0].id, "event-20");
  assert.equal(
    activityPage(records, { date: "2026-10-06", kind: "server", page: 99 }).items.length,
    5,
  );
  for (const page of [NaN, Infinity, -1, 0]) assert.equal(activityPage(records, { page }).page, 1);
  assert.deepEqual(activityPage(records, { date: "2026-01-01" }), {
    items: [],
    page: 1,
    totalPages: 1,
    total: 0,
  });
});
