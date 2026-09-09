import type { Mailbox } from "./types.ts";

export interface MailFolder {
  id: string;
  name: string;
  color: "green" | "blue" | "rose" | "amber";
}
export const DEFAULT_MAIL_FOLDERS: MailFolder[] = [
  { id: "work", name: "工作邮箱", color: "blue" },
  { id: "personal", name: "生活邮箱", color: "green" },
];
export function normalizeMailFolders(input: unknown): MailFolder[] {
  if (!Array.isArray(input)) return DEFAULT_MAIL_FOLDERS.map((folder) => ({ ...folder }));
  const result: MailFolder[] = [];
  for (const value of input.slice(0, 100)) {
    if (
      !value ||
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 128 ||
      typeof value.name !== "string"
    )
      continue;
    const name = value.name.trim().slice(0, 40);
    if (!name || result.some((folder) => folder.id === value.id || folder.name === name)) continue;
    result.push({
      id: value.id,
      name,
      color: ["green", "blue", "rose", "amber"].includes(value.color) ? value.color : "blue",
    });
  }
  return result;
}
export function mailFolderId(mailbox: Mailbox, folders: MailFolder[]) {
  return folders.some((folder) => folder.id === mailbox.folderId) ? mailbox.folderId! : "";
}
export function moveMailboxes(
  mailboxes: Mailbox[],
  ids: string[],
  folderId: string,
  folders: MailFolder[],
) {
  if (folderId && !folders.some((folder) => folder.id === folderId))
    throw new Error("邮箱文件夹不存在");
  const selected = new Set(ids);
  return mailboxes.map((mailbox) =>
    selected.has(mailbox.id) ? { ...mailbox, folderId: folderId || undefined } : mailbox,
  );
}
export function deleteMailFolder(mailboxes: Mailbox[], folders: MailFolder[], id: string) {
  return {
    mailFolders: folders.filter((folder) => folder.id !== id),
    mailboxes: mailboxes.map((mailbox) =>
      mailbox.folderId === id ? { ...mailbox, folderId: undefined } : mailbox,
    ),
  };
}
