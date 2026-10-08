import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Monitor, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { LocalUsageStatus } from "@/lib/usage";
import { Button } from "./ui/button";
import { LocalUsagePanel } from "./local-usage-panel";
import "./local-usage-control.css";

export function LocalUsageControl(props: {
  status: LocalUsageStatus | null;
  onChange: () => Promise<void>;
  onViewHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const attention = Boolean(
    props.status?.error || props.status?.sources.some((source) => source.error),
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" className="local-monitor-trigger" aria-label={t("采集与监控")}>
          <Monitor />
          {t("采集与监控")}
          <span
            className="local-monitor-dot"
            data-active={props.status?.enabled}
            data-error={attention}
          />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="local-monitor-overlay" />
        <Dialog.Content className="local-monitor-dialog">
          <div className="local-monitor-heading">
            <div>
              <Dialog.Title className="text-lg font-semibold">{t("采集与监控")}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                {t("查看客户端状态、管理采集，统计与图表保留在用量页面。")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon-sm" variant="ghost" aria-label={t("关闭监控详情")}>
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div className="local-monitor-body">
            <LocalUsagePanel
              {...props}
              onViewHistory={() => {
                setOpen(false);
                props.onViewHistory();
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
