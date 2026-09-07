import {
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  MessageSquarePlus,
  ShieldCheck,
  SquareTerminal,
  Square,
  Settings2,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LogoMark } from "./logo";
import { Button } from "./ui/button";
import { TimeAgo } from "./ui/time-ago";
import { type Block, type SecretField } from "@/lib/agent";
import { AgentSettings } from "./agent-settings";
import { Markdown } from "./markdown";
import type { Source } from "@/lib/agent-client";
import { useConversations, type Message } from "@/lib/conversations";
import { accountId, credentialId, desktop } from "@/lib/desktop";
import { chipClass, dotClass, KIND_LABEL } from "@/lib/status";
import { useAppStore } from "@/lib/store";
import type { AssetKind } from "@/lib/types";
import { cn, copyText } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";
import { t } from "@/lib/i18n";

/** 本机负责检索和只读工具执行，模型请求由桌面主进程发送。 */
export function AgentView() {
  const conversations = useConversations((s) => s.conversations);
  const activeId = useConversations((s) => s.activeId);
  const append = useConversations((s) => s.append);
  const start = useConversations((s) => s.start);
  const [draft, setDraft] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [model, setModel] = useState("");
  const [running, setRunning] = useState<{
    id: string;
    conversationId: string;
    text: string;
    phase: string;
    tools: string[];
    sources: Source[];
  } | null>(null);
  const runRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const api = desktop()?.agent;
  const bottom = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeId, running?.text]);

  useEffect(() => {
    let alive = true;
    void api
      ?.config()
      .then((config) => {
        if (alive) setModel(config.model);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api, configOpen]);
  useEffect(
    () => () => {
      if (runRef.current) void api?.cancel(runRef.current);
    },
    [api],
  );

  async function send(text: string) {
    const question = text.trim();
    if (!question || runRef.current) return;
    if (!api) {
      setError(t("模型连接与本地知识库仅在桌面端可用。"));
      return;
    }
    if (!model) {
      setConfigOpen(true);
      setError(t("请先配置真实模型地址、API Key 和模型名。"));
      return;
    }
    const conversationId = activeId ?? start();
    const history = messages
      .filter(
        (m) =>
          !m.blocks.some(
            (b) => b.type === "secret" || (b.type === "run" && b.status !== "success"),
          ),
      )
      .map((m) => ({
        role: m.role === "you" ? ("user" as const) : ("assistant" as const),
        content: m.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
      }));
    append("you", [{ type: "text", text: question }], conversationId);
    setDraft("");
    setError("");
    const id = crypto.randomUUID();
    runRef.current = id;
    let output = "";
    const sources: Source[] = [],
      tools: string[] = [];
    setRunning({ id, conversationId, text: "", phase: t("本地检索"), tools: [], sources: [] });
    const off = api.onEvent((event) => {
      if (event.id !== id) return;
      if (event.type === "delta") output += event.text ?? "";
      if (event.type === "source" && event.source) sources.push(event.source);
      if (event.type === "tool" && event.name) tools.push(event.name);
      setRunning((previous) =>
        previous?.id === id
          ? {
              ...previous,
              text: output,
              phase: event.type === "phase" ? t(event.text ?? "") : previous.phase,
              tools: [...tools],
              sources: [...sources],
            }
          : previous,
      );
    });
    try {
      const result = await api.run({ id, question, history });
      append(
        "agent",
        [
          { type: "text", text: result.text },
          { type: "sources", sources: result.sourceItems },
          { type: "run", model: result.model, steps: result.steps, tools: result.tools, status: "success" },
        ],
        conversationId,
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(reason);
      append(
        "agent",
        [
          { type: "text", text: output ? `${output}\n\n${reason}` : reason },
          { type: "sources", sources },
          {
            type: "run",
            model,
            steps: 0,
            tools,
            status: reason === "已停止生成。" ? "stopped" : "error",
          },
        ],
        conversationId,
      );
    } finally {
      off();
      runRef.current = null;
      setRunning(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="agent-header">
        <span className="min-w-0 flex-1 break-words text-meta">{model || t("尚未配置模型")}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={Boolean(running)}
          aria-label={t("模型与知识库")}
          title={t("模型与知识库")}
          onClick={() => setConfigOpen((open) => !open)}
        >
          <Settings2 className="size-4" />
        </Button>
      </header>
      {configOpen && (
        <div className="border-b border-line p-4">
          <AgentSettings onConfigChange={(config) => setModel(config.model)} />
        </div>
      )}
      {!configOpen && (
        <>
          <div className="min-h-0 flex-1 px-4 pb-4 pt-4">
            {messages.length === 0 ? (
              <Welcome onPick={send} />
            ) : (
              <div className="space-y-5 pb-4">
                {messages.map((m) => (
                  <MessageRow key={m.id} message={m} />
                ))}
                {running?.conversationId === activeId && (
                  <div className="agent-pending" aria-live="polite">
                    <p className="flex items-center gap-2 text-meta text-muted">
                      <Loader2 className="size-4 animate-spin" />
                      {running.phase}
                    </p>
                    {running.tools.length > 0 && (
                      <p className="my-2 break-words font-mono text-2xs text-subtle">
                        {running.tools.join(" → ")}
                      </p>
                    )}
                    <Markdown>{running.text}</Markdown>
                  </div>
                )}
                <div ref={bottom} />
              </div>
            )}
          </div>

          <form
            className="sticky bottom-0 bg-canvas px-4 pb-4 pt-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <div className="relative">
              <textarea
                value={draft}
                rows={1}
                aria-label={t("向模型提问")}
                maxLength={8000}
                placeholder={t("哪些资产需要优先处理？请引用依据。")}
                className="agent-input"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
              />
              {running ? (
                <button
                  type="button"
                  aria-label={t("停止生成")}
                  title={t("停止生成")}
                  className="agent-stop"
                  onClick={() =>
                    void api?.cancel(running.id).catch((e: Error) => setError(e.message))
                  }
                >
                  <Square className="size-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label={t("发送")}
                  disabled={!draft.trim()}
                  className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-ink text-card transition-transform duration-150 ease-out active:scale-90 disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
            <p className="mt-2 px-1 text-2xs text-subtle">
              {t("本地检索，真实模型生成。问题和命中片段发送至所选模型；凭据不进入检索。")}
            </p>
            {error && (
              <p role="alert" className="mt-2 break-words text-meta text-crit">
                {error}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="stagger-in mx-auto max-w-xl pt-6">
      <LogoMark className="size-10" />
      <h2 className="mt-4 text-xl font-semibold tracking-tight">{t("问问你自己的资产")}</h2>
      <p className="mt-2 text-meta leading-relaxed text-muted">
        {t("基于资产与本地知识文档分析到期、用量和运行状态。")}
      </p>
      <div className="mt-5 grid gap-2">
        {[
          "哪些资产需要优先处理？请引用依据。",
          "我的主机、域名和证书有哪些关联？",
          "统计每月 AI 订阅费用，给出优化建议。",
        ].map((s) => (
          <button key={s} type="button" className="paste-match" onClick={() => onPick(t(s))}>
            <span className="flex-1 text-left text-meta">{t(s)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  if (message.role === "you") {
    const text = message.blocks.find((b) => b.type === "text");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-card">
          <p className="whitespace-pre-wrap text-meta">{text?.type === "text" ? text.text : ""}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-6 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2.5">
        {message.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
        <TimeAgo iso={message.at} className="block text-2xs text-subtle" />
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  const setExpanded = useAppStore((s) => s.setExpanded);
  const openSsh = useAppStore((s) => s.openSsh);

  const reveal = (assetId: string, kind: AssetKind) => {
    const w = Math.min(560, window.innerWidth - 48);
    setExpanded({
      kind,
      id: assetId,
      origin: { x: (window.innerWidth - w) / 2, y: window.innerHeight * 0.3, w, h: 180 },
    });
  };

  switch (block.type) {
    case "sources":
      return block.sources.length > 0 ? (
        <details className="agent-sources">
          <summary>
            {t("检索来源")} · {block.sources.length}
          </summary>
          <ul>
            {block.sources.map((source) => (
              <li key={source.id}>
                {source.assetId && source.kind ? (
                  <button
                    type="button"
                    className="text-left text-meta font-medium"
                    onClick={() => reveal(source.assetId!, source.kind!)}
                  >
                    [{source.citation}] {source.title}
                  </button>
                ) : (
                  <span className="text-meta font-medium">
                    [{source.citation}] {source.title}
                  </span>
                )}
                <Markdown>{source.excerpt}</Markdown>
              </li>
            ))}
          </ul>
        </details>
      ) : null;
    case "run":
      return (
        <p className="break-words text-2xs text-subtle">
          {block.model} ·{" "}
          {t(
            block.status === "success"
              ? "生成完成"
              : block.status === "stopped"
                ? "已停止"
                : "生成失败",
          )}{" "}
          · {block.steps} {t("轮")}
          {block.tools.length ? ` · ${block.tools.join(", ")}` : ""}
        </p>
      );
    case "text":
      return <Markdown>{block.text}</Markdown>;

    case "secret":
      return <SecretBlock block={block} />;

    case "asset":
      return (
        <button
          type="button"
          className="paste-match"
          onClick={() => reveal(block.assetId, block.kind)}
        >
          <span className="flex-1 text-left text-meta">
            {t("打开{0}详情", t(KIND_LABEL[block.kind]))}
          </span>
        </button>
      );

    case "action":
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            block.action === "ssh" ? openSsh(block.assetId) : reveal(block.assetId, block.kind)
          }
        >
          <SquareTerminal className="size-3.5" />
          {block.label}
        </Button>
      );

    case "choices":
      return (
        <div className="flex flex-wrap gap-1.5">
          {block.options.map((o) => (
            <button
              key={o.assetId}
              type="button"
              className="tag-chip"
              onClick={() => reveal(o.assetId, o.kind)}
            >
              {o.label}
              <span className="opacity-55">{t(KIND_LABEL[o.kind])}</span>
            </button>
          ))}
        </div>
      );

    case "rows":
      return (
        <ul className="overflow-hidden rounded-xl bg-card shadow-card">
          {block.rows.map((row) => (
            <li key={row.assetId}>
              <button
                type="button"
                className="row-tap flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-line"
                onClick={() => row.assetId.startsWith("sample-") || reveal(row.assetId, row.kind)}
              >
                {row.status && <span className={dotClass(row.status)} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-meta font-medium">{row.label}</span>
                  {row.meta && (
                    <span className="block truncate text-2xs text-muted">{row.meta}</span>
                  )}
                </span>
                {row.status && row.status !== "online" && (
                  <span className={chipClass(row.status)}>
                    {row.status === "offline" ? t("告警") : t("注意")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * A password, resolved at render time.
 *
 * The message on disk holds only `{assetId, field}`; the value is fetched from
 * the vault when this mounts and lives in component state, never in history.
 */
function SecretBlock({ block }: { block: Extract<Block, { type: "secret" }> }) {
  const bridge = desktop();
  const unlocked = useVault((s) => s.unlocked);
  const requireVault = useVault((s) => s.require);
  const secrets = useAppStore((s) => s.secrets);
  const [value, setValue] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!bridge || !unlocked) return;
      try {
        const account = await bridge.vault.get(accountId(block.assetId));
        let found = account?.[block.field as keyof typeof account] as string | undefined;
        // A server's SSH password lives under its own key, not the account one.
        if (!found && block.kind === "server" && block.field === "password") {
          const ssh = await bridge.vault.get(credentialId(block.assetId));
          found = ssh?.password;
        }
        if (!alive) return;
        setValue(found ?? null);
        setMissing(!found);
      } catch {
        if (alive) setMissing(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bridge, unlocked, block.assetId, block.field, block.kind, secrets]);

  if (!bridge) {
    return <p className="text-meta text-muted">{t("桌面版才能读取加密库。")}</p>;
  }

  if (!unlocked) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void requireVault(t("查看 {0} 的信息需要先解锁密钥库。", block.label))}
      >
        <Lock className="size-3.5" />

        {t("解锁查看")}
      </Button>
    );
  }

  if (missing) {
    return (
      <p className="flex items-center gap-1.5 text-meta text-muted">
        <ShieldCheck className="size-3.5" />

        {t("这条资产还没有保存过这个字段。")}
      </p>
    );
  }

  if (value === null) return <p className="text-meta text-subtle">{t("读取中…")}</p>;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-2.5 shadow-card">
      <span className="min-w-0 flex-1 truncate font-mono text-meta">
        {shown ? value : "•".repeat(Math.min(20, value.length))}
      </span>
      <button
        type="button"
        aria-label={shown ? t("隐藏") : t("显示")}
        className="grid size-7 shrink-0 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
        onClick={() => setShown((v) => !v)}
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
      <button
        type="button"
        aria-label={t("复制")}
        className="grid size-7 shrink-0 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
        onClick={() => {
          void copyText(value);
          toast(t("已复制{0}", FIELD_TEXT[block.field]));
        }}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

const FIELD_TEXT: Record<SecretField, string> = {
  password: "密码",
  username: "账号",
  url: "登录地址",
  note: "备注",
};

/** The rail turns into the conversation list while the agent view is open. */
export function AgentHistory() {
  const conversations = useConversations((s) => s.conversations);
  const activeId = useConversations((s) => s.activeId);
  const open = useConversations((s) => s.open);
  const start = useConversations((s) => s.start);
  const remove = useConversations((s) => s.remove);

  return (
    <section className="overflow-hidden rounded-xl bg-card shadow-card">
      <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="font-semibold tracking-tight">{t("对话")}</h2>
        <button
          type="button"
          aria-label={t("新对话")}
          className="grid size-7 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
          onClick={() => start()}
        >
          <MessageSquarePlus className="size-4" />
        </button>
      </header>
      {conversations.length === 0 ? (
        <p className="px-4 pb-4 text-meta text-muted">{t("还没有对话。")}</p>
      ) : (
        <ul className="pb-2">
          {conversations.slice(0, 20).map((c) => (
            <li key={c.id} className="group/item relative">
              <button
                type="button"
                className={cn(
                  "row-tap flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-line",
                  c.id === activeId && "bg-line",
                )}
                onClick={() => open(c.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-meta">{c.title}</span>
                  <TimeAgo iso={c.updatedAt} className="block text-2xs text-subtle" />
                </span>
              </button>
              <button
                type="button"
                aria-label={t("删除对话")}
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full px-2 py-1 text-2xs text-subtle hover:text-crit group-hover/item:block"
                onClick={() => remove(c.id)}
              >
                {t("删除")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
