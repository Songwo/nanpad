import { createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../src/components/ui/button.tsx";
import { Select } from "../src/components/ui/select.tsx";
import { GlobalNodesHub } from "../src/components/ui/global-nodes-hub.tsx";
import { ServerSecretsPanel } from "../src/components/server-secrets-panel.tsx";
import { useAppStore } from "../src/lib/store.ts";
import "../src/styles.css";

function Controls() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [saved, setSaved] = useState("");
  const options = [
    { value: "", label: "请选择测试选项" },
    { value: "alpha", label: "Alpha" },
    { value: "disabled", label: "禁用选项", disabled: true },
    { value: "beta", label: "Beta" },
    { value: "long", label: "https://example.test/" + "long-segment-".repeat(16) },
    ...Array.from({ length: 30 }, (_, index) => ({
      value: `extra-${index}`,
      label: `滚动选项 ${String(index).padStart(2, "0")}`,
    })),
  ];
  return h(
    "main",
    { className: "mx-auto max-w-2xl space-y-5 p-5" },
    h("h1", { className: "text-xl font-semibold" }, "统一控件回归"),
    h(
      "form",
      {
        id: "qa-controls-form",
        onSubmit(event) {
          event.preventDefault();
          setSaved(new FormData(event.currentTarget).get("choice"));
        },
      },
      h(
        "fieldset",
        { disabled: busy, className: "space-y-4" },
        h(Select, {
          name: "choice",
          required: true,
          "aria-label": "测试选项",
          options,
          value,
          onValueChange: setValue,
        }),
        h(
          "div",
          { className: "flex flex-wrap gap-3" },
          h(Button, { onClick: () => setClicks((count) => count + 1) }, "普通操作"),
          h(Button, { type: "submit", variant: "outline" }, "提交表单"),
        ),
      ),
    ),
    h(Button, { onClick: () => setBusy((state) => !state), variant: "secondary" }, "切换忙碌"),
    h("output", { "data-testid": "form-result" }, saved),
    h("output", { "data-testid": "click-count" }, String(clicks)),
    h(
      "div",
      { className: "flex flex-wrap gap-3" },
      ...[
        "solid",
        "primary",
        "secondary",
        "outline",
        "ghost",
        "danger",
        "danger-ghost",
        "luxury",
      ].map((variant) => h(Button, { key: variant, variant, "data-variant": variant }, variant)),
      h(Button, { disabled: true }, "禁用按钮"),
      h(Button, { asChild: true }, h("a", { href: "#anchor" }, "按钮链接")),
    ),
  );
}

function Panels() {
  const server = useAppStore((state) => state.servers[0]);
  return h(
    "main",
    { className: "mx-auto max-w-3xl space-y-5 p-4" },
    h(GlobalNodesHub),
    h(ServerSecretsPanel, { server }),
  );
}

export function mount(mode) {
  document.documentElement.dataset.theme = "light";
  if (mode === "panels") {
    const base = {
      host: "example.test",
      port: 22,
      username: "",
      label: "",
      os: "",
      region: "",
      status: "warning",
      cpu: 0,
      memory: 0,
      disk: 0,
      uptime: "",
      lastSeen: "",
      tags: [],
      notes: "",
    };
    useAppStore.setState({
      servers: [
        { ...base, id: "controls-host-a", name: "测试服务器 A", nodes: [] },
        { ...base, id: "controls-host-b", name: "测试服务器 B", nodes: [] },
      ],
      secrets: [
        {
          id: "controls-secret",
          name: "隔离测试凭据",
          kind: "token",
          hint: "测试占位内容",
          tags: [],
        },
      ],
    });
  }
  createRoot(document.getElementById("root")).render(h(mode === "panels" ? Panels : Controls));
}
