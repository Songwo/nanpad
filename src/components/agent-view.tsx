import {
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  MessageSquarePlus,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LogoMark } from "./logo";
import { Button } from "./ui/button";
import { TimeAgo } from "./ui/time-ago";
import { ask, SAMPLES, type Block, type SecretField } from "@/lib/agent";
import { useConversations, type Message } from "@/lib/conversations";
import { accountId, credentialId, desktop } from "@/lib/desktop";
import { chipClass, dotClass, KIND_LABEL } from "@/lib/status";
import { useAppStore, snapshotOf } from "@/lib/store";
import type { AssetKind } from "@/lib/types";
import { cn, copyText } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";

/**
 * Ask questions about your own estate.
 *
 * Everything here runs locally: the question is matched against the assets in
 * memory and answered from them. Nothing is sent anywhere, which is the only
 * arrangement that makes sense for something that can read a password out.
 */
export function AgentView() {
  const conversations = useConversations((s) => s.conversations);
  const activeId = useConversations((s) => s.activeId);
  const append = useConversations((s) => s.append);
  const start = useConversations((s) => s.start);
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeId]);

  function send(text: string) {
    const question = text.trim();
    if (!question) return;
    if (!activeId) start();
    append("you", [{ type: "text", text: question }]);
    const answer = ask(question, snapshotOf(useAppStore.getState()));
    append("agent", answer.blocks);
    setDraft("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 px-4 pb-4 pt-4">
        {messages.length === 0 ? (
          <Welcome onPick={send} />
        ) : (
          <div className="space-y-5 pb-4">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form
        className="sticky bottom-0 bg-canvas/85 px-4 pb-4 pt-2 backdrop-blur-md"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="relative">
          <textarea
            value={draft}
            rows={1}
            placeholder="问点什么，比如「我 163 那个邮箱的密码是多少」"
            className="agent-input"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <button
            type="submit"
            aria-label="发送"
            disabled={!draft.trim()}
            className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-ink text-card transition-transform duration-150 ease-out active:scale-90 disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <p className="mt-2 px-1 text-2xs text-subtle">
          全部在本机回答，不联网。密码从加密库现取现显，聊天记录里只存指向哪个资产的引用。
        </p>
      </form>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="stagger-in mx-auto max-w-xl pt-6">
      <LogoMark className="size-10" />
      <h2 className="mt-4 text-xl font-semibold tracking-tight">问问你自己的资产</h2>
      <p className="mt-2 text-meta leading-relaxed text-muted">
        密码、到期、用量、主机状态、分组——都在本机回答。
      </p>
      <div className="mt-5 grid gap-2">
        {SAMPLES.map((s) => (
          <button key={s} type="button" className="paste-match" onClick={() => onPick(s)}>
            <span className="flex-1 text-left text-meta">{s}</span>
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
    case "text":
      return <p className="whitespace-pre-wrap text-meta leading-relaxed">{block.text}</p>;

    case "secret":
      return <SecretBlock block={block} />;

    case "asset":
      return (
        <button
          type="button"
          className="paste-match"
          onClick={() => reveal(block.assetId, block.kind)}
        >
          <span className="flex-1 text-left text-meta">打开{KIND_LABEL[block.kind]}详情</span>
        </button>
      );

    case "action":
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => (block.action === "ssh" ? openSsh(block.assetId) : reveal(block.assetId, block.kind))}
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
              <span className="opacity-55">{KIND_LABEL[o.kind]}</span>
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
                  <span className={chipClass(row.status)}>{row.status === "offline" ? "告警" : "注意"}</span>
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
function SecretBlock({
  block,
}: {
  block: Extract<Block, { type: "secret" }>;
}) {
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
    return <p className="text-meta text-muted">桌面版才能读取加密库。</p>;
  }

  if (!unlocked) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void requireVault(`查看 ${block.label} 的信息需要先解锁密钥库。`)}
      >
        <Lock className="size-3.5" />
        解锁查看
      </Button>
    );
  }

  if (missing) {
    return (
      <p className="flex items-center gap-1.5 text-meta text-muted">
        <ShieldCheck className="size-3.5" />
        这条资产还没有保存过这个字段。
      </p>
    );
  }

  if (value === null) return <p className="text-meta text-subtle">读取中…</p>;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-2.5 shadow-card">
      <span className="min-w-0 flex-1 truncate font-mono text-meta">
        {shown ? value : "•".repeat(Math.min(20, value.length))}
      </span>
      <button
        type="button"
        aria-label={shown ? "隐藏" : "显示"}
        className="grid size-7 shrink-0 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
        onClick={() => setShown((v) => !v)}
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
      <button
        type="button"
        aria-label="复制"
        className="grid size-7 shrink-0 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
        onClick={() => {
          void copyText(value);
          toast(`已复制${FIELD_TEXT[block.field]}`);
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
        <h2 className="font-semibold tracking-tight">对话</h2>
        <button
          type="button"
          aria-label="新对话"
          className="grid size-7 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
          onClick={() => start()}
        >
          <MessageSquarePlus className="size-4" />
        </button>
      </header>
      {conversations.length === 0 ? (
        <p className="px-4 pb-4 text-meta text-muted">还没有对话。</p>
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
                aria-label="删除对话"
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full px-2 py-1 text-2xs text-subtle hover:text-crit group-hover/item:block"
                onClick={() => remove(c.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
