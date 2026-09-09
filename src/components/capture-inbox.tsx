import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";
import { useAppStore } from "@/lib/store";
import { useProfile } from "@/lib/profile";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";

export function CaptureInbox() {
  const [items, setItems] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const ready = useProfile((s) => s.profile?.ready);
  const state = useAppStore();
  useEffect(() => {
    const bridge = desktop()?.capture;
    if (!bridge) return;
    let active = true;
    const refresh = () =>
      void bridge
        .list()
        .then((list) => {
          if (active) setItems(list);
        })
        .catch((error) => {
          if (active) toast.error(String(error));
        });
    const off = bridge.onChanged(refresh);
    refresh();
    return () => {
      active = false;
      off();
    };
  }, []);
  const item = items[0];
  if (
    !item ||
    !ready ||
    !state.hydrated ||
    state.composerOpen ||
    state.settingsOpen ||
    state.expanded
  )
    return null;
  async function dismiss() {
    await desktop()?.capture.discard(item.id);
    setItems((list) => list.filter((entry) => entry.id !== item.id));
  }
  return (
    <aside
      className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-lg rounded-lg border border-line bg-card p-4 shadow-float"
      aria-label={t("浏览器待保存网站")}
    >
      <div className="flex items-center gap-3">
        <ExternalLink className="size-5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <strong className="block truncate">{item.title}</strong>
          <p className="break-all text-meta text-muted">{item.url}</p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          title={t("忽略网站")}
          aria-label={t("忽略网站")}
          onClick={() => void dismiss().catch((e) => toast.error(String(e)))}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-meta text-muted">{t("{0} 个网站待确认", items.length)}</span>
        <Button
          onClick={() => {
            state.openComposer("secret", null, {
              kind: "password",
              name: item.title,
              _url: item.url,
            });
            void dismiss().catch((e) => toast.error(String(e)));
          }}
        >
          {t("填写账号并保存")}
        </Button>
      </div>
    </aside>
  );
}
