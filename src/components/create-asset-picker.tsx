import { Bot, FileText, Globe, KeyRound, Mail, Phone, Server, Shield } from "lucide-react";
import { createAsset, CREATE_LABELS, type CreateTarget } from "@/lib/create-asset";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { EditorDialog } from "./ui/editor-dialog";

const targets = [
  { target: "document", Icon: FileText, detail: "记录图片、链接与资产说明" },
  { target: "phone", Icon: Phone, detail: "查看到期日与关联订阅" },
  { target: "ai", Icon: Bot, detail: "管理订阅与月度开支" },
  { target: "mail", Icon: Mail, detail: "管理邮箱与账号归属" },
  { target: "server", Icon: Server, detail: "记录主机，按需配置连接" },
  { target: "service", Icon: Globe, detail: "管理 Workers、博客与自建服务" },
  { target: "domain", Icon: Globe, detail: "跟踪域名与续费日期" },
  { target: "cert", Icon: Shield, detail: "记录证书与到期时间" },
  { target: "secret", Icon: KeyRound, detail: "保存账号与加密凭据" },
] satisfies { target: CreateTarget; Icon: typeof Server; detail: string }[];

export function CreateAssetPicker() {
  const open = useAppStore((state) => state.createPickerOpen);
  const setOpen = useAppStore((state) => state.setCreatePickerOpen);
  if (!open) return null;
  return (
    <EditorDialog title={t("选择资产类型")} onClose={() => setOpen(false)}>
      <div className="editor-scroll">
        <p className="mb-4 text-sm text-muted">{t("选择这次要记录的内容。")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {targets.map(({ target, Icon, detail }) => (
            <button
              type="button"
              key={target}
              className="create-type-option"
              aria-label={t(CREATE_LABELS[target])}
              onClick={() => void createAsset(target)}
            >
              <Icon className="size-5 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t(CREATE_LABELS[target])}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">{t(detail)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </EditorDialog>
  );
}
