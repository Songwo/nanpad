import test from "node:test";
import assert from "node:assert/strict";
import { parseDocumentAccounts } from "./document-accounts.mjs";

test("明确字段块提取中英文标签，支持同一网站的多个账号", () => {
  const result = parseDocumentAccounts(
    "# 测试站点\n网址：https://example.test/login\n账号：alice@example.test\n密码：first-secret\n账号：bob@example.test\n密码：second-secret",
  );
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((row) => [row.id, row.username, row.password, row.url]),
    [
      ["candidate-1", "alice@example.test", "first-secret", "https://example.test/login"],
      ["candidate-2", "bob@example.test", "second-secret", "https://example.test/login"],
    ],
  );
  assert.deepEqual(result.warnings, []);
});

test("标准 Markdown 表格保留转义符、代码标记与行级网站", () => {
  const result = parseDocumentAccounts(
    "# 账号表\n| 网站 | username | password | 备注 |\n| --- | --- | --- | --- |\n| [网站](https://example.test/) | alice | `a\\|b` | 主账号 |\n| example.org | bob | exact!@#$ | 备用 |\n",
  );
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].password, "a|b");
  assert.equal(result.candidates[0].url, "https://example.test/");
  assert.equal(result.candidates[1].url, "https://example.org/");
  assert.equal(result.candidates[1].note, "备用");
});

test("嵌套标题继承网站，代码块和粗体标签按明确字段解析", () => {
  const result = parseDocumentAccounts(
    "# 网站\nhttps://example.test\n## 家庭账号\n**用户名**：alice\n**密码**：secret-1\n## 工作账号\n```text\nusername=bob\npassword=secret-2\n```\n# 另一个站点\n账号：carol\n密码：secret-3",
  );
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].name, "家庭账号");
  assert.equal(result.candidates[1].url, "https://example.test/");
  assert.equal(result.candidates[2].url, "");
  assert.ok(result.warnings.some((text) => text.includes("缺少")));
});

test("一行多个明确标签可以识别，不从叙述或 API Key 猜测密码", () => {
  assert.equal(
    parseDocumentAccounts("网址：https://example.test 账号：alice 密码：my-secret").candidates[0]
      .password,
    "my-secret",
  );
  for (const source of [
    "我的账号很多，密码应该在另一个地方。",
    "sk-this-is-an-api-key",
    "alice@example.test : maybe-a-password",
    "https://example.test",
  ])
    assert.equal(parseDocumentAccounts(source).candidates.length, 0);
});

test("缺字段与危险网址只形成待补全草稿，警告不回显秘密", () => {
  const result = parseDocumentAccounts(
    "用户名：alice\n密码：private-secret\n网址：https://user:password@example.test",
  );
  assert.equal(result.candidates[0].url, "");
  assert.equal(result.candidates[0].password, "private-secret");
  assert.ok(result.warnings.length);
  assert.doesNotMatch(result.warnings.join(""), /private-secret|user:password/);
  const partial = parseDocumentAccounts("账号：alice");
  assert.equal(partial.candidates[0].password, "");
  assert.ok(partial.warnings.length);
});

test("同名账号在不同站点不合并，候选上限和大小限制生效", () => {
  const result = parseDocumentAccounts(
    Array.from(
      { length: 55 },
      (_, index) =>
        `# 站点${index}\n网址：https://site${index}.test\n账号：alice\n密码：secret${index}`,
    ).join("\n\n"),
  );
  assert.equal(result.candidates.length, 50);
  assert.equal(result.candidates[49].id, "candidate-50");
  assert.ok(result.warnings.some((text) => text.includes("50")));
  assert.throws(() => parseDocumentAccounts("中".repeat(400000)), /1 MiB/);
  assert.throws(() => parseDocumentAccounts(null), /1 MiB/);
});

test("重复表格列与超长字段不静默覆盖或截断凭据", () => {
  const duplicate = parseDocumentAccounts(
    "| 账号 | password | 密码 |\n| --- | --- | --- |\n| alice | first | second |",
  );
  assert.equal(duplicate.candidates.length, 0);
  assert.ok(duplicate.warnings.some((text) => text.includes("重复")));
  const long = parseDocumentAccounts(`账号：alice\n密码：${"x".repeat(4097)}`);
  assert.equal(long.candidates[0].password, "");
  assert.ok(long.warnings.some((text) => text.includes("长度")));
});

test("密码中的 Markdown 星号或删除线不被悄悄删除", () => {
  const result = parseDocumentAccounts(
    "**账号**：alice\n**密码**：p*ss*word\n网址：https://example.test",
  );
  assert.equal(result.candidates[0].password, "p*ss*word");
  assert.ok(result.warnings.some((text) => text.includes("格式标记")));
  const code = parseDocumentAccounts("账号：alice\n密码：`p*ss*word`\n网址：https://example.test");
  assert.equal(code.candidates[0].password, "p*ss*word");
});
