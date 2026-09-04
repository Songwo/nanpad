import { useEffect, useState } from "react";
import { WindowControls } from "./window-controls";
import { desktop } from "@/lib/desktop";
import { useAppStore } from "@/lib/store";
import type { ViewId } from "@/lib/types";

const VIEW_NAME: Record<ViewId, string> = {
  overview: "总览",
  servers: "服务器",
  domains: "域名",
  mail: "邮箱",
  ai: "AI 订阅",
  vault: "密钥",
  certs: "证书",
  tags: "分组",
  agent: "问答",
  terminal: "终端",
};

/**
 * The window's own title bar.
 *
 * With the native frame off, something has to be draggable — and hanging that
 * off the sidebar header alone left the window un-draggable whenever the right
 * rail collapsed. A real bar across the whole top drags at any width, gives the
 * controls a home, and doubles as the window title.
 */
export function TitleBar() {
  const bridge = desktop();
  const view = useAppStore((s) => s.view);
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.win.state().then((s) => {
      if (alive) setPlatform(s.platform);
    });
    return () => {
      alive = false;
    };
  }, [bridge]);

  if (!bridge) return null;

  return (
    <header
      className="drag-strip flex h-11 shrink-0 items-center gap-2 border-b border-line bg-canvas pl-3 pr-1.5"
      onDoubleClick={() => bridge.win.toggleMaximize()}
    >
      {/* macOS draws its traffic lights over the top-left; leave them room. */}
      {platform === "darwin" && <span className="w-16 shrink-0" />}
      <span className="truncate text-2xs text-subtle">
        司南 <span className="px-1">·</span> {VIEW_NAME[view]}
      </span>
      <span className="flex-1" />
      <WindowControls />
    </header>
  );
}
