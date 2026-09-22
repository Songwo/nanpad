import { chipClass, dotClass, STATUS_LABEL } from "@/lib/status";
import type { Status } from "@/lib/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  sonar = true,
  className,
}: {
  status: Status;
  sonar?: boolean;
  className?: string;
}) {
  return (
    <span
      key={status}
      className={cn(chipClass(status), "status-feedback inline-flex items-center gap-1.5", className)}
      data-status={status}
    >
      {sonar ? (
        <span className="sonar-beacon">
          <span
            className={cn(
              "sonar-ring",
              status === "warning" && "sonar-ring-warn",
              status === "offline" && "sonar-ring-crit",
            )}
          />
          <span
            className={cn(
              "live-dot",
              status === "warning" && "live-dot-warn",
              status === "offline" && "live-dot-crit",
            )}
          />
        </span>
      ) : (
        <span className={dotClass(status)} />
      )}
      <span>{t(STATUS_LABEL[status])}</span>
    </span>
  );
}

