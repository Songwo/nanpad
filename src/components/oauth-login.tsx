import { CheckCircle2, ExternalLink, FileJson, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";
import { desktop, oauthClientId, type OAuthProvider } from "@/lib/desktop";
import { useVault } from "@/lib/vault-state";
import { t } from "@/lib/i18n";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; address: string; label: string }
  | { kind: "fail"; message: string };

/** What a provider's downloaded client file looks like, in the shapes we accept. */
function readClientFile(json: unknown): { clientId: string; clientSecret: string } | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, Record<string, string> | undefined>;
  // Google writes `{installed: {...}}` for desktop clients, `{web: {...}}` otherwise.
  const block = root.installed ?? root.web ?? (root as unknown as Record<string, string>);
  const clientId = (block as Record<string, string>)?.client_id;
  if (!clientId) return null;
  return { clientId, clientSecret: (block as Record<string, string>)?.client_secret ?? "" };
}

/**
 * Sign in with the provider's own login page.
 *
 * OAuth hands back a token, never a password — so this is not a way to capture
 * a credential, it is a way to get an address the provider has *verified* plus
 * a grant that can be refreshed later. The IMAP panel above remains the path
 * for anything that needs the mailbox itself.
 */
export function OAuthLogin({
  set,
}: {
  set: (key: string, value: string) => void;
}) {
  const bridge = desktop();
  const unlocked = useVault((s) => s.unlocked);
  const requireVault = useVault((s) => s.require);
  const [providers, setProviders] = useState<Record<string, OAuthProvider>>({});
  const [provider, setProvider] = useState("google");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (bridge) void bridge.mail.oauthProviders().then(setProviders);
  }, [bridge]);

  // The client registration lives in the vault like any other secret.
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!bridge || !unlocked) return;
      try {
        const saved = await bridge.vault.get(oauthClientId(provider));
        if (!alive) return;
        setConfigured(Boolean(saved?.username));
        setClientId(saved?.username ?? "");
        setClientSecret(saved?.password ?? "");
      } catch {
        if (alive) setConfigured(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bridge, unlocked, provider]);

  if (!bridge) return null;
  const config = providers[provider];

  async function pickFile() {
    const json = await bridge!.pickJson();
    if (!json) return;
    const parsed = readClientFile(json);
    if (!parsed) {
      toast(t("这个 JSON 里没有 client_id"));
      return;
    }
    setClientId(parsed.clientId);
    setClientSecret(parsed.clientSecret);
    toast(t("已读取客户端配置，保存后即可登录"));
  }

  async function saveClient() {
    if (!(await requireVault(t("保存 OAuth 客户端配置需要先解锁密钥库。")))) return;
    await bridge!.vault.set(oauthClientId(provider), {
      username: clientId.trim(),
      password: clientSecret.trim(),
      updatedAt: new Date().toISOString(),
    });
    setConfigured(true);
    setEditing(false);
    toast(t("客户端配置已保存"));
  }

  async function signIn() {
    setState({ kind: "busy" });
    try {
      const result = await bridge!.mail.oauthSignIn({
        provider,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setState({ kind: "ok", address: result.address, label: result.providerLabel });

      set("address", result.address);
      set("domain", result.address.split("@")[1] ?? "");
      set("kind", "mailbox");
      set("_username", result.address);
      set("_oauthProvider", result.provider);
      set("_oauthRefresh", result.refreshToken ?? "");
      set("_oauthExpires", result.expiresAt ?? "");
      set("_oauthScope", result.scope);
      set(
        "notes",
        [
          t("{0} 授权登录{1}", result.providerLabel, result.name ? ` · ${result.name}` : ""),
          result.refreshToken ? t("已保存刷新令牌") : t("未返回刷新令牌（可能未请求离线访问）"),
        ].join("\n"),
      );
      toast(t("已通过 {0} 登录 {1}", result.providerLabel, result.address));
    } catch (err) {
      setState({ kind: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const needsSecret = config?.usesSecret ?? true;
  const ready = clientId.trim() && (!needsSecret || clientSecret.trim());

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted" />
        <h4 className="text-meta font-semibold">{t("或用服务商账号授权")}</h4>
        <div className="ml-auto flex gap-1">
          {Object.entries(providers).map(([id, p]) => (
            <button
              key={id}
              type="button"
              className={`tag-chip ${provider === id ? "tag-chip-on" : ""}`}
              onClick={() => setProvider(id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!unlocked ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void requireVault(t("OAuth 客户端配置存在密钥库里，需要先解锁。"))}
        >

          {t("解锁密钥库")}
        </Button>
      ) : configured && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={state.kind === "busy"} onClick={signIn}>
            {state.kind === "busy" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}

            {t("用 {0} 登录", config?.label ?? "")}
          </Button>
          <button
            type="button"
            className="text-2xs text-subtle hover:text-ink"
            onClick={() => setEditing(true)}
          >

            {t("换个客户端")}
          </button>
          {state.kind === "ok" && (
            <span className="flex items-center gap-1.5 text-2xs text-ok">
              <CheckCircle2 className="size-3.5" />
              {state.label} · {state.address}
            </span>
          )}
          {state.kind === "fail" && (
            <span className="flex items-start gap-1.5 text-2xs text-crit">
              <XCircle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">{state.message}</span>
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={pickFile}>
              <FileJson className="size-3.5" />

              {t("选择客户端 JSON")}
            </Button>
            <span className="text-2xs text-subtle">

              {t("就是控制台下载的 client_secret_*.json")}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("客户端 ID")}>
              <Input
                value={clientId}
                autoComplete="off"
                className="font-mono text-2xs"
                onChange={(e) => setClientId(e.target.value)}
              />
            </Field>
            {needsSecret && (
              <Field label={t("客户端密钥")}>
                <Input
                  type="password"
                  value={clientSecret}
                  autoComplete="off"
                  className="font-mono text-2xs"
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </Field>
            )}
          </div>

          {config && (
            <p className="text-2xs leading-relaxed text-muted">
              {config.setupNote}{" "}
              <button
                type="button"
                className="underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                onClick={() => void bridge!.openExternal(config.consoleUrl)}
              >

                {t("打开控制台")}
              </button>
            </p>
          )}

          <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={saveClient}>

            {t("保存客户端配置")}
          </Button>
        </div>
      )}

      <p className="mt-2 text-2xs leading-relaxed text-subtle">

        {t("授权在你自己的浏览器里完成，应用只拿到已验证的地址与刷新令牌 —— OAuth\n        本来就不会把密码交给第三方应用。")}
      </p>
    </div>
  );
}
