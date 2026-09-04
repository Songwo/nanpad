import { useEffect, useState } from "react";
import { useCountUp } from "@/lib/motion";
import { relativeTime } from "@/lib/utils";

/**
 * "3 分钟前", refreshed in place.
 *
 * The seed timestamps are built relative to module-load time, so the server and
 * the browser never agree on the exact wording — hence `suppressHydrationWarning`
 * plus a tick scheduled on mount, which re-renders with the browser's own value
 * on the first frame after hydration.
 */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    setTick(1);
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <span className={className} suppressHydrationWarning>
      {relativeTime(iso)}
    </span>
  );
}

/** A headline figure that eases up to its value instead of snapping to it. */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const n = useCountUp(value);
  return (
    <span className={className}>{format ? format(n) : Math.round(n).toLocaleString("zh-CN")}</span>
  );
}
