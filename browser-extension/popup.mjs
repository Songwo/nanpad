import { normalizeCapture, captureUrl } from "./browser-capture.mjs";
import { collectLoginForms } from "./form-capture.mjs";

const bridge = "http://127.0.0.1:47832";
const chrome = globalThis.chrome;
const tokenKey = "nanpadConnectionToken";
const $ = (selector) => document.querySelector(selector);
const title = $("#title");
const username = $("#username");
const password = $("#password");
const status = $("#status");
const send = $("#send");
const pairing = $("#pairing");
let capture = null;
let tabId;
let token = "";
let connected = false;
let busy = false;
let candidates = [];

function message(text, state = "") {
  status.textContent = text;
  status.dataset.state = state;
}
function controls() {
  send.disabled = busy || !capture || !connected;
  $("#refresh").disabled = busy || !capture;
  $("#site-only").disabled = busy || !capture;
  $("#pair-button").disabled = busy;
  $("#disconnect").disabled = busy;
}
function connection(text, state = "") {
  $("#connection-state").textContent = text;
  $("#connection-indicator").dataset.state = state;
  $("#disconnect").hidden = !token;
  pairing.hidden = connected;
  controls();
}
async function forgetConnection() {
  token = "";
  connected = false;
  await chrome.storage.session.remove(tokenKey);
  pairing.hidden = false;
  pairing.open = true;
}
async function request(path, options = {}, authenticated = true) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${bridge}${path}`, {
      ...options,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.status === 401) {
      await forgetConnection();
      connection("连接已失效，请重新配对", "error");
      throw new Error("请在已解锁的司南桌面端生成新的配对码。");
    }
    if (response.status === 423) {
      await forgetConnection();
      connection("密钥库已锁定", "error");
      throw new Error("请解锁司南，再生成新的配对码连接。");
    }
    if (response.status === 429) throw new Error("操作过于频繁，请稍后再试。");
    if (!response.ok)
      throw new Error(
        path === "/v1/pair"
          ? "配对码无效或已过期，请在桌面端重新生成。"
          : "桌面端未接收，请检查待确认记录或重新连接。",
      );
    return await response.json();
  } catch (error) {
    if (error instanceof TypeError || error.name === "AbortError") {
      connected = false;
      connection("桌面端未连接", "error");
      throw new Error("无法连接司南，请打开 0.7.0 或更新版本并解锁。请求未自动重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function hidePassword() {
  password.type = "password";
  $("#toggle-password").setAttribute("aria-pressed", "false");
  $("#toggle-password").setAttribute("aria-label", "显示密码");
  $("#toggle-password").title = "显示密码";
  $("#toggle-password img").src = "icons/eye.svg";
}
function choose(index) {
  const candidate = candidates[index];
  username.value = candidate?.username || "";
  password.value = candidate?.password || "";
  hidePassword();
  if (candidate?.oversized)
    message("表单字段超过支持长度，已留空；账号上限 320 字符，密码上限 4096 字符。", "error");
}
function showCandidates(records) {
  candidates = Array.isArray(records) ? records.slice(0, 8) : [];
  const choices = $("#choices");
  choices.replaceChildren();
  $("#form-choices").hidden = candidates.length < 2;
  candidates.forEach((candidate, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "selected-form";
    radio.value = String(index);
    radio.checked = index === 0;
    radio.addEventListener("change", () => choose(index));
    const name = document.createElement("span");
    name.textContent = candidate.username || `表单 ${index + 1}`;
    const kind = document.createElement("small");
    kind.textContent = candidate.kind === "new" ? "注册 / 新密码" : "登录";
    label.append(radio, name, kind);
    choices.append(label);
  });
  choose(0);
  $("#capture-hint").textContent = candidates.length
    ? `已读取 ${candidates.length} 个表单`
    : "手动填写";
}
async function readTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const previousUrl = capture?.url;
  capture = normalizeCapture(tab);
  tabId = tab.id;
  if (previousUrl !== capture.url || !title.value.trim()) title.value = capture.title;
  $("#url").textContent = capture.url;
  $("#url").title = capture.url;
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: collectLoginForms,
    });
    showCandidates(result);
    if (!candidates[0]?.oversized)
      message(
        candidates.length
          ? "请核对账号密码，再发送到司南。"
          : "未找到可读取的登录表单，可以手动填写账号密码。",
      );
  } catch {
    showCandidates([]);
    message("浏览器限制了此页的表单访问，可以手动填写账号密码。");
  }
}
async function currentCapture() {
  const tab = await chrome.tabs.get(tabId);
  const current = normalizeCapture(tab);
  if (current.url !== capture?.url) throw new Error("当前网页已切换站点，请重新读取后核对账号。");
  return { ...current, title: title.value.trim() || current.title };
}
$("#refresh").addEventListener("click", async () => {
  busy = true;
  controls();
  try {
    await readTab();
  } catch {
    capture = null;
    showCandidates([]);
    message("请在 HTTP 或 HTTPS 网站中打开插件。", "error");
  } finally {
    busy = false;
    controls();
  }
});
$("#toggle-password").addEventListener("click", () => {
  const reveal = password.type === "password";
  password.type = reveal ? "text" : "password";
  const label = reveal ? "隐藏密码" : "显示密码";
  $("#toggle-password").setAttribute("aria-pressed", String(reveal));
  $("#toggle-password").setAttribute("aria-label", label);
  $("#toggle-password").title = label;
  $("#toggle-password img").src = reveal ? "icons/eye-off.svg" : "icons/eye.svg";
});
$("#pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  busy = true;
  controls();
  try {
    const { token: nextToken } = await request(
      "/v1/pair",
      { method: "POST", body: JSON.stringify({ code: $("#pair-code").value.trim() }) },
      false,
    );
    if (typeof nextToken !== "string" || nextToken.length < 32 || nextToken.length > 256)
      throw new Error("桌面端返回的连接信息无效。");
    await chrome.storage.session.set({ [tokenKey]: nextToken });
    token = nextToken;
    $("#pair-code").value = "";
    const state = await request("/v1/status", { method: "POST", body: "{}" });
    if (!state.unlocked) throw new Error("请先解锁桌面端密钥库。");
    connected = true;
    pairing.open = false;
    connection("已连接本机司南", "connected");
    message("已配对，请核对后发送账号。", "success");
  } catch (error) {
    message(error.message, "error");
  } finally {
    busy = false;
    controls();
  }
});
$("#disconnect").addEventListener("click", async () => {
  await forgetConnection();
  connection("已断开桌面连接");
  message("已移除此浏览器会话的连接凭据。");
});
$("#capture").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!capture || !connected || busy) return;
  if (!username.value.trim() || !password.value) {
    message("请填写账号和密码；只保存网址请使用“仅记录站点并打开司南”。", "error");
    (!username.value.trim() ? username : password).focus();
    return;
  }
  busy = true;
  controls();
  try {
    const site = await currentCapture();
    const result = await request("/v1/captures", {
      method: "POST",
      body: JSON.stringify({ ...site, username: username.value.trim(), password: password.value }),
    });
    if (typeof result.id !== "string" || !result.id)
      throw new Error("未收到桌面接收确认，请先查看司南中的待确认记录。");
    candidates = [];
    password.value = "";
    $("#choices").replaceChildren();
    $("#form-choices").hidden = true;
    hidePassword();
    message("已送达司南，请在桌面端确认加密保存。", "success");
  } catch (error) {
    message(error.message, "error");
  } finally {
    busy = false;
    controls();
  }
});
$("#site-only").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: captureUrl(await currentCapture()) });
    message("已请求打开司南，请在桌面端继续记录站点。");
  } catch (error) {
    message(error.message || "无法打开司南，请安装桌面端并允许打开外部应用。", "error");
  }
});
window.addEventListener("pagehide", () => {
  candidates = [];
  password.value = "";
  $("#pair-code").value = "";
  token = "";
});

await Promise.allSettled([
  (async () => {
    try {
      await readTab();
    } catch {
      capture = null;
      message("请在 HTTP 或 HTTPS 网站中打开插件。", "error");
    } finally {
      controls();
    }
  })(),
  (async () => {
    try {
      const stored = await chrome.storage.session.get(tokenKey);
      token = typeof stored[tokenKey] === "string" ? stored[tokenKey] : "";
      if (!token) {
        pairing.open = true;
        connection("尚未连接桌面端");
        return;
      }
      const state = await request("/v1/status", { method: "POST", body: "{}" });
      if (!state.unlocked) {
        await forgetConnection();
        connection("请解锁桌面端", "error");
        return;
      }
      connected = true;
      connection("已连接本机司南", "connected");
    } catch (error) {
      connection("桌面连接不可用", "error");
      message(error.message, "error");
    }
  })(),
]);
