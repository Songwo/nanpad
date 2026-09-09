import test from "node:test";

test("节点数量超限的邮件回退为文本，普通换行仍保留", () => {
  assert.equal(sanitizeMailHtml(`<div>${"<br>".repeat(200000)}</div>`), undefined);
  assert.match(sanitizeMailHtml("<div>第一段<br>第二段<hr></div>"), /<br\s*\/?\s*>/);
});
import assert from "node:assert/strict";
import { sanitizeMailHtml, MAX_HTML_BYTES } from "./mail-content.mjs";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const picture = (overrides = {}) => ({
  contentId: "picture@example.test",
  contentType: "image/png",
  content: pixel,
  ...overrides,
});

test("HTML 保留标题、列表、表格及受限排版样式", () => {
  const value = sanitizeMailHtml(
    '<h2>项目更新</h2><p style="font-size:18px;font-weight:700;text-align:center;color:red;position:fixed;inset:0">本周<strong>交付</strong></p><ul><li>开发</li></ul><table><tr><th>任务</th><td colspan="2">验收</td></tr></table>',
  );
  assert.match(value, /<h2>项目更新<\/h2>/);
  assert.match(value, /<strong>交付<\/strong>/);
  assert.match(value, /font-size:18px/);
  assert.match(value, /text-align:center/);
  assert.match(value, /<td colspan="2">验收<\/td>/);
  assert.doesNotMatch(value, /position|inset|color:/);
});

test("脚本、事件、样式表、表单、嵌套页面和 SVG 都不能进入正文", () => {
  const value = sanitizeMailHtml(
    '<p onclick="steal()">正文</p><script>steal()</script><style>@import url(https://tracking.test/css)</style><iframe src="https://tracking.test/frame">iframe secret</iframe><form action="https://tracking.test"><input value="secret"><button>button secret</button></form><svg><image href="https://tracking.test/svg"></image><script>steal()</script></svg><math><mtext>math secret</mtext></math><object data="file:///private">object secret</object><img src="javascript:steal()" onerror="steal()">',
  );
  assert.match(value, /正文/);
  assert.doesNotMatch(
    value,
    /steal|secret|onclick|onerror|tracking\.test|<script|<style|<form|<iframe|<svg|<math/,
  );
});

test("外部图片只保留受控地址，不产生浏览器请求属性", () => {
  const value = sanitizeMailHtml(
    '<picture><source srcset="https://tracking.test/source 2x"><img src="https://tracking.test/pixel?recipient=owner" srcset="https://tracking.test/retina 2x" style="background-image:url(https://tracking.test/css)" data-mail-remote-src="https://attacker.test" alt="报告"></picture>',
  );
  assert.match(value, /data-mail-remote-src="https:\/\/tracking\.test\/pixel\?recipient=owner"/);
  assert.match(value, /alt="报告"/);
  assert.doesNotMatch(value, /\ssrc=|srcset=|source|background|attacker/);
  assert.doesNotMatch(
    sanitizeMailHtml('<img data-mail-remote-src="https://attacker.test">'),
    /attacker/,
  );
});

test("链接仅允许无内嵌凭据的 HTTP(S)，拒绝文件和脚本链接", () => {
  const value = sanitizeMailHtml(
    '<a href="https://docs.example.test/path?a=1&amp;b=2" target="_self">文档</a><a href="javascript:alert(1)">脚本</a><a href="file:///private">文件</a><a href="//tracking.test">协议</a><a href="https://user:password@example.test">凭据</a><a href="&#106;avascript:alert(1)">编码</a>',
  );
  assert.match(value, /href="https:\/\/docs\.example\.test\/path\?a=1&amp;b=2"/);
  assert.doesNotMatch(value, /javascript|file:|target=|tracking\.test|password/);
});

test("CID 图片匹配附件并校验栅格头，SVG 与类型伪装不能内联", () => {
  const value = sanitizeMailHtml(
    '<p>图片</p><img src="cid:picture%40example.test"><img src="cid:vector"><img src="cid:fake">',
    [
      picture(),
      picture({
        contentId: "vector",
        contentType: "image/svg+xml",
        content: Buffer.from('<svg onload="alert(1)"/>'),
      }),
      picture({ contentId: "fake", content: Buffer.from("<html>fake</html>") }),
    ],
  );
  assert.equal((value.match(/\ssrc=/g) ?? []).length, 1);
  assert.match(value, /src="data:image\/png;base64,iVBOR/);
  assert.doesNotMatch(value, /svg|onload|<html|cid:/);
});

test("未经 MIME 附件校验的 data 图片与相对路径不能成为图片源", () => {
  const value = sanitizeMailHtml(
    `<img src="data:image/png;base64,${pixel.toString("base64")}"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="file:///private"><img src="/pixel"><img src="https://user:password@tracking.test">`,
  );
  assert.doesNotMatch(value, /\ssrc=|data-mail-remote-src=|password|file:/);
});

test("内嵌图片按次数、单图与合计字节设上限，不能无限放大 HTML", () => {
  const repeated = sanitizeMailHtml('<img src="cid:picture@example.test">'.repeat(25), [picture()]);
  assert.equal((repeated.match(/\ssrc=/g) ?? []).length, 20);
  const largePixel = Buffer.concat([pixel, Buffer.alloc(1024 * 1024 - pixel.length)]);
  const total = sanitizeMailHtml('<img src="cid:picture@example.test">'.repeat(4), [
    picture({ content: largePixel }),
  ]);
  assert.equal((total.match(/\ssrc=/g) ?? []).length, 3);
  const oversized = sanitizeMailHtml('<img src="cid:picture@example.test">', [
    picture({ content: Buffer.concat([largePixel, Buffer.from([0])]) }),
  ]);
  assert.doesNotMatch(oversized, /\ssrc=/);
});

test("拒绝超大像素和超过 1 MiB 的 HTML，允许调用方继续显示纯文本", () => {
  const oversized = Buffer.from(pixel);
  oversized.writeUInt32BE(9000, 16);
  assert.doesNotMatch(
    sanitizeMailHtml('<img src="cid:picture@example.test">', [picture({ content: oversized })]),
    /\ssrc=/,
  );
  assert.equal(sanitizeMailHtml("a".repeat(MAX_HTML_BYTES + 1)), undefined);
  assert.equal(sanitizeMailHtml("文".repeat(Math.ceil(MAX_HTML_BYTES / 3))), undefined);
  assert.equal(sanitizeMailHtml(false), undefined);
  assert.equal(sanitizeMailHtml(""), undefined);
});

test("损坏的标签、编码属性和深层嵌套不能绕过净化", () => {
  const value = sanitizeMailHtml(
    '<DIV STYLE="position:fixed;background:url(https://tracking.test);font-weight:700"><a HREF="java&#x0a;script:alert(1)">链接</a><img SRC="https://tracking.test/a&quot; onerror=&quot;alert(1)" onerror="alert(1)"><p><b>保留</p></b></DIV>',
  );
  assert.match(value, /保留/);
  assert.doesNotMatch(value, /\ssrc=|\sonerror=|href="javascript|position:|background:/);
  assert.doesNotThrow(() => sanitizeMailHtml("<div>".repeat(200) + "end" + "</div>".repeat(200)));
});
