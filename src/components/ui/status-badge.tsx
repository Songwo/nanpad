import { chipClass, dotClass, STATUS_LABEL } from "@/lib/status";
import type { Status } from "@/lib/types";
import { t } from "@/lib/i18n";

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span key={status} className={`${chipClass(status)} status-feedback`} data-status={status}>
      <span className={dotClass(status)} />
      {t(STATUS_LABEL[status])}
    </span>
  );
}
