import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { t } from "@/lib/i18n";

export function EditorDialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="editor-backdrop" />
        <Dialog.Content
          className="editor-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus.current;
            requestAnimationFrame(() => {
              if (
                target?.isConnected &&
                !document.querySelector(
                  '[role="dialog"]:not([data-state="closed"]):not([data-shown="false"])',
                )
              ) {
                target.focus({ preventScroll: true });
              }
            });
          }}
        >
          <div className="editor-heading">
            <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={closeLabel ?? t("关闭")}
              >
                <X />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
