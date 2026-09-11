import type { Secret } from "./types.ts";
import {
  normalizeFolders,
  folderIdOf,
  moveToFolder,
  deleteFolderOf,
  type AssetFolder,
} from "./asset-folders.ts";

/**
 * 密钥分组（0.10.0）：密钥数量增长后按分组收纳，避免全部卡片平铺。
 * 语义与邮箱收纳文件夹完全一致：默认两个分组、最多 100 个、删除只解除归属。
 */
export type SecretFolder = AssetFolder;
export const DEFAULT_SECRET_FOLDERS: SecretFolder[] = [
  { id: "work", name: "工作密钥", color: "blue" },
  { id: "personal", name: "个人密钥", color: "green" },
];
export const normalizeSecretFolders = (input: unknown): SecretFolder[] =>
  normalizeFolders(input, DEFAULT_SECRET_FOLDERS);
export const secretFolderId = (secret: Secret, folders: SecretFolder[]) =>
  folderIdOf(secret, folders);
export const moveSecrets = (
  secrets: Secret[],
  ids: string[],
  folderId: string,
  folders: SecretFolder[],
) => moveToFolder(secrets, ids, folderId, folders, new Error("密钥分组不存在"));
export const deleteSecretFolder = (secrets: Secret[], folders: SecretFolder[], id: string) => {
  const { folders: secretFolders, items } = deleteFolderOf(secrets, folders, id);
  return { secretFolders, secrets: items };
};
