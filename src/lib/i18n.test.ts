import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { t, getLocale, setLocale, resolveLocale, subscribeLocale, intlLocale } from "./i18n.ts";
import { formatDate, formatUsd } from "./utils.ts";

afterEach(() => setLocale("zh"));
test("语言通知只在改变时触发，取消订阅后停止", () => {
  let count = 0;
  const off = subscribeLocale(() => count++);
  setLocale("en");
  setLocale("en");
  assert.equal(count, 1);
  assert.equal(getLocale(), "en");
  off();
  setLocale("zh");
  assert.equal(count, 1);
});
test("英文翻译替换参数并保留未知键", () => {
  setLocale("en");
  assert.equal(t("{0} 天", 4), "4d");
  assert.equal(t("unknown {0}", "value"), "unknown value");
  assert.equal(t("unknown {1}", "value"), "unknown {1}");
});
test("终端翻译保留 ANSI 并统一 CRLF", () => {
  setLocale("en");
  assert.equal(t("\r\n\u001b[2m连接已关闭。\u001b[0m"), "\n\u001b[2mConnection closed.\u001b[0m");
  assert.equal(
    t("\u001b[2m正在连接 {0}@{1}:{2} …\u001b[0m", "user", "host", 22),
    "\u001b[2mConnecting to user@host:22 …\u001b[0m",
  );
});
test("日期和金额跟随语言，不把无效日期传入 Intl", () => {
  setLocale("en");
  assert.equal(intlLocale(), "en-US");
  assert.equal(formatUsd(20), "$20");
  assert.equal(formatDate("2026-09-07T12:00:00Z"), "09/07/2026");
  assert.equal(formatDate("invalid"), "-");
  assert.equal(resolveLocale("zh"), "zh");
  assert.equal(resolveLocale("en"), "en");
});
