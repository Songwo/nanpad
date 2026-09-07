import { useEffect, useRef, useState } from "react";
import { UserRound, KeyRound } from "lucide-react";
import { desktop } from "@/lib/desktop";
import { useProfile } from "@/lib/profile";
import { useVault } from "@/lib/vault-state";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";
import { LogoMark } from "./logo";

export function ProfileForm({ initial = false }: { initial?: boolean }) {
  const profile = useProfile((s) => s.profile);
  const [name, setName] = useState(profile?.name ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          if (initial && !profile?.vaultExists && password !== confirm)
            throw new Error(t("两次主密码不一致"));
          await desktop()?.profile.save({ name, password: initial ? password : undefined });
          setPassword("");
          setConfirm("");
          await useProfile.getState().refresh();
          await useVault.getState().refresh();
          setSaved(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={t("你的名字")}>
        <Input
          aria-label={t("你的名字")}
          autoFocus
          autoComplete="name"
          required
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {initial && (
        <>
          <Field label={t(profile?.vaultExists ? "现有主密码" : "创建主密码")}>
            <Input
              aria-label={t("主密码")}
              type="password"
              autoComplete={profile?.vaultExists ? "current-password" : "new-password"}
              minLength={profile?.vaultExists ? 6 : 10}
              maxLength={256}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {!profile?.vaultExists && (
            <Field label={t("确认主密码")}>
              <Input
                aria-label={t("确认主密码")}
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
          <p className="text-meta text-muted">
            {t(
              profile?.vaultExists
                ? "检测到已有密钥库，请使用原主密码。"
                : "主密码至少 10 位，无法找回。请妥善保管。",
            )}
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-meta text-crit">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-meta text-ok">
          {t("已保存")}
        </p>
      )}
      <Button type="submit" disabled={busy || !name.trim()}>
        {initial ? <KeyRound className="size-4" /> : <UserRound className="size-4" />}
        {t(busy ? "处理中…" : initial ? "进入司南" : "保存")}
      </Button>
    </form>
  );
}

export function Onboarding() {
  const { profile, error, refresh } = useProfile();
  const dialog = useRef<HTMLDialogElement>(null);
  const blocked = Boolean(desktop()) && (!profile || !profile.ready);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (blocked) dialog.current?.showModal();
    else dialog.current?.close();
  }, [blocked]);
  if (!blocked) return null;
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => e.preventDefault()}
      aria-label={t("首次设置")}
      className="m-auto w-full max-w-md rounded-lg border border-line bg-card p-6 text-ink shadow-float backdrop:bg-ink/40"
    >
      <LogoMark className="mb-4 size-10" />
      <h1 className="mb-5 text-xl font-semibold">{t("欢迎使用司南")}</h1>
      {error ? (
        <>
          <p role="alert" className="mb-3 text-crit">
            {error}
          </p>
          <Button onClick={() => void refresh()}>{t("重试")}</Button>
        </>
      ) : profile ? (
        <ProfileForm initial />
      ) : (
        <p>{t("加载中…")}</p>
      )}
    </dialog>
  );
}
