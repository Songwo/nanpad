import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { AgentView } from "../src/components/agent-view.tsx";
import { useConversations } from "../src/lib/conversations.ts";
import { useDocuments } from "../src/lib/documents.ts";
import { useAppStore } from "../src/lib/store.ts";
import "../src/styles.css";

// 与组件采用相同模块解析，避免开发热更新的查询参数产生第二份 store。
export function mount() {
  const now = new Date().toISOString();
  const qa = (window.__qa = { requests: [], listeners: new Set(), saved: [], failSave: false });
  const doc = {
    id: "doc-qa",
    title: "合成文档",
    content: { type: "doc", content: [] },
    createdAt: now,
    updatedAt: now,
    bindings: [],
  };
  window.sinan = {
    store: {
      save: async () => {},
      loadConversations: async () => null,
      saveConversations: async () => {},
    },
    agent: {
      config: async () => ({ model: "synthetic-test-model" }),
      onEvent: (fn) => {
        qa.listeners.add(fn);
        return () => qa.listeners.delete(fn);
      },
      run: (request) => {
        qa.requests.push(request);
        return new Promise((resolve, reject) => {
          qa.resolve = resolve;
          qa.reject = reject;
        });
      },
      cancel: async () => {
        qa.reject(new Error("已停止生成。"));
        return true;
      },
    },
    documents: {
      get: async () => doc,
      save: async (draft) => {
        qa.saved.push(draft.id);
        await new Promise((resolve) => (qa.finishSave = resolve));
        if (qa.failSave) throw new Error("合成保存失败");
        return draft;
      },
    },
  };
  qa.conversations = useConversations;
  qa.documents = useDocuments;
  qa.app = useAppStore;
  useConversations.setState({
    hydrated: true,
    activeId: "conv-a",
    conversations: ["a", "b"].map((id) => ({
      id: "conv-" + id,
      title: "测试对话 " + id.toUpperCase(),
      messages: [],
      createdAt: now,
      updatedAt: now,
    })),
  });
  useAppStore.setState({ view: "agent" });
  document.documentElement.dataset.theme = "light";
  createRoot(document.getElementById("root")).render(
    h(
      "div",
      { style: { height: "100dvh", display: "flex", width: "100%" } },
      h("main", { className: "agent-shell-main", style: { flex: 1 } }, h(AgentView)),
      h(Toaster),
    ),
  );
  qa.ready = true;
}
