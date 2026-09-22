import { uploadImage } from "./image-bed";
import { inspectRaster } from "../../electron/services/image-data.mjs";
import { create } from "zustand";
import type { JSONContent } from "@tiptap/react";
import type { AssetRef } from "./operations";
import { desktop } from "./desktop";

export interface DocumentAsset {
  id: string;
  title: string;
  content: JSONContent;
  bindings: AssetRef[];
  createdAt: string;
  updatedAt: string;
}
export interface DocumentSummary extends Omit<DocumentAsset, "content"> {
  excerpt: string;
  imageCount: number;
}
export interface DocumentsBridge {
  list(): Promise<DocumentSummary[]>;
  get(id: string): Promise<DocumentAsset>;
  save(doc: DocumentAsset): Promise<DocumentAsset>;
  remove(id: string): Promise<void>;
}
const local: DocumentsBridge = {
  async list() {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("nanpad-doc:doc-"));
    return keys
      .map((k) => summary(JSON.parse(localStorage.getItem(k)!)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id) {
    const raw = localStorage.getItem("nanpad-doc:" + id);
    if (!raw) throw new Error("文档不存在");
    return JSON.parse(raw);
  },
  async save(doc) {
    const next = { ...doc, updatedAt: new Date().toISOString() };
    localStorage.setItem("nanpad-doc:" + doc.id, JSON.stringify(next));
    return next;
  },
  async remove(id) {
    localStorage.removeItem("nanpad-doc:" + id);
  },
};
function api() {
  return desktop()?.documents ?? local;
}
export function summary(doc: DocumentAsset): DocumentSummary {
  const texts: string[] = [];
  let imageCount = 0;
  const walk = (node: JSONContent) => {
    if (node.text) texts.push(node.text);
    if (node.type === "image") imageCount++;
    node.content?.forEach(walk);
  };
  walk(doc.content);
  return {
    id: doc.id,
    title: doc.title,
    bindings: doc.bindings,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    excerpt: texts.join(" ").slice(0, 180),
    imageCount,
  };
}
interface State {
  list: DocumentSummary[];
  drafts: Record<string, DocumentAsset>;
  status: Record<string, "saved" | "saving" | "dirty" | "error">;
  errors: Record<string, string>;
  selected: string | null;
  loaded: boolean;
  load(): Promise<void>;
  open(id: string): Promise<void>;
  create(bindings?: AssetRef[]): Promise<void>;
  change(doc: DocumentAsset): void;
  flush(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
export const useDocuments = create<State>((set, get) => ({
  list: [],
  drafts: {},
  status: {},
  errors: {},
  selected: null,
  loaded: false,
  async load() {
    const list = await api().list();
    set({ list, loaded: true });
  },
  async open(id) {
    const existing = get().selected;
    if (existing && get().status[existing] !== "saved") await get().flush(existing);
    const doc = get().drafts[id] ?? (await api().get(id));
    set((s) => ({
      selected: id,
      drafts: { ...s.drafts, [id]: doc },
      status: { ...s.status, [id]: s.status[id] ?? "saved" },
    }));
  },
  async create(bindings = []) {
    const existing = get().selected;
    if (existing && get().status[existing] !== "saved") await get().flush(existing);
    const now = new Date().toISOString();
    const doc = await api().save({
      id: "doc-" + crypto.randomUUID(),
      title: "未命名文档",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      bindings,
      createdAt: now,
      updatedAt: now,
    });
    set((s) => ({
      selected: doc.id,
      drafts: { ...s.drafts, [doc.id]: doc },
      list: [summary(doc), ...s.list],
      status: { ...s.status, [doc.id]: "saved" },
    }));
  },
  change(doc) {
    set((s) => ({
      drafts: { ...s.drafts, [doc.id]: doc },
      status: { ...s.status, [doc.id]: "dirty" },
      list: s.list.map((item) => (item.id === doc.id ? summary(doc) : item)),
    }));
    clearTimeout(timers.get(doc.id));
    timers.set(
      doc.id,
      setTimeout(() => {
        void get()
          .flush(doc.id)
          .catch(() => {});
      }, 800),
    );
  },
  async flush(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (running.has(id)) return running.get(id)!;
    const save = async () => {
      while (get().status[id] !== "saved") {
        const draft = get().drafts[id];
        if (!draft) return;
        set((s) => ({ status: { ...s.status, [id]: "saving" } }));
        try {
          const saved = await api().save(draft);
          if (get().drafts[id] === draft) {
            set((s) => ({
              drafts: { ...s.drafts, [id]: saved },
              status: { ...s.status, [id]: "saved" },
              errors: { ...s.errors, [id]: "" },
              list: s.list.map((item) => (item.id === id ? summary(saved) : item)),
            }));
          } else set((s) => ({ status: { ...s.status, [id]: "dirty" } }));
        } catch (error) {
          set((s) => ({
            status: { ...s.status, [id]: "error" },
            errors: { ...s.errors, [id]: error instanceof Error ? error.message : String(error) },
          }));
          throw error;
        }
      }
    };
    const job = save().finally(() => running.delete(id));
    running.set(id, job);
    return job;
  },
  async remove(id) {
    await get().flush(id);
    await api().remove(id);
    set((s) => {
      const drafts = { ...s.drafts },
        status = { ...s.status },
        errors = { ...s.errors };
      delete drafts[id];
      delete status[id];
      delete errors[id];
      return {
        drafts,
        status,
        errors,
        selected: s.selected === id ? null : s.selected,
        list: s.list.filter((x) => x.id !== id),
      };
    });
  },
}));
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (event) => {
    if (Object.values(useDocuments.getState().status).some((s) => s !== "saved")) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

/** 缩放图片后交给内部上传接口；未启用图床时保持本地嵌入。 */
export async function documentImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error("请选择 8 MiB 以内的 PNG、JPEG 或 WebP 图片");
  inspectRaster(new Uint8Array(await file.arrayBuffer()), file.type);
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL("image/png");
    while (data.length > 2.6 * 1024 * 1024 && canvas.width > 400 && canvas.height > 400) {
      canvas.width = Math.max(1, Math.round(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.75));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL("image/png");
    }
    if (data.length > 2.6 * 1024 * 1024) throw new Error("图片压缩后仍过大，请裁剪后重试");
    return await uploadImage(data, file.name, "document");
  } finally {
    bitmap.close();
  }
}
