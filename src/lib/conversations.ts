import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { Block } from "./agent";
import { desktop, isDesktop } from "./desktop";
import { uid } from "./utils";
import { t } from "./i18n.ts";

export interface Message {
  id: string;
  role: "you" | "agent";
  at: string;
  /** User messages carry one text block; answers carry the structured ones. */
  blocks: Block[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  hydrated: boolean;

  start: () => string;
  open: (id: string) => void;
  append: (role: Message["role"], blocks: Block[], conversationId?: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  setHydrated: (v: boolean) => void;
}

/**
 * Chat history, on disk beside the assets.
 *
 * Safe to write in the clear because of how answers are built: a message that
 * revealed a password stores `{type:"secret", assetId, field}`, never the value.
 * The file records which questions were asked, not any of the answers' secrets.
 */
const diskStorage: StateStorage = {
  getItem: async () => {
    const file = await desktop()?.store.loadConversations();
    return file ? JSON.stringify(file) : null;
  },
  setItem: async (_name, value) => {
    await desktop()?.store.saveConversations(JSON.parse(value));
  },
  removeItem: async () => {
    await desktop()?.store.saveConversations({});
  },
};

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function pickStorage(): StateStorage {
  if (typeof window === "undefined") return noopStorage;
  return isDesktop() ? diskStorage : window.localStorage;
}

/** First line of the first question, trimmed — enough to find it again. */
function titleFrom(blocks: Block[]): string {
  const text = blocks.find((b) => b.type === "text");
  const raw = text && text.type === "text" ? text.text : "";
  return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw || t("新对话");
}

export const useConversations = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      hydrated: false,

      start: () => {
        const id = uid("conv");
        const now = new Date().toISOString();
        set({
          conversations: [
            { id, title: t("新对话"), createdAt: now, updatedAt: now, messages: [] },
            ...get().conversations,
          ].slice(0, 100),
          activeId: id,
        });
        return id;
      },

      open: (activeId) => set({ activeId }),

      append: (role, blocks, conversationId) => {
        const id = conversationId ?? get().activeId ?? get().start();
        const now = new Date().toISOString();
        const message: Message = { id: uid("msg"), role, at: now, blocks };
        set({
          activeId: conversationId ? get().activeId : id,
          conversations: get().conversations.map((c) =>
            c.id !== id
              ? c
              : {
                  ...c,
                  updatedAt: now,
                  // The first thing you asked is what the conversation is about.
                  title: c.messages.length === 0 && role === "you" ? titleFrom(blocks) : c.title,
                  messages: [...c.messages, message],
                },
          ),
        });
      },

      remove: (id) =>
        set({
          conversations: get().conversations.filter((c) => c.id !== id),
          activeId: get().activeId === id ? null : get().activeId,
        }),

      clear: () => set({ conversations: [], activeId: null }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "sinan-conversations-v1",
      skipHydration: true,
      storage: createJSONStorage(pickStorage),
      partialize: (s) => ({ conversations: s.conversations }) as ConversationState,
    },
  ),
);
