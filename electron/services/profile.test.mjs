import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileService } from "./profile.mjs";

const avatar =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

async function fixture(t, exists = true, normalizeImage) {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-profile-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "profile.json");
  let creates = 0;
  const vault = {
    status: async () => ({ exists }),
    create: async () => {
      creates++;
      exists = true;
    },
    unlock: async () => {},
  };
  return { file, service: new ProfileService(file, vault, normalizeImage), creates: () => creates };
}

test("个人资料兼容旧文件，头像替换后重启保留，重命名不会清空头像", async (t) => {
  const { service, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ name: "原名字" }));
  assert.equal((await service.get()).avatarDataUrl, "");
  await service.save({ name: "新名字", avatarDataUrl: avatar });
  await service.save({ name: "再次改名" });
  const fresh = new ProfileService(file, { status: async () => ({ exists: true }) });
  assert.equal((await fresh.get()).avatarDataUrl, avatar);
  assert.equal((await fresh.get()).name, "再次改名");
  await fresh.save({ name: "再次改名", avatarDataUrl: "" });
  assert.equal((await fresh.get()).avatarDataUrl, "");
});

test("拒绝非法头像且不覆盖原资料，失败后仍能继续保存", async (t) => {
  const { service, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ name: "原名字", avatarDataUrl: avatar }));
  await assert.rejects(
    service.save({ name: "新名字", avatarDataUrl: "https://example.com/avatar.png" }),
  );
  assert.equal(JSON.parse(await readFile(file, "utf8")).name, "原名字");
  await service.save({ name: "修改成功" });
  assert.equal((await service.get()).name, "修改成功");
});

test("首次设置先校验头像再创建密钥库，主密码不写入个人资料", async (t) => {
  const { service, file, creates } = await fixture(t, false);
  await assert.rejects(
    service.save({
      name: "初次使用",
      password: "test-secret-123",
      avatarDataUrl: "data:image/svg+xml,<svg/>",
    }),
  );
  assert.equal(creates(), 0);
  await service.save({ name: "初次使用", password: "test-secret-123", avatarDataUrl: avatar });
  assert.equal(creates(), 1);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved, { name: "初次使用", avatarDataUrl: avatar });
});

test("损坏的历史头像不会阻止读取姓名和解锁状态", async (t) => {
  const { service, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ name: "保留资料", avatarDataUrl: "file:///private.png" }));
  assert.deepEqual(await service.get(), {
    name: "保留资料",
    avatarDataUrl: "",
    ready: true,
    vaultExists: true,
  });
});

test("个人资料保存执行注入的主进程图片解码校验", async (t) => {
  const { service, file } = await fixture(t, true, (value) => {
    if (!value) return "";
    throw new Error("image decode failed");
  });
  await writeFile(file, JSON.stringify({ name: "原名字" }));
  await assert.rejects(service.save({ name: "失败修改", avatarDataUrl: avatar }), /decode/);
  assert.equal((await service.get()).name, "原名字");
});

test("主身份同步只覆盖展示，本地昵称头像草稿在关闭同步后恢复", async (t) => {
  const { service, file } = await fixture(t);
  const identity = {
    connected: true,
    profile: { name: "论坛昵称", username: "forum" },
    syncName: true,
    syncAvatar: true,
    avatarDataUrl: avatar,
  };
  service.setIdentitySource({
    get: async () => structuredClone(identity),
    preferences: async (value) => Object.assign(identity, value),
  });
  await writeFile(file, JSON.stringify({ name: "本地昵称", avatarDataUrl: "" }));
  assert.equal((await service.get()).name, "论坛昵称");
  await service.save({ name: "论坛昵称", avatarDataUrl: avatar });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    name: "本地昵称",
    avatarDataUrl: "",
  });
  assert.equal(identity.syncName, true);
  assert.equal(identity.syncAvatar, true);
  identity.syncName = false;
  identity.syncAvatar = false;
  assert.equal((await service.get()).name, "本地昵称");
  assert.equal((await service.get()).avatarDataUrl, "");
});

test("编辑昵称或头像只关闭该项同步，保留另一项与主身份", async (t) => {
  const { service, file } = await fixture(t);
  const identity = {
    connected: true,
    profile: { name: "论坛昵称", username: "forum" },
    syncName: true,
    syncAvatar: true,
    avatarDataUrl: avatar,
  };
  service.setIdentitySource({
    get: async () => structuredClone(identity),
    preferences: async (value) => Object.assign(identity, value),
  });
  await writeFile(file, JSON.stringify({ name: "本地昵称", avatarDataUrl: "" }));
  await service.save({ name: "自定义昵称" });
  assert.equal(identity.syncName, false);
  assert.equal(identity.syncAvatar, true);
  assert.equal((await service.get()).mainIdentity.profile.username, "forum");
  await service.save({ name: "自定义昵称", avatarDataUrl: "" });
  assert.equal(identity.syncAvatar, false);
});

test("首次绑定身份不会假装密钥库已就绪，身份解密失败仍可使用本机资料", async (t) => {
  const { service, creates } = await fixture(t, false);
  const identity = {
    connected: true,
    profile: { name: "论坛昵称" },
    syncName: true,
    syncAvatar: false,
  };
  service.setIdentitySource({ get: async () => identity, preferences: async () => {} });
  assert.equal((await service.get()).ready, false);
  await service.save({ name: "论坛昵称", password: "test-password-123" });
  assert.equal(creates(), 1);
  assert.equal((await service.get()).ready, true);
  service.setIdentitySource({
    get: async () => {
      throw new Error("OS key unavailable");
    },
  });
  const recovered = await service.get();
  assert.equal(recovered.mainIdentity, null);
  assert.equal(recovered.vaultExists, true);
});

test("旧密钥库存在但本地资料缺失时，绑定主身份不能跳过主密码确认", async (t) => {
  const { service } = await fixture(t, true);
  service.setIdentitySource({
    get: async () => ({ profile: { name: "论坛昵称" }, syncName: true, syncAvatar: false }),
  });
  const current = await service.get();
  assert.equal(current.name, "论坛昵称");
  assert.equal(current.ready, false);
  assert.equal(current.vaultExists, true);
});
