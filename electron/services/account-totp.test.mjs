import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountTotp } from "./account-totp.mjs";
import { Vault } from "./vault.mjs";

const MASTER = "totp-test-master";
const ACCOUNT = "account-one";
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function encode(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0,
    bits = 0,
    output = "";
  for (const value of bytes) {
    buffer = (buffer << 8) | value;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

const uri = (secret = SEED, query = {}) =>
  `otpauth://totp/Example%3Amember%40example.test?${new URLSearchParams({ secret, issuer: "Example", ...query })}`;

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-totp-test-"));
  const file = join(directory, "vault.enc");
  const vault = new Vault(file);
  await vault.create(MASTER);
  const context = {
    vault,
    file,
    assets: {
      secrets: [
        { id: ACCOUNT, kind: "account" },
        { id: "api-one", kind: "api" },
      ],
    },
    now: 59000,
  };
  context.service = new AccountTotp({
    vault,
    getAssets: () => (options.getAssets ? options.getAssets(context) : context.assets),
    now: () => context.now,
  });
  t.after(async () => {
    vault.lock();
    await rm(directory, { recursive: true, force: true });
  });
  return context;
}

test("RFC 6238 官方六组时间向量在 SHA1、SHA256、SHA512 下均一致", async (t) => {
  const ctx = await fixture(t);
  const vectors = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [index, algorithm, length] of [
    [1, "SHA1", 20],
    [2, "SHA256", 32],
    [3, "SHA512", 64],
  ]) {
    const secret = encode(Buffer.from("1234567890".repeat(7).slice(0, length)));
    await ctx.service.configure({
      assetId: ACCOUNT,
      secret: uri(secret, { algorithm, digits: "8" }),
    });
    for (const vector of vectors) {
      ctx.now = vector[0] * 1000;
      const result = await ctx.service.code(ACCOUNT);
      assert.equal(result.code, vector[index], `${algorithm} at ${vector[0]}`);
      assert.equal(result.period, 30);
      assert.equal(result.expiresAt, (Math.floor(vector[0] / 30) + 1) * 30000);
      assert.ok(result.remaining > 0 && result.remaining <= 30);
    }
  }
});

test("Base32 粘贴自动规整，DTO 和明文文件均不泄露种子", async (t) => {
  const ctx = await fixture(t);
  assert.deepEqual(await ctx.service.status(ACCOUNT), {
    configured: false,
    issuer: "",
    label: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  await assert.rejects(ctx.service.code(ACCOUNT), /尚未配置/);
  const configured = await ctx.service.configure({
    assetId: ACCOUNT,
    secret: " gezdg nbvg-y3tq ojqg ezdg nbvg y3tq ojq ",
  });
  assert.deepEqual(configured, {
    configured: true,
    issuer: "",
    label: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  const code = await ctx.service.code(ACCOUNT);
  assert.equal(code.code, "287082");
  assert.equal(code.expiresAt, 60000);
  assert.equal(code.remaining, 1);
  assert.doesNotMatch(JSON.stringify(configured) + JSON.stringify(code), /secret|seed|GEZDG/);
  assert.equal((await ctx.vault.get(`totp:${ACCOUNT}`)).secret, SEED);
  assert.equal(await ctx.vault.get(`account:${ACCOUNT}`), null);
  assert.doesNotMatch(await readFile(ctx.file, "utf8"), /GEZDG|287082/);
});

test("导入链接保留服务商和账号标签，支持六/八位及 15–120 秒周期", async (t) => {
  const ctx = await fixture(t);
  const configured = await ctx.service.configure({
    assetId: ACCOUNT,
    secret: uri(SEED, { period: "60", digits: "8", algorithm: "sha256" }),
  });
  assert.deepEqual(configured, {
    configured: true,
    issuer: "Example",
    label: "member@example.test",
    algorithm: "SHA256",
    digits: 8,
    period: 60,
  });
  assert.equal((await ctx.service.code(ACCOUNT)).code.length, 8);
  ctx.now = 59999;
  const before = await ctx.service.code(ACCOUNT);
  assert.equal(before.remaining, 1);
  ctx.now = 60000;
  const after = await ctx.service.code(ACCOUNT);
  assert.equal(after.remaining, 60);
  assert.equal(after.expiresAt, 120000);
  assert.notEqual(after.code, before.code);
});

test("无效编码、重复参数、HOTP 或不支持算法被拒绝，不覆盖已有配置", async (t) => {
  const ctx = await fixture(t);
  await ctx.service.configure({ assetId: ACCOUNT, secret: SEED });
  for (const secret of [
    "123456",
    "A".repeat(500),
    "A".repeat(17),
    "ABCDEFGHIJKLMNOPQRSTUVWXY9",
    "MY=====",
    "AAAAAAAAAAAAAAAAAB",
    uri().replace("otpauth://totp", "otpauth://hotp"),
    uri() + "&secret=OTHER",
    uri() + "&counter=1",
    uri(SEED, { algorithm: "MD5" }),
    uri(SEED, { digits: "7" }),
    uri(SEED, { period: "0" }),
    uri(SEED, { period: "121" }),
    uri(SEED, { period: "3e1" }),
    uri(SEED, { issuer: "Other" }),
    uri() + "#fragment",
    "otpauth://totp/%E0%A4?secret=" + SEED,
  ])
    await assert.rejects(ctx.service.configure({ assetId: ACCOUNT, secret }));
  assert.equal((await ctx.service.status(ACCOUNT)).algorithm, "SHA1");
  assert.equal((await ctx.service.code(ACCOUNT)).code, "287082");
});

test("只有已保存的账号可配置和读取验证码，删除可清理遗留记录", async (t) => {
  const ctx = await fixture(t);
  for (const assetId of ["missing", "api-one", "", null, "a".repeat(201)]) {
    await assert.rejects(ctx.service.configure({ assetId, secret: SEED }));
    await assert.rejects(ctx.service.status(assetId));
    await assert.rejects(ctx.service.code(assetId));
  }
  await ctx.service.configure({ assetId: ACCOUNT, secret: SEED });
  ctx.assets.secrets = [];
  await assert.rejects(ctx.service.code(ACCOUNT), /已保存/);
  await ctx.service.remove(ACCOUNT);
  assert.equal(await ctx.vault.get(`totp:${ACCOUNT}`), null);
});

test("锁库立即拒绝验证码，跨锁库代次的配置不能落盘", async (t) => {
  const ctx = await fixture(t);
  await ctx.service.configure({ assetId: ACCOUNT, secret: SEED });
  ctx.vault.lock();
  await assert.rejects(ctx.service.status(ACCOUNT), /锁定/);
  await assert.rejects(ctx.service.code(ACCOUNT), /锁定/);
  await assert.rejects(ctx.service.configure({ assetId: ACCOUNT, secret: SEED }), /锁定/);
  await assert.rejects(ctx.service.remove(ACCOUNT), /锁定/);
  await ctx.vault.unlock(MASTER);
  assert.equal((await ctx.service.code(ACCOUNT)).code, "287082");
  const batch = ctx.vault.batch.bind(ctx.vault);
  ctx.vault.batch = (entries, options) => {
    ctx.vault.lock();
    return batch(entries, options);
  };
  await assert.rejects(
    ctx.service.configure({ assetId: ACCOUNT, secret: uri(SEED, { algorithm: "SHA512" }) }),
    /锁定/,
  );
  await ctx.vault.unlock(MASTER);
  assert.equal((await ctx.service.status(ACCOUNT)).algorithm, "SHA1");
});

test("异步资产校验跨锁库时不会生成验证码，异常不会带出种子", async (t) => {
  let resolveAssets;
  let delay = false;
  const ctx = await fixture(t, {
    getAssets: (ctx) =>
      delay
        ? new Promise((resolve) => {
            resolveAssets = () => resolve(ctx.assets);
          })
        : ctx.assets,
  });
  await ctx.service.configure({ assetId: ACCOUNT, secret: SEED });
  delay = true;
  const result = ctx.service.code(ACCOUNT);
  await new Promise((resolve) => setImmediate(resolve));
  ctx.vault.lock();
  resolveAssets();
  await assert.rejects(result, /锁定/);
  await ctx.vault.unlock(MASTER);
  delay = false;
  ctx.vault.get = async () => {
    throw new Error(`sensitive ${SEED}`);
  };
  await assert.rejects(ctx.service.code(ACCOUNT), (error) => {
    assert.doesNotMatch(error.message, /GEZDG|sensitive/);
    return true;
  });
});

test("系统时间非法时拒绝生成，正常删除后不再保留验证码配置", async (t) => {
  const ctx = await fixture(t);
  await ctx.service.configure({ assetId: ACCOUNT, secret: SEED });
  for (const stamp of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    ctx.now = stamp;
    await assert.rejects(ctx.service.code(ACCOUNT), /系统时间/);
  }
  await ctx.service.remove(ACCOUNT);
  assert.equal((await ctx.service.status(ACCOUNT)).configured, false);
  assert.equal(await ctx.vault.get(`totp:${ACCOUNT}`), null);
});
