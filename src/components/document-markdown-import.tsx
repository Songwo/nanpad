import { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { importMarkdownFiles, type ImportResult } from "@/lib/markdown-import.mjs";
import { useDocuments } from "@/lib/documents";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import "./document-markdown-import.css";

export function DocumentMarkdownImport({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const importFiles = async (files: File[]) => {
    if (!files.length || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setReport(null);
    setProgress({ done: 0, total: files.length });
    try {
      const result = await importMarkdownFiles(
        files,
        (document) => useDocuments.getState().create([], document),
        (done, total) => setProgress({ done, total }),
      );
      setReport(result);
      if (result.imported) onImported();
      const message = t(
        "导入完成：{0} 篇成功，{1} 篇未导入。",
        result.imported,
        result.failed.length,
      );
      if (result.failed.length) toast.error(message);
      else toast.success(t("已导入 {0} 篇文档", result.imported));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.error(t(message));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="document-import-control">
      <div
        className="document-import-zone"
        data-dragging={dragging}
        aria-busy={busy}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void importFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          hidden
          aria-label={t("选择 Markdown 文件")}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void importFiles(files);
          }}
        />
        <Button
          variant="outline"
          className="document-import-button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          aria-describedby="document-import-hint"
        >
          {busy ? <Loader2 className="document-import-spinner" /> : <FileUp />}
          {busy ? t("正在导入 {0}/{1}", progress.done, progress.total) : t("导入 Markdown")}
        </Button>
        <p id="document-import-hint" className="document-import-hint">
          {dragging ? t("松开即可导入文档") : t("可多选或拖入 · 每篇最多 1 MiB")}
        </p>
      </div>
      {error && (
        <p role="alert" className="document-import-error">
          {t(error)}
        </p>
      )}
      {report && (
        <div className="document-import-report" role="status" aria-live="polite">
          <div className="document-import-report-heading">
            <span>
              {t("导入完成：{0} 篇成功，{1} 篇未导入。", report.imported, report.failed.length)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("关闭导入结果")}
              onClick={() => setReport(null)}
            >
              <X />
            </Button>
          </div>
          {(report.failed.length > 0 || report.notices.length > 0) && (
            <details>
              <summary>{t("查看导入详情")}</summary>
              <ul>
                {report.failed.map((item, index) => (
                  <li key={`error-${index}`} className="document-import-error">
                    <strong>{item.name}</strong> — {t(item.message)}
                  </li>
                ))}
                {report.notices.map((item, index) => (
                  <li key={`notice-${index}`}>
                    <strong>{item.name}</strong> —{" "}
                    {item.messages.map((message) => t(message)).join(" ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
