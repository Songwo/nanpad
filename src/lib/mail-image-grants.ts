/**
 * 邮件外部图片授权记忆（0.9.0）。
 * 按 Message-ID 记住用户允许加载外部图片的邮件，重开同一封邮件不再询问；
 * 存储在浏览器 localStorage，属界面偏好而非敏感数据，可在「设置 → 存储」清除。
 */
const IMAGE_GRANTS_KEY = "nanpad-mail-image-grants";
const MAX_GRANTS = 500;

export function readImageGrants(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMAGE_GRANTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(-MAX_GRANTS) : [];
  } catch {
    return [];
  }
}

export function writeImageGrants(grants: string[]) {
  try {
    localStorage.setItem(IMAGE_GRANTS_KEY, JSON.stringify(grants.slice(-MAX_GRANTS)));
  } catch {
    /* 存储不可用时授权退化为仅本次有效 */
  }
}

export function clearImageGrants() {
  try {
    localStorage.removeItem(IMAGE_GRANTS_KEY);
  } catch {
    /* 同上 */
  }
}

export function imageGrantCount(): number {
  return readImageGrants().length;
}
