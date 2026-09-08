import { X, LogIn, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AccountFields, accountFromForm } from "./account-fields";
import { CredentialFields, credentialFromForm } from "./credential-fields";
import { MailLogin } from "./mail-login";
import { SmartPaste } from "./smart-paste";
import { AiAccountsPanel } from "./ai-accounts";
import { ImagePicker } from "./image-picker";
import { Button } from "./ui/button";
import { Field, Input, Textarea } from "./ui/input";
import { accountId, credentialId, desktop, isDesktop } from "@/lib/desktop";
import { usePresence } from "@/lib/motion";
import { KIND_LABEL } from "@/lib/status";
import { parseTags } from "@/lib/tags";
import { useVault } from "@/lib/vault-state";
import { useAppStore } from "@/lib/store";
import type {
  AiAsset,
  AssetKind,
  Certificate,
  Domain,
  Mailbox,
  Secret,
  Server,
  Snapshot,
} from "@/lib/types";
import { uid } from "@/lib/utils";
import { t } from "@/lib/i18n";

export function Composer() {
  const open = useAppStore((s) => s.composerOpen);
  const kind = useAppStore((s) => s.composerKind);
  const editingId = useAppStore((s) => s.editingId);
  const close = useAppStore((s) => s.closeComposer);
  const { mounted, shown } = usePresence(open, 180);
  // Closing clears `editingId`, so the exit would otherwise re-title itself
  // from "编辑" to "添加" halfway out.
  const last = useRef({ kind, editingId });
  if (open) last.current = { kind, editingId };
  if (!mounted) return null;
  return (
    <ComposerBody
      kind={last.current.kind}
      editingId={last.current.editingId}
      shown={shown}
      onClose={close}
    />
  );
}

function ComposerBody({
  kind,
  editingId,
  shown,
  onClose,
}: {
  kind: AssetKind;
  editingId: string | null;
  shown: boolean;
  onClose: () => void;
}) {
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);
  // Reading the collections directly keeps `existing` referentially stable
  // between renders, which is what the reset effect below keys on.
  const existing = findAsset(kind, editingId, {
    servers,
    domains,
    mailboxes,
    aiAssets,
    secrets,
    certs,
  });
  const [form, setForm] = useState<Record<string, string>>(() => defaults(kind, existing));
  const [aiMode, setAiMode] = useState<"login" | "manual">(editingId ? "manual" : "login");
  const [imageBusy, setImageBusy] = useState(false);

  // Reset only when the form changes *subject*. Keying on `existing` would
  // wipe half-typed input every time a background probe rewrote the record.
  useEffect(() => {
    setForm(defaults(kind, findAsset(kind, editingId, useAppStore.getState())));
    setAiMode(editingId ? "manual" : "login");
    setImageBusy(false);
  }, [kind, editingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (imageBusy) return;
    const id = editingId ?? uid(kind.slice(0, 3));

    // Secrets go to the encrypted vault before the asset is written, so a
    // half-saved record never ends up pointing at a credential that is not there.
    if (isDesktop()) {
      const sshCredential = kind === "server" ? credentialFromForm(form) : null;
      const account = accountFromForm(form);
      if (sshCredential || account) {
        const unlocked = await useVault.getState().require(t("保存账号与凭据需要先解锁密钥库。"));
        if (!unlocked) {
          toast(t("密钥库未解锁，凭据未保存"));
        } else {
          try {
            const vault = desktop()!.vault;
            if (sshCredential) await vault.set(credentialId(id), sshCredential);
            if (account) await vault.set(accountId(id), account);
          } catch (err) {
            toast(err instanceof Error ? err.message : t("凭据保存失败"));
          }
        }
      }
    }

    persist(kind, id, form, existing);
    useAppStore
      .getState()
      .log(
        `${editingId ? t("已更新") : t("已添加")} ${t(KIND_LABEL[kind])} ${form.name || form.address || form.cn || ""}`,
        kind,
      );
    toast.success(editingId ? t("已保存") : t("已添加"));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="anim-scrim absolute inset-0 bg-ink/30"
        data-shown={shown}
        aria-label={t("关闭")}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          kind === "ai" ? t(editingId ? "编辑 AI 订阅" : "添加 AI 订阅") : t(KIND_LABEL[kind])
        }
        data-shown={shown}
        className="anim-sheet relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-card p-5 shadow-float sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {kind === "ai" ? (
              t(editingId ? "编辑 AI 订阅" : "添加 AI 订阅")
            ) : (
              <>
                {editingId ? t("编辑") : t("添加")}
                {t(KIND_LABEL[kind])}
              </>
            )}
          </h2>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        {kind === "ai" && (
          <div
            role="tablist"
            aria-label={t("添加方式")}
            className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-line p-1"
          >
            <Button
              type="button"
              role="tab"
              aria-selected={aiMode === "login"}
              variant={aiMode === "login" ? "outline" : "ghost"}
              onClick={() => setAiMode("login")}
            >
              <LogIn className="size-4" />
              {t("快速登录")}
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={aiMode === "manual"}
              variant={aiMode === "manual" ? "outline" : "ghost"}
              onClick={() => setAiMode("manual")}
            >
              <Pencil className="size-4" />
              {t("手动填写")}
            </Button>
          </div>
        )}
        {kind === "ai" && aiMode === "login" ? (
          <div role="tabpanel" aria-label={t("快速登录")}>
            <AiAccountsPanel
              standalone
              assetId={editingId ?? undefined}
              initialProvider={(existing as AiAsset | null)?.oauthProvider}
            />
            <div className="mt-5 flex justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("完成")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="mb-4">
              <ImagePicker
                key={`${kind}:${editingId ?? "new"}`}
                value={form.imageDataUrl}
                onChange={(value) => set("imageDataUrl", value)}
                onBusyChange={setImageBusy}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">{fields(kind, form, set, editingId)}</div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("取消")}
              </Button>
              <Button type="submit" disabled={imageBusy}>
                {editingId ? t("保存") : t("添加")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function fields(
  kind: AssetKind,
  form: Record<string, string>,
  set: (k: string, v: string) => void,
  editingId: string | null,
): ReactNode[] {
  return [
    <SmartPaste
      key="_paste"
      kind={kind}
      onApply={(fields) => {
        for (const [k, v] of Object.entries(fields)) set(k, v);
      }}
    />,
    ...kindFields(kind, form, set, editingId),
    ...(kind === "ai" && form.oauthAccountId
      ? []
      : [<AccountFields key="_account" assetId={editingId} kind={kind} form={form} set={set} />]),
  ];
}

function kindFields(
  kind: AssetKind,
  form: Record<string, string>,
  set: (k: string, v: string) => void,
  editingId: string | null,
): ReactNode[] {
  const F = (key: string, label: string, extra?: { span?: boolean; area?: boolean }) => (
    <div key={key} className={extra?.span ? "sm:col-span-2" : ""}>
      <Field label={label}>
        {extra?.area ? (
          <Textarea
            aria-label={label}
            value={form[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
          />
        ) : (
          <Input
            aria-label={label}
            value={form[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
          />
        )}
      </Field>
    </div>
  );

  switch (kind) {
    case "server":
      return [
        F("name", t("主机名")),
        F("label", t("备注名")),
        F("host", "IP / Host"),
        F("port", t("SSH 端口")),
        F("username", t("用户名")),
        F("os", t("系统")),
        F("region", t("区域"), { span: true }),
        F("tags", t("标签（逗号分隔）"), { span: true }),
        F("notes", t("说明"), { span: true, area: true }),
        <CredentialFields
          key="_credentials"
          serverId={editingId}
          target={{
            host: form.host ?? "",
            port: form.port ?? "22",
            username: form.username ?? "root",
          }}
          form={form}
          set={set}
        />,
      ];
    case "domain":
      return [
        F("name", t("域名"), { span: true }),
        F("registrar", t("注册商")),
        F("dns", "DNS"),
        F("expiresAt", t("到期日 YYYY-MM-DD"), { span: true }),
        F("tags", t("标签（逗号分隔）"), { span: true }),
        F("notes", t("说明"), { span: true, area: true }),
      ];
    case "mail":
      return [
        <MailLogin key="_mail-login" form={form} set={set} />,
        F("address", t("地址"), { span: true }),
        F("domain", t("所属域名")),
        F("kind", t("类型 mailbox/alias/forward")),
        F("forwardTo", t("转发至"), { span: true }),
        F("tags", t("标签（逗号分隔）"), { span: true }),
        F("notes", t("说明"), { span: true, area: true }),
      ];
    case "ai":
      if (form.oauthAccountId)
        return [
          F("name", t("名称")),
          F("monthlyUsd", t("月费 USD")),
          F("tags", t("标签（逗号分隔）"), { span: true }),
          F("notes", t("说明"), { span: true, area: true }),
        ];
      return [
        F("name", t("名称")),
        F("provider", t("厂商")),
        F("plan", t("套餐")),
        F("monthlyUsd", t("月费 USD")),
        F("keyHint", t("密钥末位")),
        F("usagePct", t("用量 %")),
        F("renewsAt", t("续费日"), { span: true }),
        F("tags", t("标签（逗号分隔）"), { span: true }),
        F("notes", t("说明"), { span: true, area: true }),
      ];
    case "secret":
      return [
        F("name", t("名称")),
        F("kind", t("类型 api/ssh/password/token")),
        F("hint", t("提示")),
        F("tags", t("标签（逗号分隔）"), { span: true }),
        F("notes", t("说明"), { span: true, area: true }),
      ];
    case "cert":
      return [
        F("cn", "CN", { span: true }),
        // The probe needs somewhere to open a TLS connection; a wildcard CN
        // is not a host, so it can be overridden here.
        F("host", t("探测地址（留空则用 CN）")),
        F("port", t("端口")),
        F("issuer", t("签发者")),
        F("expiresAt", t("到期日")),
        F("sans", t("SAN（逗号分隔）"), { span: true }),
        F("tags", t("标签（逗号分隔）"), { span: true }),
        F("notes", t("说明"), { span: true, area: true }),
      ];
  }
}

function findAsset(kind: AssetKind, id: string | null, s: Snapshot): unknown {
  if (!id) return null;
  switch (kind) {
    case "server":
      return s.servers.find((x) => x.id === id) ?? null;
    case "domain":
      return s.domains.find((x) => x.id === id) ?? null;
    case "mail":
      return s.mailboxes.find((x) => x.id === id) ?? null;
    case "ai":
      return s.aiAssets.find((x) => x.id === id) ?? null;
    case "secret":
      return s.secrets.find((x) => x.id === id) ?? null;
    case "cert":
      return s.certs.find((x) => x.id === id) ?? null;
  }
}

function defaults(kind: AssetKind, existing: unknown): Record<string, string> {
  if (existing && typeof existing === "object") {
    const o = existing as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) out[k] = v.join(", ");
      else if (v != null) out[k] = String(v);
    }
    if (kind === "ai" && o.monthlyUsdKnown === false) out.monthlyUsd = "";
    return out;
  }
  const today = new Date().toISOString().slice(0, 10);
  switch (kind) {
    case "server":
      return {
        name: "",
        label: "",
        host: "",
        port: "22",
        username: "root",
        os: "Ubuntu 24.04 LTS",
        region: "",
        tags: "",
        notes: "",
      };
    case "domain":
      return {
        name: "",
        registrar: "Cloudflare",
        dns: "Cloudflare",
        expiresAt: today,
        tags: "",
        notes: "",
      };
    case "mail":
      return { address: "", domain: "", kind: "mailbox", forwardTo: "", tags: "", notes: "" };
    case "ai":
      return {
        name: "",
        provider: "",
        plan: t("月付"),
        monthlyUsd: "20",
        keyHint: "",
        usagePct: "0",
        renewsAt: today,
        tags: "",
        notes: "",
      };
    case "secret":
      return { name: "", kind: "api", hint: "", tags: "", notes: "" };
    case "cert":
      return { cn: "", issuer: "Let's Encrypt", expiresAt: today, sans: "", tags: "", notes: "" };
  }
}

function persist(kind: AssetKind, id: string, form: Record<string, string>, existing: unknown) {
  const s = useAppStore.getState();
  const statusOf = (iso?: string) => {
    if (!iso) return "online" as const;
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
    if (d <= 7) return "offline" as const;
    if (d <= 21) return "warning" as const;
    return "online" as const;
  };

  switch (kind) {
    case "server": {
      const prev = (existing as Server | null) ?? null;
      const item: Server = {
        id,
        imageDataUrl: form.imageDataUrl || "",
        name: form.name || "unnamed",
        label: form.label || form.name,
        host: form.host,
        port: Number(form.port) || 22,
        username: form.username || "root",
        os: form.os,
        region: form.region,
        tags: parseTags(form.tags ?? ""),
        status: prev?.status ?? "online",
        cpu: prev?.cpu ?? 4,
        memory: prev?.memory ?? 12,
        disk: prev?.disk ?? 10,
        uptime: prev?.uptime ?? t("刚刚"),
        lastSeen: prev?.lastSeen ?? new Date().toISOString(),
        notes: form.notes,
        authKind: (form._authKind as Server["authKind"]) ?? prev?.authKind ?? "password",
        kernel: prev?.kernel,
        loadavg: prev?.loadavg,
        memTotalKb: prev?.memTotalKb,
        diskTotalKb: prev?.diskTotalKb,
        probedAt: prev?.probedAt,
        probeError: prev?.probeError,
      };
      s.upsertServer(item);
      break;
    }
    case "domain": {
      const item: Domain = {
        id,
        imageDataUrl: form.imageDataUrl || "",
        name: form.name,
        registrar: form.registrar,
        expiresAt: form.expiresAt,
        dns: form.dns,
        nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
        autoRenew: false,
        tags: parseTags(form.tags ?? ""),
        status: statusOf(form.expiresAt),
        notes: form.notes,
      };
      s.upsertDomain(item);
      break;
    }
    case "mail": {
      const item: Mailbox = {
        id,
        imageDataUrl: form.imageDataUrl || "",
        address: form.address,
        domain: form.domain,
        kind: (form.kind as Mailbox["kind"]) || "mailbox",
        // Quick login fills these from what the IMAP server reported; the
        // fallback is only for a hand-typed mailbox.
        usedMb: Number(form.usedMb) || 0,
        quotaMb: Number(form.quotaMb) || (form.kind === "mailbox" ? 5120 : 0),
        forwardTo: form.forwardTo || undefined,
        tags: parseTags(form.tags ?? ""),
        status: "online",
        notes: form.notes,
      };
      s.upsertMail(item);
      break;
    }
    case "ai": {
      const previous = existing as AiAsset | null;
      if (previous?.oauthAccountId) {
        s.upsertAi({
          ...previous,
          imageDataUrl: form.imageDataUrl || "",
          name: form.name,
          monthlyUsd: Number(form.monthlyUsd) || 0,
          monthlyUsdKnown: form.monthlyUsd.trim() !== "",
          tags: parseTags(form.tags ?? ""),
          notes: form.notes,
        });
        break;
      }
      const usage = Number(form.usagePct) || 0;
      const item: AiAsset = {
        id,
        imageDataUrl: form.imageDataUrl || "",
        name: form.name,
        provider: form.provider,
        plan: form.plan,
        keyHint: form.keyHint,
        monthlyUsd: Number(form.monthlyUsd) || 0,
        usagePct: usage,
        renewsAt: form.renewsAt,
        tags: parseTags(form.tags ?? ""),
        status: usage >= 90 ? "warning" : "online",
        notes: form.notes,
      };
      s.upsertAi(item);
      break;
    }
    case "secret": {
      const item: Secret = {
        id,
        imageDataUrl: form.imageDataUrl || "",
        name: form.name,
        kind: (form.kind as Secret["kind"]) || "api",
        hint: form.hint,
        // Kept empty on purpose: the real value is in the vault.
        value: "",
        lastRotated: new Date().toISOString(),
        tags: parseTags(form.tags ?? ""),
        status: "online",
        notes: form.notes,
      };
      s.upsertSecret(item);
      break;
    }
    case "cert": {
      const prev = (existing as Certificate | null) ?? null;
      const item: Certificate = {
        id,
        imageDataUrl: form.imageDataUrl || "",
        cn: form.cn,
        issuer: form.issuer,
        expiresAt: form.expiresAt,
        sans: split(form.sans),
        tags: parseTags(form.tags ?? ""),
        status: statusOf(form.expiresAt),
        notes: form.notes,
        host: form.host || undefined,
        port: Number(form.port) || undefined,
        trusted: prev?.trusted,
        untrustedReason: prev?.untrustedReason,
        protocol: prev?.protocol,
        probedAt: prev?.probedAt,
        probeError: prev?.probeError,
      };
      s.upsertCert(item);
      break;
    }
  }
}

function split(v: string): string[] {
  return v
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
