import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";

/**
 * Minimise / maximise / close, drawn by the app.
 *
 * The platform's own caption buttons cannot be restyled — their grey hover
 * squares are the one thing in the window that ignores the design system — so
 * on Windows and Linux the frame is off and these take over, using the same
 * rounded hover as the sidebar. macOS keeps its traffic lights: they are a
 * platform convention people reach for without looking.
 */
export function WindowControls() {
  const bridge = desktop();
  const [platform, setPlatform] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.win.state().then((s) => {
      if (!alive) return;
      setPlatform(s.platform);
      setMaximized(s.maximized);
    });
    const off = bridge.win.onMaximized(({ maximized: m }) => setMaximized(m));
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  if (!bridge || platform === null || platform === "darwin") return null;

  return (
    <div className="win-controls no-drag">
      <button type="button" aria-label="最小化" onClick={() => bridge.win.minimize()}>
        <Minus className="size-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => bridge.win.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={2} />
        ) : (
          <Square className="size-3.5" strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        aria-label="关闭"
        data-close
        onClick={() => bridge.win.close()}
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}
