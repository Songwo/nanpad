import { useEffect, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDownToLine, ArrowUpToLine, ListTree, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import "./document-navigation.css";

type Heading = { element: HTMLElement; title: string; level: number };
export function DocumentNavigation({
  editor,
  readerRef,
}: {
  editor: Editor | null;
  readerRef: RefObject<HTMLDivElement | null>;
}) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reader = readerRef.current;
    if (!editor || !reader) return;
    let list: Heading[] = [];
    let frame = 0;
    const track = () => {
      frame = 0;
      const edge = reader.getBoundingClientRect().top + 64;
      const max = reader.scrollHeight - reader.clientHeight;
      setProgress(max > 1 ? Math.round(Math.min(1, reader.scrollTop / max) * 100) : 100);
      let index = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].element.getBoundingClientRect().top <= edge) index = i;
      }
      if (max > 1 && reader.scrollTop >= max - 2 && list.length) index = list.length - 1;
      setActive(index);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(track);
    };
    const collect = () => {
      // 使用实际标题元素定位，同名标题和编辑过程中改名都不会跳错章节。
      list = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).map(
        (element) => ({
          element,
          title: element.textContent?.trim() || t("未命名章节"),
          level: Number(element.tagName.slice(1)),
        }),
      );
      setHeadings(list);
      schedule();
    };
    collect();
    editor.on("update", collect);
    const observer = new MutationObserver(collect);
    observer.observe(editor.view.dom, { childList: true, subtree: true, characterData: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(reader);
    resize.observe(editor.view.dom);
    reader.addEventListener("scroll", schedule, { passive: true });
    return () => {
      editor.off("update", collect);
      observer.disconnect();
      resize.disconnect();
      reader.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [editor, readerRef]);
  const scroll = (target: "top" | "bottom" | HTMLElement) => {
    const reader = readerRef.current;
    if (!reader) return;
    const top =
      target === "top"
        ? 0
        : target === "bottom"
          ? reader.scrollHeight
          : reader.scrollTop +
            target.getBoundingClientRect().top -
            reader.getBoundingClientRect().top -
            24;
    reader.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    setOpen(false);
  };
  const baseLevel = Math.min(3, ...headings.map((heading) => heading.level));
  return (
    <nav className="document-navigation" aria-label={t("文档导航")}>
      <div
        className="document-reading-progress"
        role="progressbar"
        aria-label={t("阅读进度")}
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="ghost" size="sm" className="document-outline-trigger">
            <ListTree />
            <span>{t("目录")}</span>
            <span className="document-outline-count">{headings.length}</span>
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="document-outline-popover"
            side="top"
            align="start"
            sideOffset={12}
            collisionPadding={16}
            aria-label={t("文档目录")}
          >
            <div className="document-outline-heading">
              <strong>{t("文档目录")}</strong>
              <Popover.Close asChild>
                <Button size="icon" variant="ghost" aria-label={t("关闭目录")}>
                  <X />
                </Button>
              </Popover.Close>
            </div>
            {headings.length ? (
              <ol
                className="document-outline-list"
                onKeyDown={(event) => {
                  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
                  );
                  const index = buttons.indexOf(event.target as HTMLButtonElement);
                  if (index < 0) return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              buttons.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                  buttons[next]?.focus();
                }}
              >
                {headings.map((heading, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      data-depth={Math.min(2, heading.level - baseLevel)}
                      aria-current={active === index ? "location" : undefined}
                      onClick={() => scroll(heading.element)}
                    >
                      <span className="document-outline-number">{index + 1}</span>
                      <span>{heading.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="document-outline-empty">
                {t("暂无章节标题，添加标题后会自动生成目录。")}
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span
        className="document-current-heading"
        title={active >= 0 ? headings[active]?.title : t("文档开头")}
      >
        {active >= 0 ? headings[active]?.title : t("文档开头")}
      </span>
      <span className="document-progress-label" aria-hidden="true">
        {progress}%
      </span>
      <div className="document-navigation-buttons">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("回到顶部")}
          title={t("回到顶部")}
          onClick={() => scroll("top")}
        >
          <ArrowUpToLine />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("前往底部")}
          title={t("前往底部")}
          onClick={() => scroll("bottom")}
        >
          <ArrowDownToLine />
        </Button>
      </div>
    </nav>
  );
}
