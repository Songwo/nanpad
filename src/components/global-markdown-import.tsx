import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { importMarkdownFiles, type ImportResult } from "@/lib/markdown-import.mjs";
import { useDocuments } from "@/lib/documents";
import { useAppStore } from "@/lib/store";
import { useSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";
import { OPEN_MARKDOWN_IMPORT, MARKDOWN_IMPORTED } from "@/lib/document-import-events";
import { Button } from "./ui/button";
import "./document-markdown-import.css";

const isMarkdown = (file: File) => /\.(md|markdown)$/i.test(file.name);

// 只挂载一次，切换页面不丢失正在导入的进度和结果。
export function GlobalMarkdownImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const importFiles = useCallback(async (files: File[]) => {
    if (!files.length || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setReport(null);
    setProgress({ done: 0, total: files.length });
    try {
      if (!useDocuments.getState().loaded) await useDocuments.getState().load();
      const result = await importMarkdownFiles(
        files,
        (document) => useDocuments.getState().create([], document),
        (done, total) => setProgress({ done, total }),
      );
      setReport(result);
      if (result.imported) {
        useSettings.getState().setDocumentListCollapsed(false);
        useAppStore.getState().setView("docs");
        window.dispatchEvent(new Event(MARKDOWN_IMPORTED));
      }
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
  }, []);

  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const mayContainMarkdown = (event: DragEvent) => {
      const items = Array.from(event.dataTransfer?.items ?? []).filter(
        (item) => item.kind === "file",
      );
      // 浏览器在松手前可能隐藏文件名；图片拖入继续交给正文编辑器处理。
      return (
        items.length === 0 ||
        items.some((item) => {
          const file = item.getAsFile();
          return file
            ? isMarkdown(file)
            : [
                "",
                "text/plain",
                "text/markdown",
                "text/x-markdown",
                "application/octet-stream",
              ].includes(item.type);
        })
      );
    };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event) || !mayContainMarkdown(event)) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // 阻止浏览器用外部文件替换当前页面，不截断图片处理事件。
      event.preventDefault();
      if (mayContainMarkdown(event) && event.dataTransfer)
        event.dataTransfer.dropEffect = running.current ? "none" : "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) reset();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      reset();
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.some(isMarkdown)) return;
      event.stopPropagation();
      // 混合拖入仍逐项显示失败原因，图片不会被意外插入正在编辑的正文。
      void importFiles(files);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    const choose = () => {
      if (!running.current) inputRef.current?.click();
    };
    window.addEventListener(OPEN_MARKDOWN_IMPORT, choose);
    window.addEventListener("dragenter", enter, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener(OPEN_MARKDOWN_IMPORT, choose);
      window.removeEventListener("dragenter", enter, true);
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", escape);
    };
  }, [importFiles]);

  return (
    <>
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
      {dragging && (
        <div className="global-markdown-drop" role="status" aria-live="polite">
          <div className="global-markdown-drop-card">
            <FileUp aria-hidden="true" />
            <strong>{t(busy ? "文档正在导入，请稍候" : "松开即可导入文档")}</strong>
            <p>{t("支持 .md / .markdown · 最多 50 篇 · 每篇最多 1 MiB")}</p>
            <span>{t("在任意页面拖入，导入后自动打开文档")}</span>
          </div>
        </div>
      )}
      {(busy || report || error) && (
        <section className="document-import-feedback" aria-label={t("Markdown 导入结果")}>
          {busy && (
            <div role="status" className="document-import-progress">
              <Loader2 className="document-import-spinner" />
              <span>{t("正在导入 {0}/{1}", progress.done, progress.total)}</span>
            </div>
          )}
          {error && (
            <div className="document-import-report-heading">
              <p role="alert" className="document-import-error">
                {t(error)}
              </p>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("关闭导入结果")}
                onClick={() => setError("")}
              >
                <X />
              </Button>
            </div>
          )}
          {report && (
            <div className="document-import-report" role="status" aria-live="polite">
              <div className="document-import-report-heading">
                <span>
                  {t("导入完成：{0} 篇成功，{1} 篇未导入。", report.imported, report.failed.length)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
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
        </section>
      )}
    </>
  );
}
