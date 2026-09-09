import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { safeImageDataUrl, normalizeSnapshotImages } from "../../electron/services/image-data.mjs";
import { t } from "@/lib/i18n";
import { mailFolderId, normalizeMailFolders } from "@/lib/mail-folders";
import { useAppStore } from "@/lib/store";
import type { Mailbox } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImagePicker } from "./image-picker";
import { Button } from "./ui/button";
import { Field, Select } from "./ui/input";

export function MailAvatar({
  address,
  name,
  image,
  size = "md",
}: {
  address: string;
  name?: string;
  image?: string;
  size?: "sm" | "md" | "lg";
}) {
  const source = useMemo(() => safeImageDataUrl(image), [image]);
  const [failed, setFailed] = useState("");
  const tone = Array.from(address).reduce((value, char) => value + char.charCodeAt(0), 0) % 4;
  return (
    <span className={cn("mail-avatar", `mail-avatar-${tone}`, `mail-avatar-${size}`)}>
      {source && failed !== source ? (
        <img
          src={source}
          alt={t("{0} 的头像", name || address)}
          className="size-full object-cover"
          onError={() => setFailed(source)}
        />
      ) : (
        <span aria-hidden="true">
          {Array.from((name || address || "?").trim())[0]?.toLocaleUpperCase()}
        </span>
      )}
    </span>
  );
}

export function MailAppearanceEditor({
  mailbox,
  sender,
  close,
}: {
  mailbox: Mailbox;
  sender?: { address: string; name: string };
  close: () => void;
}) {
  const folders = useAppStore((state) => state.mailFolders);
  const normalized = normalizeMailFolders(folders);
  const address = sender?.address.toLowerCase();
  const [image, setImage] = useState(
    sender
      ? (mailbox.senderAvatars?.find((item) => item.address === address)?.imageDataUrl ?? "")
      : (mailbox.imageDataUrl ?? ""),
  );
  const [folder, setFolder] = useState(mailFolderId(mailbox, normalized));
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const busy = saving || imageBusy;
  const title = t(sender ? "发件人头像" : "邮箱头像与分组");
  async function save() {
    setSaving(true);
    setError("");
    let previous: Mailbox[] | undefined;
    let attempted: Mailbox[] | undefined;
    try {
      await useAppStore.setState((state) => {
        const current = state.mailboxes.find((item) => item.id === mailbox.id);
        if (!current) throw new Error(t("邮箱账号不存在"));
        let next = { ...current };
        if (sender && address) {
          const entries = (current.senderAvatars ?? []).filter((item) => item.address !== address);
          if (image) entries.push({ address, imageDataUrl: image });
          if (entries.length > 32) throw new Error(t("每个邮箱最多保存 32 个发件人头像。"));
          next.senderAvatars = entries;
        } else {
          if (folder && !normalizeMailFolders(state.mailFolders).some((item) => item.id === folder))
            throw new Error(t("邮箱文件夹不存在"));
          next = { ...next, imageDataUrl: image, folderId: folder || undefined };
        }
        // 在改变内存状态前校验图片总预算，避免非法快照阻塞后续保存。
        next = normalizeSnapshotImages({ mailboxes: [next] }).mailboxes[0];
        previous = state.mailboxes;
        attempted = state.mailboxes.map((item) => (item.id === current.id ? next : item));
        return { mailboxes: attempted };
      });
      close();
    } catch (cause) {
      if (previous && attempted && useAppStore.getState().mailboxes === attempted) {
        // 存盘失败仅撤回本次仍未被后续编辑覆盖的更新。
        await Promise.resolve(useAppStore.setState({ mailboxes: previous })).catch(() => undefined);
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
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
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-4 top-1/2 z-[60] mx-auto max-w-md -translate-y-1/2 rounded-lg bg-card p-5 text-ink shadow-float"
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("关闭")}
              disabled={busy}
              onClick={close}
            >
              <X className="size-4" />
            </Button>
          </div>
          <p className="mb-5 break-all text-meta text-muted">
            {sender?.address ?? mailbox.address}
          </p>
          <ImagePicker
            avatar
            label={t(sender ? "发件人头像" : "邮箱头像")}
            value={image}
            onChange={setImage}
            disabled={saving}
            onBusyChange={setImageBusy}
          />
          {!sender && (
            <div className="mt-5">
              <Field label={t("所属文件夹")}>
                <Select
                  aria-label={t("所属文件夹")}
                  value={folder || "__ungrouped"}
                  disabled={busy}
                  onValueChange={(value) => setFolder(value === "__ungrouped" ? "" : value)}
                  options={[
                    ...normalized.map((item) => ({ value: item.id, label: t(item.name) })),
                    { value: "__ungrouped", label: t("未分组") },
                  ]}
                />
              </Field>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-4 text-meta text-crit">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end">
            <Button disabled={busy} onClick={() => void save()}>
              {t("保存")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
