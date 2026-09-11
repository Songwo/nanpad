/**
 * 资产分组的通用核心：邮箱收纳文件夹与密钥分组共用同一套校验、
 * 移动与删除语义（0.10.0）。颜色与数量约束保持与邮箱文件夹一致。
 */
export interface AssetFolder {
  id: string;
  name: string;
  color: "green" | "blue" | "rose" | "amber";
}
export type FolderItem = { id: string; folderId?: string };

export const FOLDER_COLORS = ["green", "blue", "rose", "amber"] as const;
export const MAX_FOLDERS = 100;

/** 非数组输入回退默认分组；逐项校验 id / 名称 / 颜色，按 id 与名称去重。 */
export function normalizeFolders(input: unknown, defaults: AssetFolder[]): AssetFolder[] {
  if (!Array.isArray(input)) return defaults.map((folder) => ({ ...folder }));
  const result: AssetFolder[] = [];
  for (const value of input.slice(0, MAX_FOLDERS)) {
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
      color: FOLDER_COLORS.includes(value.color) ? value.color : "blue",
    });
  }
  return result;
}

/** 归属分组 id；已删除分组的残留 id 归入未分组（""）。 */
export function folderIdOf<T extends FolderItem>(item: T, folders: AssetFolder[]): string {
  return folders.some((folder) => folder.id === item.folderId) ? item.folderId! : "";
}

/** 批量移动到分组；folderId 为空串表示移回未分组。 */
export function moveToFolder<T extends FolderItem>(
  items: T[],
  ids: string[],
  folderId: string,
  folders: AssetFolder[],
  error: Error,
): T[] {
  if (folderId && !folders.some((folder) => folder.id === folderId)) throw error;
  const selected = new Set(ids);
  return items.map((item) =>
    selected.has(item.id) ? { ...item, folderId: folderId || undefined } : item,
  );
}

/** 删除分组只解除归属，不删除资产本身。 */
export function deleteFolderOf<T extends FolderItem>(
  items: T[],
  folders: AssetFolder[],
  id: string,
) {
  return {
    folders: folders.filter((folder) => folder.id !== id),
    items: items.map((item) => (item.folderId === id ? { ...item, folderId: undefined } : item)),
  };
}
