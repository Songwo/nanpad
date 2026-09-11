import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { cn, uid } from "@/lib/utils";
import {
  deleteSecretFolder,
  moveSecrets,
  normalizeSecretFolders,
  secretFolderId,
  type SecretFolder,
} from "@/lib/secret-folders";
import { matchesTags } from "@/lib/tags";
import type { Secret } from "@/lib/types";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/input";
import { openFromEvent } from "./asset-card";

const KIND_LABEL: Record<Secret["kind"], string> = {
  password: "网站账号",
  api: "API Key",
  ssh: "SSH 私钥",
  token: "Token",
};

/**
 * 密钥分组工作台（0.10.0）：密钥数量增长后按分组收纳，结构对齐邮箱收纳
 * 文件夹——分组网格进入、组内行列表、批量移动、重命名与颜色编辑。
 * 只在卡片布局启用；表格与关系图布局保持原有平铺行为。
 */
export function VaultWorkspace() {
  const state = useAppStore();
  const folders = normalizeSecretFolders(state.secretFolders);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<SecretFolder | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const query = state.query.trim().toLocaleLowerCase();
  const matching = state.secrets.filter(
    (secret) =>
      `${secret.name} ${secret.kind} ${secret.hint} ${secret.tags.join(" ")} ${t(
        folders.find((item) => item.id === secretFolderId(secret, folders))?.name ?? "未分组",
      )}`
        .toLocaleLowerCase()
        .includes(query) &&
      matchesTags(secret, state.tagFilter) &&
      (state.filter !== "attention" || secret.status !== "online"),
  );
  const allFolders = [...folders, { id: "", name: t("未分组"), color: "amber" as const }];
  const folder = allFolders.find((item) => item.id === active);
  const displayed = matching.filter((secret) => secretFolderId(secret, folders) === active);
  const selectedIds = selected.filter((id) => displayed.some((secret) => secret.id === id));

  async function move(target: string) {
    setBusy(true);
    try {
      await useAppStore.setState((latest) => ({
        secrets: moveSecrets(
          latest.secrets,
          selectedIds,
          target,
          normalizeSecretFolders(latest.secretFolders),
        ),
      }));
      setSelected([]);
      toast.success(t("密钥已移动"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="p-4" aria-label={t("密钥分组")}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {active !== null && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("返回分组")}
              aria-label={t("返回分组")}
              onClick={() => {
                setActive(null);
                setSelected([]);
              }}
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <h2 className="truncate text-lg font-semibold">
            {active === null ? t("密钥分组") : t(folder?.name ?? "未分组")}
          </h2>
          <span className="text-meta text-muted">
            {t("{0} 个密钥", active === null ? matching.length : displayed.length)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {folder?.id && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("编辑分组")}
              title={t("编辑分组")}
              onClick={() => setEditor(folder)}
            >
              <Pencil className="size-4" />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditor("new")}>
            <FolderPlus className="size-4" />
            {t("新建分组")}
          </Button>
        </div>
      </div>
      {active === null ? (
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">
          {query &&
            !matching.length &&
            !allFolders.some((item) => t(item.name).toLocaleLowerCase().includes(query)) && (
              <div className="col-span-full py-16 text-center text-muted">
                <FolderOpen className="mx-auto mb-3 size-10" strokeWidth={1} />
                <p>{t("没有匹配的密钥。")}</p>
              </div>
            )}
          {allFolders
            .filter(
              (item) =>
                !query ||
                t(item.name).toLocaleLowerCase().includes(query) ||
                matching.some((secret) => secretFolderId(secret, folders) === item.id),
            )
            .map((item) => {
              const members = matching.filter(
                (secret) => secretFolderId(secret, folders) === item.id,
              );
              return (
                <button
                  key={item.id}
                  className={cn("mail-folder group text-left", `mail-folder-${item.color}`)}
                  onClick={() => {
                    setActive(item.id);
                    setSelected([]);
                  }}
                  aria-label={t("打开分组 {0}", t(item.name))}
                >
                  <div className="mail-folder-tab" />
                  <div className="flex items-center justify-between">
                    <Folder className="size-7" />
                    <span className="font-mono text-meta text-muted">{members.length}</span>
                  </div>
                  <h3 className="mt-4 truncate text-base font-semibold text-ink">{t(item.name)}</h3>
                  <div className="mt-4 flex min-h-8 flex-wrap items-center gap-1 text-muted">
                    {members.slice(0, 3).map((secret) => (
                      <span
                        key={secret.id}
                        className="max-w-24 truncate rounded-full bg-ink/10 px-2 py-0.5 text-2xs"
                      >
                        {secret.name}
                      </span>
                    ))}
                    <span className="ml-auto text-2xs">
                      {members.length ? t("{0} 个密钥", members.length) : t("空分组")}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-meta">
              <input
                type="checkbox"
                checked={displayed.length > 0 && selectedIds.length === displayed.length}
                disabled={busy || !displayed.length}
                onChange={(event) =>
                  setSelected(event.target.checked ? displayed.map((item) => item.id) : [])
                }
              />
              {t("全选")}
            </label>
            {selectedIds.length > 0 && (
              <div className="w-52">
                <Select
                  aria-label={t("移动到分组")}
                  value=""
                  placeholder={t("移动到分组")}
                  disabled={busy}
                  onValueChange={(value) => void move(value === "__ungrouped" ? "" : value)}
                  options={allFolders
                    .filter((item) => item.id !== active)
                    .map((item) => ({ value: item.id || "__ungrouped", label: t(item.name) }))}
                />
              </div>
            )}
            <Button
              className="ml-auto"
              variant="ghost"
              size="sm"
              onClick={() => state.openComposer("secret", null, { folderId: active ?? "" })}
            >
              <Plus className="size-4" />
              {t("添加密钥")}
            </Button>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {displayed.map((secret) => (
              <div key={secret.id} className="flex items-center gap-3 py-4">
                <input
                  type="checkbox"
                  aria-label={t("选择密钥 {0}", secret.name)}
                  checked={selectedIds.includes(secret.id)}
                  disabled={busy}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selectedIds, secret.id]
                        : selectedIds.filter((id) => id !== secret.id),
                    )
                  }
                />
                <KeyRound className="size-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{secret.name}</span>
                  <span className="mt-1 block truncate text-meta text-muted">
                    {t(KIND_LABEL[secret.kind] ?? secret.kind)}
                    {secret.hint ? ` · ${secret.hint}` : ""}
                    {secret.tags.length ? ` · ${secret.tags.join(" / ")}` : ""}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t("密钥详情")}
                  aria-label={t("密钥详情")}
                  onClick={(event) => openFromEvent(event, "secret", secret.id)}
                >
                  <Settings2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          {displayed.length === 0 && (
            <div className="py-16 text-center text-muted">
              <FolderOpen className="mx-auto mb-3 size-10" strokeWidth={1} />
              <p>{t("没有匹配的密钥。")}</p>
            </div>
          )}
        </>
      )}
      {editor && (
        <FolderEditor
          key={editor === "new" ? "new" : editor.id}
          folder={editor}
          close={() => {
            setEditor(null);
            if (
              active &&
              !useAppStore.getState().secretFolders?.some((item) => item.id === active)
            )
              setActive(null);
          }}
        />
      )}
    </section>
  );
}

function FolderEditor({ folder, close }: { folder: SecretFolder | "new"; close: () => void }) {
  const [name, setName] = useState(folder === "new" ? "" : folder.name);
  const [color, setColor] = useState<SecretFolder["color"]>(folder === "new" ? "blue" : folder.color);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(remove = false) {
    setBusy(true);
    setError("");
    try {
      const latest = useAppStore.getState();
      const folders = normalizeSecretFolders(latest.secretFolders);
      if (remove && folder !== "new")
        await useAppStore.setState(deleteSecretFolder(latest.secrets, folders, folder.id));
      else {
        if (!name.trim() || name.trim().length > 40)
          throw new Error(t("分组名称需要 1 到 40 个字符"));
        if (
          folders.some(
            (item) => item.name === name.trim() && (folder === "new" || item.id !== folder.id),
          )
        )
          throw new Error(t("分组名称已存在"));
        if (folder === "new" && folders.length >= 100)
          throw new Error(t("最多创建 100 个分组"));
        const next = { id: folder === "new" ? uid() : folder.id, name: name.trim(), color };
        await useAppStore.setState({
          secretFolders:
            folder === "new"
              ? [...folders, next]
              : folders.map((item) => (item.id === folder.id ? next : item)),
        });
      }
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-lg bg-card p-5 text-ink shadow-float"
        >
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">
              {t(folder === "new" ? "新建分组" : "编辑分组")}
            </Dialog.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("关闭")}
              onClick={close}
              disabled={busy}
            >
              <X className="size-4" />
            </Button>
          </div>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label={t("分组名称")}>
              <Input
                autoFocus
                aria-label={t("分组名称")}
                value={name}
                maxLength={40}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="flex gap-3" role="group" aria-label={t("分组颜色")}>
              {(["blue", "green", "rose", "amber"] as const).map((tone) => (
                <button
                  key={tone}
                  type="button"
                  aria-label={t({ blue: "蓝色", green: "绿色", rose: "玫红", amber: "琥珀" }[tone])}
                  aria-pressed={color === tone}
                  onClick={() => setColor(tone)}
                  className={cn(
                    "mail-folder-swatch",
                    `mail-folder-${tone}`,
                    color === tone && "ring-2 ring-ink ring-offset-2 ring-offset-card",
                  )}
                />
              ))}
            </div>
            {error && (
              <p className="text-meta text-crit" role="alert">
                {error}
              </p>
            )}
            {deleting && (
              <p className="text-meta text-muted">
                {t("删除分组后，密钥将移至未分组，密钥本身和凭据不会删除。")}
              </p>
            )}
            <div className="flex justify-between gap-2">
              {folder !== "new" && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => (deleting ? void save(true) : setDeleting(true))}
                >
                  <Trash2 className="size-4" />
                  {t(deleting ? "确认删除分组" : "删除分组")}
                </Button>
              )}
              <Button type="submit" className="ml-auto" disabled={busy || !name.trim()}>
                {t("保存")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
