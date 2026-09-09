import { normalizeCapture, captureUrl } from "./browser-capture.mjs";

const form = document.querySelector("#capture");
const title = document.querySelector("#title");
const url = document.querySelector("#url");
const status = document.querySelector("#status");
const send = document.querySelector("#send");
let tabId;
try {
  const [tab] = await globalThis.chrome.tabs.query({ active: true, currentWindow: true });
  const capture = normalizeCapture(tab);
  tabId = tab.id;
  title.value = capture.title;
  url.value = capture.url;
  send.disabled = false;
} catch {
  status.textContent = "请在 HTTP 或 HTTPS 网站中打开插件。";
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  send.disabled = true;
  try {
    await globalThis.chrome.tabs.update(tabId, {
      url: captureUrl({ url: url.value, title: title.value }),
    });
    status.textContent = "已请求打开司南，请在桌面端确认保存。";
  } catch {
    status.textContent = "未能打开司南，请安装桌面端并允许浏览器打开外部应用。";
  } finally {
    send.disabled = false;
  }
});
