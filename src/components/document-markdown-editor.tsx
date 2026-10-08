import { useLayoutEffect, useRef } from "react";
import { t } from "@/lib/i18n";
import "./document-markdown-editor.css";

export function DocumentMarkdownEditor({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(360, input.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="document-markdown-input"
      aria-label={t("Markdown 源码")}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
