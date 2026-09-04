import { Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AiCard,
  CertCard,
  DomainCard,
  MailCard,
  SecretCard,
  ServerCard,
} from "./asset-card";
import { AccountPanel } from "./account-panel";
import { RefreshOneButton } from "./refresh-button";
import { Button } from "./ui/button";
import { cardRect, flipTransform, reduceMotion } from "@/lib/motion";
import { PROBEABLE, type ProbeKind } from "@/lib/probes";
import { useAppStore, type ExpandState } from "@/lib/store";
import type { AssetKind } from "@/lib/types";

const ENTER_MS = 340;
const EXIT_MS = 220;

/**
 * The detail sheet grows out of the card that was clicked and shrinks back into
 * it — a FLIP against the card's real rectangle, remeasured on the way out so a
 * scroll (or a resize) mid-session still lands on the card rather than where it
 * used to be.
 */
export function ExpandLayer() {
  const expanded = useAppStore((s) => s.expanded);
  const setExpanded = useAppStore((s) => s.setExpanded);
  const openComposer = useAppStore((s) => s.openComposer);
  const remove = useAppStore((s) => s.remove);

  const [visible, setVisible] = useState<ExpandState | null>(null);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const exitTimer = useRef(0);

  // `expanded` is the source of truth; local state only outlives it for the
  // length of the exit.
  useEffect(() => {
    if (expanded) {
      window.clearTimeout(exitTimer.current);
      closing.current = false;
      setVisible(expanded);
      return;
    }
    if (!visible || closing.current) return;
    closing.current = true;
    setShown(false);
    const el = panel.current;
    if (el && !reduceMotion()) {
      const from = cardRect(visible.id) ?? visible.origin;
      el.style.transition = `transform ${EXIT_MS}ms var(--ease-out), opacity ${EXIT_MS}ms ease-in`;
      el.style.transform = flipTransform(from, el.getBoundingClientRect());
      el.style.opacity = "0";
    }
    exitTimer.current = window.setTimeout(
      () => setVisible(null),
      reduceMotion() ? 0 : EXIT_MS,
    );
  }, [expanded, visible]);

  // Enter: paint at the card's rectangle, then release to the laid-out one.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !visible || closing.current) return;
    if (reduceMotion()) {
      setShown(true);
      return;
    }
    const to = el.getBoundingClientRect();
    el.style.transition = "none";
    el.style.transform = flipTransform(visible.origin, to);
    el.style.opacity = "0.25";
    // Force the closed frame to land before the transition is armed.
    const _reflow = el.offsetWidth;
    el.style.transition = `transform ${ENTER_MS}ms var(--ease-out-soft), opacity ${Math.round(ENTER_MS * 0.6)}ms var(--ease-out)`;
    el.style.transform = "translate3d(0, 0, 0) scale(1)";
    el.style.opacity = "1";
    setShown(true);
  }, [visible]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const close = useCallback(() => setExpanded(null), [setExpanded]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, close]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8 sm:py-12"
      role="dialog"
      aria-modal="true"
      aria-label="资产详情"
    >
      <button
        type="button"
        aria-label="关闭"
        className="anim-scrim absolute inset-0 bg-ink/35"
        data-shown={shown}
        onClick={close}
      />
      <div
        ref={panel}
        className="anim-flip relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl bg-card shadow-float"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-meta font-medium text-muted">资产详情</span>
          <div className="flex items-center gap-1">
            {isProbeKind(visible.kind) && (
              <RefreshOneButton kind={visible.kind} id={visible.id} />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openComposer(visible.kind, visible.id)}
              aria-label="编辑"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => remove(visible.kind, visible.id)}
              aria-label="删除"
            >
              <Trash2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={close} aria-label="关闭">
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="max-h-[min(70vh,640px)] overflow-y-auto">
          <ExpandedBody kind={visible.kind} id={visible.id} />
          <AccountPanel assetId={visible.id} kind={visible.kind} />
        </div>
      </div>
    </div>
  );
}

function ExpandedBody({ kind, id }: { kind: AssetKind; id: string }) {
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);

  switch (kind) {
    case "server": {
      const d = servers.find((x) => x.id === id);
      return d ? <ServerCard data={d} compact={false} /> : <Missing />;
    }
    case "domain": {
      const d = domains.find((x) => x.id === id);
      return d ? <DomainCard data={d} compact={false} /> : <Missing />;
    }
    case "mail": {
      const d = mailboxes.find((x) => x.id === id);
      return d ? <MailCard data={d} compact={false} /> : <Missing />;
    }
    case "ai": {
      const d = aiAssets.find((x) => x.id === id);
      return d ? <AiCard data={d} compact={false} /> : <Missing />;
    }
    case "secret": {
      const d = secrets.find((x) => x.id === id);
      return d ? <SecretCard data={d} compact={false} /> : <Missing />;
    }
    case "cert": {
      const d = certs.find((x) => x.id === id);
      return d ? <CertCard data={d} compact={false} /> : <Missing />;
    }
  }
}

/** Narrow the asset kind down to the three the app can actually go and check. */
function isProbeKind(kind: AssetKind): kind is ProbeKind {
  return (PROBEABLE as readonly string[]).includes(kind);
}

function Missing() {
  return <p className="p-6 text-meta text-muted">资产不存在或已删除。</p>;
}
