import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectRaster,
  validateImageDataUrl,
  safeImageDataUrl,
  normalizeSnapshotImages,
  createImageNormalizer,
} from "./image-data.mjs";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const bytes = () => Buffer.from(png.split(",")[1], "base64");

test("发件人头像在快照导入、保存与恢复时验证，不影响账号原数据", () => {
  const mailbox = {
    id: "mail",
    folderId: "work",
    senderAvatars: [
      { address: "Team@example.test", imageDataUrl: png },
      { address: "bad@example.test", imageDataUrl: "https://tracker.example.test/pixel" },
    ],
  };
  assert.throws(() => normalizeSnapshotImages({ mailboxes: [mailbox] }));
  assert.deepEqual(
    normalizeSnapshotImages({ mailboxes: [mailbox] }, { strict: false }).mailboxes[0],
    {
      id: "mail",
      folderId: "work",
      senderAvatars: [{ address: "team@example.test", imageDataUrl: png }],
    },
  );
  const crowded = {
    mailboxes: [
      {
        senderAvatars: Array.from({ length: 33 }, (_, index) => ({
          address: `member${index}@example.test`,
          imageDataUrl: png,
        })),
      },
    ],
  };
  assert.throws(() => normalizeSnapshotImages(crowded), /32/);
  assert.equal(
    normalizeSnapshotImages(crowded, { strict: false }).mailboxes[0].senderAvatars.length,
    32,
  );
  assert.throws(
    () =>
      normalizeSnapshotImages({
        mailboxes: [{ senderAvatars: [{ address: "invalid", imageDataUrl: png }] }],
      }),
    /地址/,
  );
});

test("发件人头像总预算使用规范化后的图片计算", () => {
  const avatars = Array.from({ length: 9 }, (_, index) => ({
    address: `member${index}@example.test`,
    imageDataUrl: png,
  }));
  assert.throws(
    () =>
      normalizeSnapshotImages(
        { mailboxes: [{ senderAvatars: avatars }] },
        {
          normalize: () => "x".repeat(1024 * 1024),
        },
      ),
    /8 MiB/,
  );
});

test("图片校验兼容已有无图资产，接受小尺寸 PNG", () => {
  assert.equal(validateImageDataUrl(undefined), "");
  assert.equal(validateImageDataUrl(""), "");
  assert.equal(validateImageDataUrl(png), png);
  assert.deepEqual(inspectRaster(bytes(), "image/png"), { width: 1, height: 1 });
});

test("拒绝远程地址、SVG、伪装 MIME、截断和超大图片", () => {
  for (const value of [
    "https://example.com/avatar.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,PHN2Zy8+",
    png.slice(0, -8),
    png + "AAAA",
    "data:image/png;base64," + "A".repeat(1_400_000),
  ]) {
    assert.throws(() => validateImageDataUrl(value));
    assert.equal(safeImageDataUrl(value), "");
  }
  const tooWide = bytes();
  tooWide.writeUInt32BE(513, 16);
  assert.throws(
    () => validateImageDataUrl(`data:image/png;base64,${tooWide.toString("base64")}`),
    /512/,
  );
  tooWide.writeUInt32BE(100_000, 16);
  assert.throws(() => inspectRaster(tooWide, "image/png"), /8192/);
  assert.throws(() => inspectRaster(bytes(), "image/jpeg"), /格式/);
});

test("JPEG 与三类 WebP 文件头在解码前提取尺寸", () => {
  const jpeg = Buffer.from([
    255, 216, 255, 224, 0, 4, 1, 2, 255, 192, 0, 11, 8, 0, 24, 0, 32, 1, 1, 17, 0, 255, 217,
  ]);
  assert.deepEqual(inspectRaster(jpeg, "image/jpeg"), { width: 32, height: 24 });
  for (const type of ["VP8X", "VP8L", "VP8 "]) {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0);
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8);
    webp.write(type, 12);
    if (type === "VP8X") {
      webp[24] = 31;
      webp[27] = 23;
    } else if (type === "VP8L") {
      webp[20] = 47;
      webp[21] = 31;
      webp[22] = 192;
      webp[23] = 5;
    } else {
      webp[23] = 157;
      webp[24] = 1;
      webp[25] = 42;
      webp.writeUInt16LE(32, 26);
      webp.writeUInt16LE(24, 28);
    }
    assert.deepEqual(inspectRaster(webp, "image/webp"), { width: 32, height: 24 });
  }
});

test("导入原子拒绝危险图片，旧文件加载只去掉坏图", () => {
  const input = {
    version: 0,
    state: {
      aiAssets: [
        { id: "a", imageDataUrl: png },
        { id: "b", imageDataUrl: "javascript:alert(1)", notes: "保留资料" },
      ],
    },
  };
  assert.throws(() => normalizeSnapshotImages(input));
  assert.equal(input.state.aiAssets[1].imageDataUrl, "javascript:alert(1)");
  assert.deepEqual(normalizeSnapshotImages(input, { strict: false }), {
    version: 0,
    state: {
      aiAssets: [
        { id: "a", imageDataUrl: png },
        { id: "b", notes: "保留资料" },
      ],
    },
  });
});

test("大量资产和包装快照均保留图片与非图片字段", () => {
  const input = {
    servers: Array.from({ length: 1000 }, (_, index) => ({
      id: String(index),
      imageDataUrl: png,
      tags: ["生产"],
    })),
    links: [],
  };
  assert.deepEqual(normalizeSnapshotImages(input), input);
  assert.deepEqual(normalizeSnapshotImages({ state: input, version: 0 }), {
    state: input,
    version: 0,
  });
});

test("主进程图片解码失败会阻止保存，同图重复保存复用校验", () => {
  const fail = createImageNormalizer({ createFromDataURL: () => ({ isEmpty: () => true }) });
  assert.throws(() => fail(png), /解码/);
  let decoded = 0;
  const normalize = createImageNormalizer({
    createFromDataURL: () => {
      decoded++;
      return { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: bytes };
    },
  });
  assert.equal(normalize(png), png);
  assert.equal(normalize(png), png);
  assert.equal(decoded, 1);
});
