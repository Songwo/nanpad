import { uploadImage } from "@/lib/image-bed";
import { ImageBedSettings } from "./image-bed-settings";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Code2,
  Link2,
  ImagePlus,
  Undo2,
  Redo2,
  Plus,
  FileText,
  Search,
  Save,
  Download,
  Trash2,
  X,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useDocuments, documentImage, type DocumentAsset } from "@/lib/documents";
import { assetEntries, refKey } from "@/lib/operations";
import { useAppStore } from "@/lib/store";
import { KIND_LABEL } from "@/lib/status";
import { desktop } from "@/lib/desktop";
import { downloadJson } from "@/lib/utils";
import { Button } from "./ui/button";
import { t } from "@/lib/i18n";

const fail = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : String(error));
export function DocumentsWorkspace() {
  const { list, selected, drafts, load, open, create } = useDocuments();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  useEffect(() => {
    void load().catch((e) => setError(String(e.message)));
    return () => {
      const s = useDocuments.getState();
      if (s.selected) void s.flush(s.selected).catch(fail);
    };
  }, [load]);
  const filtered = list.filter(
    (doc) =>
      (filter !== "unbound" || doc.bindings.length === 0) &&
      (doc.title + doc.excerpt).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="documents-workspace">
      <aside className="documents-list">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            {t("我的文档")} <span className="text-muted">{list.length}</span>
          </span>
          <Button
            size="icon-sm"
            aria-label={t("新建文档")}
            onClick={() => void create().catch(fail)}
          >
            <Plus />
          </Button>
        </div>
        <label className="documents-search">
          <Search className="size-4" />
          <input
            aria-label={t("搜索文档")}
            placeholder={t("搜索文档")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="flex gap-2 text-sm">
          {[
            ["all", "全部文档"],
            ["unbound", "未关联"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "doc-filter active" : "doc-filter"}
              onClick={() => setFilter(value)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-crit">
            {error}
          </p>
        )}
        <div className="space-y-2">
          {filtered.map((doc) => (
            <button
              type="button"
              key={doc.id}
              className={selected === doc.id ? "document-list-item active" : "document-list-item"}
              onClick={() => void open(doc.id).catch(fail)}
            >
              <span className="flex items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0" />
                <strong className="line-clamp-2 text-sm">{doc.title}</strong>
              </span>
              <span className="mt-2 line-clamp-2 text-xs text-muted">
                {doc.excerpt || t("开始记录你的想法")}
              </span>
              <span className="mt-3 flex justify-between text-xs text-muted">
                <span>
                  {doc.bindings.length ? t("关联 {0} 项资产", doc.bindings.length) : t("独立文档")}
                </span>
                <span>
                  {doc.imageCount > 0
                    ? t("{0} 张图片", doc.imageCount)
                    : new Date(doc.updatedAt).toLocaleDateString()}
                </span>
              </span>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <p className="py-6 text-center text-sm text-muted">{t("暂无匹配文档")}</p>
        )}
      </aside>
      {selected && drafts[selected] ? (
        <DocumentEditor key={selected} doc={drafts[selected]} />
      ) : (
        <div className="document-welcome">
          <FileText className="size-10 text-muted" />
          <h2 className="text-2xl font-semibold">{t("把资料留在资产旁边")}</h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            {t("部署笔记、项目方案、照片和参考链接，都可以保存成文档。关联资产是可选的。")}
          </p>
          <Button onClick={() => void create().catch(fail)}>
            <Plus />
            {t("创建第一篇文档")}
          </Button>
        </div>
      )}
    </div>
  );
}

function DocumentEditor({ doc }: { doc: DocumentAsset }) {
  const change = useDocuments((s) => s.change);
  const flush = useDocuments((s) => s.flush);
  const status = useDocuments((s) => s.status[doc.id]);
  const error = useDocuments((s) => s.errors[doc.id]);
  const snapshot = useAppStore(
    useShallow((s) => ({
      servers: s.servers,
      domains: s.domains,
      mailboxes: s.mailboxes,
      aiAssets: s.aiAssets,
      secrets: s.secrets,
      certs: s.certs,
    })),
  );
  const assets = assetEntries(snapshot);
  const [bindingQuery, setBindingQuery] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const uploadingRef = useRef(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ["http", "https"] },
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: { referrerpolicy: "no-referrer", loading: "lazy" },
      }),
    ],
    content: doc.content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "document-prose",
        role: "textbox",
        "aria-label": t("文档正文"),
        "aria-multiline": "true",
      },
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (anchor && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          const href = anchor.getAttribute("href");
          if (href && /^https?:\/\//i.test(href)) {
            const bridge = desktop();
            if (bridge) void bridge.openExternal(href).catch(fail);
            else window.open(href, "_blank", "noopener,noreferrer");
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const latest = useDocuments.getState().drafts[doc.id];
      change({ ...latest, content: editor.getJSON() });
    },
  });
  useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            heading: editor.isActive("heading"),
            list: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            quote: editor.isActive("blockquote"),
            code: editor.isActive("codeBlock"),
            undo: editor.can().undo(),
            redo: editor.can().redo(),
          }
        : null,
  });
  const update = (patch: Partial<DocumentAsset>) =>
    change({ ...useDocuments.getState().drafts[doc.id], ...patch });
  const toolbar = [
    {
      label: "粗体",
      Icon: Bold,
      active: editor?.isActive("bold"),
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      Icon: Italic,
      active: editor?.isActive("italic"),
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "标题",
      Icon: Heading2,
      active: editor?.isActive("heading"),
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "无序列表",
      Icon: List,
      active: editor?.isActive("bulletList"),
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      Icon: ListOrdered,
      active: editor?.isActive("orderedList"),
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      Icon: Quote,
      active: editor?.isActive("blockquote"),
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "代码块",
      Icon: Code2,
      active: editor?.isActive("codeBlock"),
      run: () => editor?.chain().focus().toggleCodeBlock().run(),
    },
  ];
  const insertImages = async (files: File[]) => {
    if (uploadingRef.current) return;
    if (files.length > 20) {
      fail(new Error("每次最多上传 20 张图片"));
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setUploadError("");
    setRetryFiles([]);
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setUploadProgress("正在上传图片 " + (index + 1) + " / " + files.length);
      try {
        const src = await documentImage(file);
        if (editor && !editor.isDestroyed && useDocuments.getState().selected === doc.id)
          editor.chain().focus().setImage({ src, alt: file.name }).createParagraphNear().run();
        else {
          const latest = useDocuments.getState().drafts[doc.id];
          if (latest)
            change({
              ...latest,
              content: {
                ...latest.content,
                content: [
                  ...(latest.content.content ?? []),
                  { type: "image", attrs: { src, alt: file.name } },
                ],
              },
            });
        }
        void useDocuments.getState().flush(doc.id).catch(fail);
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : String(e));
        setRetryFiles(files.slice(index));
        break;
      }
    }
    uploadingRef.current = false;
    setUploading(false);
    setUploadProgress("");
  };
  const migrateImages = async () => {
    const api = desktop()?.images;
    if (!api) return;
    if (!(await api.status()).enabled) {
      fail(new Error("请先启用图床上传"));
      return;
    }
    if (uploadingRef.current) return;
    const sources = new Map<string, string>();
    const walk = (node: import("@tiptap/react").JSONContent) => {
      if (node.type === "image" && node.attrs?.src?.startsWith("data:image/"))
        sources.set(node.attrs.src, node.attrs.alt ?? "image");
      node.content?.forEach(walk);
    };
    walk(useDocuments.getState().drafts[doc.id].content);
    if (!sources.size) {
      fail(new Error("当前文档没有内嵌图片"));
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setUploadError("");
    setRetryFiles([]);
    let completed = 0;
    try {
      for (const [source, name] of sources) {
        setUploadProgress("迁移内嵌图片 " + ++completed + " / " + sources.size);
        const url = await uploadImage(source, name, "document");
        const latest = useDocuments.getState().drafts[doc.id];
        if (!latest) break;
        const replace = (
          node: import("@tiptap/react").JSONContent,
        ): import("@tiptap/react").JSONContent => ({
          ...node,
          ...(node.type === "image" && node.attrs?.src === source
            ? { attrs: { ...node.attrs, src: url } }
            : {}),
          ...(node.content ? { content: node.content.map(replace) } : {}),
        });
        const content = replace(latest.content);
        change({ ...latest, content });
        if (editor && !editor.isDestroyed && useDocuments.getState().selected === doc.id)
          editor.commands.setContent(content, { emitUpdate: false });
        await useDocuments.getState().flush(doc.id);
      }
    } catch (e) {
      setUploadError(
        (e instanceof Error ? e.message : String(e)) + "；已迁移的图片已保留，再点迁移可继续",
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      setUploadProgress("");
    }
  };
  const choices = assets.filter((a) => a.label.toLowerCase().includes(bindingQuery.toLowerCase()));
  return (
    <div className="document-detail">
      <div className="document-toolbar">
        <div className="flex flex-wrap items-center gap-1">
          {toolbar.map(({ label, Icon, active, run }) => (
            <button
              type="button"
              key={label}
              title={t(label)}
              aria-label={t(label)}
              aria-pressed={Boolean(active)}
              onClick={run}
            >
              <Icon className="size-4" />
            </button>
          ))}
          <span className="mx-1 h-5 border-l border-line" />
          <button
            type="button"
            title={t("插入链接")}
            aria-label={t("插入链接")}
            onClick={() => setLink(editor?.getAttributes("link").href ?? "")}
          >
            <Link2 className="size-4" />
          </button>
          <button
            type="button"
            title={t("插入图片")}
            aria-label={t("插入图片")}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t("撤销")}
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t("重做")}
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="size-4" />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void insertImages(files);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" onClick={() => void flush(doc.id).catch(fail)}>
          <Save />
          {t(status === "saved" ? "已保存" : status === "saving" ? "保存中…" : "保存")}
        </Button>
      </div>
      <div className="border-b border-line px-4 py-2">
        <ImageBedSettings />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={uploading}
          onClick={() => void migrateImages().catch(fail)}
        >
          上传文档内的本地图片
        </Button>
        <p className="mt-2 text-xs text-muted">
          支持选择多张图片、粘贴截图或拖入照片。删除图片只移除文档引用，不删除图床文件。
        </p>
      </div>
      {uploadError && (
        <div role="alert" className="m-4 rounded-md border border-crit p-3 text-sm text-crit">
          {uploadError}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || retryFiles.length === 0}
            onClick={() => void insertImages(retryFiles)}
          >
            重试上传
          </Button>
        </div>
      )}
      {link !== null && (
        <form
          className="document-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const url = new URL(link);
              if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
                throw new Error("链接只支持 HTTP 或 HTTPS");
              if (editor?.state.selection.empty)
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: link,
                    marks: [{ type: "link", attrs: { href: url.href } }],
                  })
                  .run();
              else
                editor?.chain().focus().extendMarkRange("link").setLink({ href: url.href }).run();
              setLink(null);
            } catch (err) {
              fail(err);
            }
          }}
        >
          <input
            type="url"
            required
            autoFocus
            aria-label={t("链接地址")}
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <Button size="sm" type="submit">
            {t("插入")}
          </Button>
          <button type="button" aria-label={t("取消")} onClick={() => setLink(null)}>
            <X className="size-4" />
          </button>
        </form>
      )}
      {error && (
        <div role="alert" className="m-4 rounded-md border border-crit p-3 text-sm text-crit">
          {t("保存失败，内容仍保留在编辑器中：")}
          {error}
        </div>
      )}
      <div className="document-edit-grid">
        <article className="document-paper">
          <input
            className="document-title"
            aria-label={t("文档标题")}
            placeholder={t("未命名文档")}
            value={doc.title}
            maxLength={160}
            onChange={(e) => update({ title: e.target.value })}
          />
          <div className="mb-8 flex flex-wrap gap-3 text-xs text-muted">
            <span>{t("自动保存到本机")}</span>
            <span>
              {t("更新于")} {new Date(doc.updatedAt).toLocaleString()}
            </span>
            {uploading && <span role="status">{uploadProgress}</span>}
          </div>
          <EditorContent
            editor={editor}
            onPasteCapture={(event) => {
              const files = Array.from(event.clipboardData.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (files.length) {
                event.preventDefault();
                event.stopPropagation();
                void insertImages(files);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) event.preventDefault();
            }}
            onDropCapture={(event) => {
              const files = Array.from(event.dataTransfer.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (files.length) {
                event.preventDefault();
                event.stopPropagation();
                void insertImages(files);
              }
            }}
          />
        </article>
        <aside className="document-bindings">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="size-4" />
            {t("关联资产")}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {t("可选关联一项或多项资产。取消关联不会删除文档。")}
          </p>
          <input
            className="doc-binding-search"
            aria-label={t("查找关联资产")}
            placeholder={t("搜索资产名称")}
            value={bindingQuery}
            onChange={(e) => setBindingQuery(e.target.value)}
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {choices.map((asset) => (
              <label className="document-binding" key={refKey(asset)}>
                <input
                  type="checkbox"
                  checked={doc.bindings.some((ref) => refKey(ref) === refKey(asset))}
                  onChange={(e) =>
                    update({
                      bindings: e.target.checked
                        ? [...doc.bindings, { kind: asset.kind, id: asset.id }]
                        : doc.bindings.filter((ref) => refKey(ref) !== refKey(asset)),
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{asset.label}</span>
                  <span className="text-xs text-muted">{t(KIND_LABEL[asset.kind])}</span>
                </span>
              </label>
            ))}
            {!choices.length && (
              <p className="py-4 text-xs text-muted">
                {t("没有匹配的资产，可以先保存为独立文档。")}
              </p>
            )}
          </div>
          {doc.bindings
            .filter((ref) => !assets.some((a) => refKey(a) === refKey(ref)))
            .map((ref) => (
              <button
                type="button"
                className="my-2 text-xs text-muted"
                key={refKey(ref)}
                onClick={() =>
                  update({ bindings: doc.bindings.filter((r) => refKey(r) !== refKey(ref)) })
                }
              >
                {t("移除已不存在的关联")} <X className="inline size-3" />
              </button>
            ))}
          <div className="mt-6 grid gap-2 border-t border-line pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadJson(doc.title + ".json", doc)}
            >
              <Download />
              {t("导出文档")}
            </Button>
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => {
                if (window.confirm(t("删除这篇文档？关联的资产不会受影响。")))
                  void useDocuments.getState().remove(doc.id).catch(fail);
              }}
            >
              <Trash2 />
              {t("删除文档")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
