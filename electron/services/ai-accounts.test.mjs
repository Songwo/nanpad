import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiAccounts, AI_PROVIDERS, normalizeUsage } from "./ai-accounts.mjs";
import { ProfileService } from "./profile.mjs";
import { Vault } from "./vault.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new Vault(join(directory, "vault.enc"));
  const profile = new ProfileService(join(directory, "profile.json"), vault);
  return { directory, vault, profile };
}
test("首次设置创建加密库，升级时使用原密码且保留凭据", async (t) => {
  const { directory, vault, profile } = await fixture(t);
  assert.equal((await profile.get()).ready, false);
  await assert.rejects(profile.save({ name: "用户", password: "short" }), /10/);
  await profile.save({ name: "  测试用户  ", password: "test-master-long" });
  assert.equal((await profile.get()).name, "测试用户");
  await vault.set("keep", { password: "private-test-only" });
  assert.ok(!(await readFile(join(directory, "profile.json"), "utf8")).includes("test-master"));
  assert.ok(!(await readFile(join(directory, "vault.enc"), "utf8")).includes("private-test-only"));
  await rm(join(directory, "profile.json"));
  vault.lock();
  await assert.rejects(profile.save({ name: "升级用户", password: "incorrect" }), /不正确/);
  await profile.save({ name: "升级用户", password: "test-master-long" });
  assert.deepEqual(await vault.get("keep"), { password: "private-test-only" });
  vault.lock();
  await profile.save({ name: "改名" });
  assert.equal((await profile.get()).name, "改名");
  await assert.rejects(profile.save({ name: " " }), /姓名/);
});
test("损坏的密钥库不得被首次设置覆盖", async (t) => {
  const { directory, profile } = await fixture(t);
  await writeFile(join(directory, "vault.enc"), "invalid-json");
  await assert.rejects(profile.save({ name: "用户", password: "test-master-long" }), /读取失败/);
  assert.equal(await readFile(join(directory, "vault.enc"), "utf8"), "invalid-json");
});
for (const provider of Object.keys(AI_PROVIDERS)) {
  test(`${provider}: PKCE、回调校验、加密存储、刷新及用量`, async (t) => {
    const { vault, profile, directory } = await fixture(t);
    await profile.save({ name: "OAuth 测试", password: "test-master-long" });
    let opened;
    const requests = [];
    const claims = {
      sub: "test-user",
      email: "qa@example.test",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "test-account",
        chatgpt_plan_type: "plus",
      },
    };
    const idToken = `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x`;
    const p = { ...AI_PROVIDERS[provider] };
    if (p.mode === "loopback") p.redirect = "http://127.0.0.1:0/callback";
    const service = new AiAccounts({
      vault,
      providers: { [provider]: p },
      openExternal: async (url) => {
        opened = new URL(url);
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        let body;
        if (url === p.token)
          body = {
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 1,
            id_token: idToken,
            account: { uuid: "test-claude", email_address: "qa@example.test" },
          };
        else if (url === p.userinfo) body = { sub: "test-user", email: "qa@example.test" };
        else if (url === p.profile)
          body = { cloudaicompanionProject: "test-project", currentTier: { name: "Free" } };
        else
          body =
            provider === "openai"
              ? {
                  plan_type: "plus",
                  rate_limit: { primary_window: { used_percent: 25, reset_at: 1800000000 } },
                }
              : provider === "claude"
                ? { five_hour: { utilization: 25, resets_at: "2026-09-08T00:00:00Z" } }
                : provider === "grok"
                  ? {
                      config: {
                        creditUsagePercent: 25,
                        currentPeriod: { end: "2026-09-08T00:00:00Z" },
                      },
                    }
                  : {
                      buckets: [
                        {
                          modelId: "gemini-pro",
                          remainingFraction: 0.75,
                          resetTime: "2026-09-08T00:00:00Z",
                        },
                      ],
                    };
        return new Response(JSON.stringify(body));
      },
    });
    t.after(() => service.stop());
    const session = await service.start(provider);
    assert.equal(opened.searchParams.get("code_challenge_method"), "S256");
    assert.ok(opened.searchParams.get("code_challenge").length >= 43);
    await assert.rejects(service.finish(session.id, "code#wrong"), /不匹配/);
    assert.equal(requests.length, 0);
    if (p.mode === "loopback") {
      const callback = new URL(opened.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", "wrong");
      callback.searchParams.set("code", "code");
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set("state", opened.searchParams.get("state"));
      assert.equal((await fetch(callback)).status, 200);
      for (let i = 0; i < 100 && service.status(session.id).status !== "connected"; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
    } else await service.finish(session.id, `code#${opened.searchParams.get("state")}`);
    assert.equal(service.status(session.id).status, "connected");
    const [account] = await service.list();
    assert.ok(!JSON.stringify(account).includes("test-access-token"));
    assert.ok(
      !(await readFile(join(directory, "vault.enc"), "utf8")).includes("test-refresh-token"),
    );
    await assert.rejects(service.finish(session.id, "code#again"), /已结束/);
    const updated = await service.refresh(account.id);
    assert.equal(updated.usage.windows[0].usedPercent, 25);
    assert.equal(updated.subscriptionExpiresAt, null);
    assert.equal(requests.filter((req) => req.url === p.token).length, 2);
    assert.ok(requests.every((req) => req.options.redirect === "error"));
    await service.remove(account.id);
    assert.deepEqual(await service.list(), []);
    await assert.rejects(service.remove("ssh:private"), /无效/);
    vault.lock();
    await assert.rejects(service.start(provider), /解锁/);
  });
}
test("取消及服务异常不会保存令牌或泄漏响应正文", async (t) => {
  const { vault, profile } = await fixture(t);
  await profile.save({ name: "用户", password: "test-master-long" });
  let url;
  const service = new AiAccounts({
    vault,
    openExternal: async (value) => {
      url = new URL(value);
    },
    fetchImpl: async () => new Response("private-token", { status: 401 }),
  });
  t.after(() => service.stop());
  const session = await service.start("claude");
  await assert.rejects(
    service.finish(session.id, `code#${url.searchParams.get("state")}`),
    (error) => error.message.includes("401") && !error.message.includes("private-token"),
  );
  assert.deepEqual(await service.list(), []);
  const cancelled = await service.start("claude");
  service.cancel(cancelled.id);
  await assert.rejects(service.finish(cancelled.id, "code#state"), /已结束/);
  await assert.rejects(service.start("__proto__"), /不支持/);
});
test("缺失额度不转成零用量，错误日期不展示", () => {
  assert.deepEqual(normalizeUsage("openai", {}).windows, []);
  assert.equal(
    normalizeUsage("claude", { five_hour: { utilization: 0, resets_at: "invalid" } }).windows[0]
      .resetsAt,
    null,
  );
});
