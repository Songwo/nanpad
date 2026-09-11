import type { Mailbox } from "./types.ts";
import {
  normalizeFolders,
  folderIdOf,
  moveToFolder,
  deleteFolderOf,
  type AssetFolder,
} from "./asset-folders.ts";

export type MailFolder = AssetFolder;
export const DEFAULT_MAIL_FOLDERS: MailFolder[] = [
  { id: "work", name: "工作邮箱", color: "blue" },
  { id: "personal", name: "生活邮箱", color: "green" },
];
export const normalizeMailFolders = (input: unknown): MailFolder[] =>
  normalizeFolders(input, DEFAULT_MAIL_FOLDERS);
export const mailFolderId = (mailbox: Mailbox, folders: MailFolder[]) =>
  folderIdOf(mailbox, folders);
export const moveMailboxes = (
  mailboxes: Mailbox[],
  ids: string[],
  folderId: string,
  folders: MailFolder[],
) =>
  moveToFolder(mailboxes, ids, folderId, folders, new Error("邮箱文件夹不存在"));
export const deleteMailFolder = (mailboxes: Mailbox[], folders: MailFolder[], id: string) => {
  const { folders: mailFolders, items } = deleteFolderOf(mailboxes, folders, id);
  return { mailFolders, mailboxes: items };
};
