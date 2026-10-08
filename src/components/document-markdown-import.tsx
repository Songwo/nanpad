import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FilePlus2, FileUp, Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import { requestMarkdownImport } from "@/lib/document-import-events";

export function DocumentMarkdownImport({ onCreate }: { onCreate: () => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="documents-create-button"
          aria-label={t("添加文档")}
          title={t("添加文档")}
        >
          <Plus />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="document-actions-menu" align="end" sideOffset={8}>
          <DropdownMenu.Item className="document-actions-item" onSelect={onCreate}>
            <FilePlus2 className="size-4" />
            {t("新建文档")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="document-actions-item" onSelect={requestMarkdownImport}>
            <FileUp className="size-4" />
            {t("导入 Markdown")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="document-actions-separator" />
          <p className="document-create-hint">{t("也可以将 Markdown 拖入窗口任意位置")}</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
