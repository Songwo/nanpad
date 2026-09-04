import {
  Check,
  ExternalLink,
  FolderOpen,
  Loader2,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  ScrollText,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";
import { RELEASES } from "@/lib/changelog";
import { desktop, type AppInfo } from "@/lib/desktop";
import { usePresence } from "@/lib/motion";
import { useSettings, type ThemeChoice } from "@/lib/settings";
import { useAppStore } from "@/lib/store";
import { cn, downloadJson } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";

type Tab = "appearance" | "vault" | "data" | "about" | "changelog";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "vault", label: "密钥库" },
  { id: "data", label: "数据" },
  { id: "about", label: "关于" },
  { id: "changelog", label: "更新日志" },
];

export function Settings() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const { mounted, shown } = usePresence(open, 180);
  const [tab, setTab] = useState<Tab>("appearance");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="关闭设置"
        className="anim-scrim absolute inset-0 bg-ink/40"
        data-shown={shown}
        onClick={() => setOpen(false)}
      />
      <div
        data-shown={shown}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="anim-panel relative z-10 flex h-[min(620px,86vh)] w-full max-w-3xl overflow-hidden rounded-2xl bg-card shadow-float"
      >
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-line p-2">
          <h2 className="px-3 pb-2 pt-3 text-meta font-semibold tracking-tight">设置</h2>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(
                "settings-tab",
                tab === t.id && "settings-tab-on",
              )}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 flex items-center justify-end bg-card/90 px-3 py-2 backdrop-blur">
            <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="px-6 pb-8">
            {tab === "appearance" && <Appearance />}
            {tab === "vault" && <VaultSection />}
            {tab === "data" && <DataSection />}
            {tab === "about" && <About />}
            {tab === "changelog" && <Changelog />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      {hint && <p className="mt-1 text-meta leading-relaxed text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-meta font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-2xs leading-relaxed text-subtle">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const THEMES: Array<{ id: ThemeChoice; label: string; icon: LucideIcon }> = [
  { id: "system", label: "跟随系统", icon: Monitor },
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
];

function Appearance() {
  const theme = useSettings((s) => s.theme);
  const resolved = useSettings((s) => s.resolved);
  const setTheme = useSettings((s) => s.setTheme);

  return (
    <Section
      title="外观"
      hint="深色主题的表面是按层级抬升的，不是简单反色——画布最暗，卡片浮在它上面。"
    >
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((option) => {
          const on = theme === option.id;
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              className={cn("theme-option", on && "theme-option-on")}
              onClick={() => setTheme(option.id)}
            >
              <Icon className="size-5" strokeWidth={1.9} />
              <span className="text-meta font-medium">{option.label}</span>
              {on && <Check className="absolute right-2.5 top-2.5 size-3.5" strokeWidth={2.6} />}
            </button>
          );
        })}
      </div>
      {theme === "system" && (
        <p className="mt-3 text-2xs text-subtle">
          当前系统为{resolved === "dark" ? "深色" : "浅色"}，主题会跟着系统一起切换。
        </p>
      )}
    </Section>
  );
}

function VaultSection() {
  const bridge = desktop();
  const exists = useVault((s) => s.exists);
  const unlocked = useVault((s) => s.unlocked);
  const lock = useVault((s) => s.lock);
  const refresh = useVault((s) => s.refresh);
  const requireVault = useVault((s) => s.require);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bridge) {
    return (
      <Section title="密钥库" hint="浏览器预览没有密钥库；桌面版才会加密保存凭据。">
        <p className="text-meta text-muted">—</p>
      </Section>
    );
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPw !== confirmPw) {
      setError("两次输入的新主密码不一致");
      return;
    }
    setBusy(true);
    try {
      const res = await bridge!.vault.changePassword(oldPw, newPw);
      await refresh();
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
      toast(`主密码已更新，${res.count} 条凭据已重新加密`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="密钥库" hint="SSH 凭据、各服务账号密码与密钥完整值都存在这里。">
        <Row label="状态" hint={exists ? undefined : "第一次保存凭据时会让你设置主密码。"}>
          <span className={cn("chip", unlocked ? "chip-ok" : "chip-mute")}>
            {exists ? (unlocked ? "已解锁" : "已锁定") : "尚未创建"}
          </span>
        </Row>
        <Row label="锁定" hint="锁定后内存中的密钥立即丢弃，再次读取需要重新输入主密码。">
          {unlocked ? (
            <Button variant="outline" size="sm" onClick={() => void lock()}>
              <Lock className="size-3.5" />
              立即锁定
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={!exists}
              onClick={() => void requireVault("解锁后可以修改主密码或读取已保存的凭据。")}
            >
              解锁
            </Button>
          )}
        </Row>
      </Section>

      {exists && (
        <Section
          title="修改主密码"
          hint="换密码会用新密钥把每一条凭据重新加密一遍，全部成功后才落盘。"
        >
          <form onSubmit={changePassword} className="space-y-3">
            <Field label="当前主密码">
              <Input
                type="password"
                value={oldPw}
                autoComplete="current-password"
                onChange={(e) => setOldPw(e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="新主密码">
                <Input
                  type="password"
                  value={newPw}
                  autoComplete="new-password"
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </Field>
              <Field label="再输一次">
                <Input
                  type="password"
                  value={confirmPw}
                  autoComplete="new-password"
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
              </Field>
            </div>
            {error && <p className="text-meta text-crit">{error}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || oldPw.length < 6 || newPw.length < 6}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                更新主密码
              </Button>
              <span className="text-2xs text-subtle">忘记主密码无法找回，凭据需要重新录入。</span>
            </div>
          </form>
        </Section>
      )}
    </>
  );
}

function DataSection() {
  const bridge = desktop();
  const resetDemo = useAppStore((s) => s.resetDemo);
  const importSnapshot = useAppStore((s) => s.importSnapshot);
  const log = useAppStore((s) => s.log);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (bridge) void bridge.info().then(setInfo);
  }, [bridge]);

  return (
    <Section title="数据" hint="资产记录是明文 JSON，凭据在同目录下单独加密保存。">
      {info && (
        <Row label="数据目录" hint={info.userData}>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              bridge
                ?.openDataDir()
                .catch((err) => toast(err instanceof Error ? err.message : "无法打开目录"))
            }
          >
            <FolderOpen className="size-3.5" />
            打开
          </Button>
        </Row>
      )}
      <Row label="导出 JSON" hint="只导出资产记录；账号密码与 SSH 凭据不会跟着出去。">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const s = useAppStore.getState();
            downloadJson("sinan-assets.json", {
              servers: s.servers,
              domains: s.domains,
              mailboxes: s.mailboxes,
              aiAssets: s.aiAssets,
              secrets: s.secrets,
              certs: s.certs,
            });
            log("已导出资产快照");
          }}
        >
          导出
        </Button>
      </Row>
      <Row label="导入 JSON" hint="会覆盖当前的全部资产记录。">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                importSnapshot(JSON.parse(await file.text()));
                log("已导入资产快照");
                toast("已导入");
              } catch {
                toast("文件不是有效的资产快照");
              }
            };
            input.click();
          }}
        >
          导入
        </Button>
      </Row>
      <Row label="清空全部数据" hint="只清资产记录，密钥库中的凭据不受影响。">
        <Button variant="danger" size="sm" onClick={() => resetDemo()}>
          清空
        </Button>
      </Row>
    </Section>
  );
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; latest: string }
  | { kind: "outdated"; latest: string; page: string }
  | { kind: "unavailable"; reason: string; page: string };

function About() {
  const bridge = desktop();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    if (bridge) void bridge.info().then(setInfo);
  }, [bridge]);

  async function check() {
    if (!bridge) return;
    setUpdate({ kind: "checking" });
    try {
      const res = await bridge.checkUpdate();
      if (res.state === "outdated") setUpdate({ kind: "outdated", latest: res.latest!, page: res.page });
      else if (res.state === "current") setUpdate({ kind: "current", latest: res.latest ?? res.current });
      else setUpdate({ kind: "unavailable", reason: res.reason ?? "无法检查", page: res.page });
    } catch (err) {
      setUpdate({
        kind: "unavailable",
        reason: err instanceof Error ? err.message : "无法检查",
        page: "https://github.com/Songwo/nanpad/releases",
      });
    }
  }

  return (
    <Section title="关于" hint="司南 —— 个人数字资产指挥台。">
      <Row label="当前版本">
        <span className="font-mono text-meta tabular-nums">{info?.version ?? "—"}</span>
      </Row>
      <Row
        label="检查更新"
        hint={
          update.kind === "current"
            ? `已是最新版本（${update.latest}）`
            : update.kind === "outdated"
              ? `有新版本 ${update.latest} 可用`
              : update.kind === "unavailable"
                ? update.reason
                : undefined
        }
      >
        <div className="flex items-center gap-2">
          {update.kind === "outdated" || update.kind === "unavailable" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void bridge?.openExternal(update.page)}
            >
              <ExternalLink className="size-3.5" />
              发布页
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={update.kind === "checking"}
            onClick={check}
          >
            <RefreshCw className={cn("size-3.5", update.kind === "checking" && "animate-spin")} />
            检查
          </Button>
        </div>
      </Row>
      <Row label="运行环境">
        <span className="font-mono text-2xs text-muted">
          {info ? `Electron ${info.electron} · Node ${info.node} · ${info.arch}` : "—"}
        </span>
      </Row>
      <Row label="项目主页">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void bridge?.openExternal("https://github.com/Songwo/nanpad")}
        >
          <ExternalLink className="size-3.5" />
          GitHub
        </Button>
      </Row>
    </Section>
  );
}

function Changelog() {
  return (
    <Section title="更新日志">
      <ol className="space-y-6">
        {RELEASES.map((release) => (
          <li key={release.version}>
            <div className="flex items-baseline gap-2">
              <h4 className="font-mono text-body font-semibold tabular-nums">{release.version}</h4>
              <span className="text-2xs tabular-nums text-subtle">{release.date}</span>
              <span className="text-meta text-muted">{release.title}</span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {release.changes.map((change) => (
                <li key={change} className="flex gap-2 text-meta leading-relaxed text-muted">
                  <ScrollText className="mt-0.5 size-3.5 shrink-0 text-subtle" strokeWidth={1.9} />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}
