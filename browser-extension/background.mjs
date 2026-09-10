// 后台服务：接收内容脚本的自动采集并转发到本机司南。
// 令牌保存在 chrome.storage.session，只存在于扩展上下文（弹窗 / 后台服务），
// 永不进入网页；内容脚本因此也不能直接请求桥接（来源校验会拒绝网页来源）。
import { BRIDGE } from "./bridge-config.mjs";
import { normalizeCapture } from "./browser-capture.mjs";

const chrome = globalThis.chrome;
const tokenKey = "nanpadConnectionToken";

async function forward(capture) {
  const stored = await chrome.storage.session.get(tokenKey);
  const token = stored[tokenKey];
  if (typeof token !== "string" || !token) return { ok: false, reason: "unpaired" };
  let site;
  try {
    site = normalizeCapture({ url: capture.url, title: capture.title });
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${BRIDGE}/v1/captures`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...site,
        username: capture.username,
        password: capture.password,
        source: "auto",
      }),
    });
    if (response.status === 401) {
      await chrome.storage.session.remove(tokenKey);
      return { ok: false, reason: "unpaired" };
    }
    if (response.status === 423) return { ok: false, reason: "locked" };
    if (response.status === 429) return { ok: false, reason: "rate" };
    if (!response.ok) return { ok: false, reason: "rejected" };
    const result = await response.json().catch(() => null);
    if (typeof result?.id !== "string" || !result.id) return { ok: false, reason: "rejected" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "offline" };
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "nanpad-auto-capture") return false;
  void forward(message.capture).then(sendResponse);
  return true;
});
