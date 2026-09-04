import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";
import { usePresence } from "@/lib/motion";
import { useVault } from "@/lib/vault-state";

/**
 * The one place a master password is typed.
 *
 * Anything that needs a stored credential calls `useVault().require()`, which
 * opens this and resolves once the vault is unlocked — so the SSH button and
 * the credential form never have to grow their own password prompt.
 */
export function VaultGate() {
  const prompt = useVault((s) => s.prompt);
  const exists = useVault((s) => s.exists);
  const create = useVault((s) => s.create);
  const unlock = useVault((s) => s.unlock);
  const resolvePrompt = useVault((s) => s.resolvePrompt);
  const { mounted, shown } = usePresence(prompt !== null, 180);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompt) {
      setPassword("");
      setConfirm("");
      setError(null);
      // Focus after the enter transition starts, or the caret jumps around.
      const t = window.setTimeout(() => field.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [prompt]);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolvePrompt(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt, resolvePrompt]);

  if (!mounted) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!exists && password !== confirm) {
      setError("两次输入的主密码不一致");
      return;
    }
    setWorking(true);
    try {
      if (exists) await unlock(password);
      else await create(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      field.current?.focus();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="取消"
        className="anim-scrim absolute inset-0 bg-ink/40"
        data-shown={shown}
        onClick={() => resolvePrompt(false)}
      />
      <form
        onSubmit={submit}
        data-shown={shown}
        className="anim-panel relative z-10 w-full max-w-sm rounded-2xl bg-card p-6 shadow-float"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-line">
            {exists ? <Lock className="size-5" /> : <ShieldCheck className="size-5" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">
              {exists ? "解锁密钥库" : "设置主密码"}
            </h2>
            <p className="mt-0.5 text-meta text-muted">{prompt?.reason}</p>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="主密码">
            <Input
              ref={field}
              type="password"
              value={password}
              autoComplete={exists ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {!exists && (
            <Field label="再输一次">
              <Input
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
        </div>

        {!exists && (
          <p className="mt-3 flex gap-2 rounded-md bg-banner px-3 py-2 text-2xs leading-relaxed text-muted">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" />
            主密码只用来在本机派生加密密钥，不会保存、也不会离开这台电脑。忘记后无法找回，凭据需要重新录入。
          </p>
        )}

        {error && <p className="mt-3 text-meta text-crit">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => resolvePrompt(false)}>
            取消
          </Button>
          <Button type="submit" disabled={working || password.length < 6}>
            {working ? "处理中…" : exists ? "解锁" : "创建"}
          </Button>
        </div>
      </form>
    </div>
  );
}
