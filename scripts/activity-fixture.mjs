import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { ActivityJournal } from "../src/components/activity-journal.tsx";
import { RefreshAllButton, RefreshOneButton } from "../src/components/refresh-button.tsx";
import { useAppStore } from "../src/lib/store.ts";
import { refreshById } from "../src/lib/probes.ts";
import "../src/styles.css";

export function mount() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const activity = Array.from({ length: 43 }, (_, index) => ({
    id: `journal-${index}`,
    at: new Date(now.getTime() - index * 1000).toISOString(),
    text: `测试活动 ${index}`,
    kind: index < 25 ? "server" : "domain",
  }));
  activity.push({
    id: "yesterday",
    at: yesterday.toISOString(),
    text: "昨日测试活动",
    kind: "domain",
  });
  const domain = {
    id: "journal-private-domain",
    name: "private-domain.example.test",
    registrar: "",
    account: "",
    expiresAt: "2030-01-01",
    nameservers: [],
    status: "online",
    notes: "private notes",
    tags: [],
  };
  useAppStore.setState({ activity, domains: [domain], servers: [], expanded: null });
  window.sinan = {
    domain: {
      probe: async () => ({
        nameservers: [],
        expiresAt: "2030-01-01",
        at: new Date().toISOString(),
      }),
    },
  };
  window.activityFixture = {
    store: useAppStore,
    background: () => refreshById("domain", domain.id),
    view: () =>
      useAppStore
        .getState()
        .setExpanded({ kind: "domain", id: domain.id, origin: { x: 0, y: 0, w: 100, h: 40 } }),
    close: () => useAppStore.getState().setExpanded(null),
  };
  document.documentElement.dataset.theme = "light";
  createRoot(document.getElementById("root")).render(
    h(
      "main",
      { className: "mx-auto max-w-3xl space-y-4 p-4" },
      h(
        "div",
        { className: "flex gap-3" },
        h(RefreshAllButton, { kind: "domain" }),
        h(RefreshOneButton, { kind: "domain", id: domain.id }),
      ),
      h(ActivityJournal),
    ),
  );
}
