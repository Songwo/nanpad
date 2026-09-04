import { Command } from "cmdk";
import { useEffect, type ReactNode } from "react";
import { NAV } from "./sidebar";
import { usePresence } from "@/lib/motion";
import { useAppStore } from "@/lib/store";
import { KIND_LABEL } from "@/lib/status";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const setView = useAppStore((s) => s.setView);
  const openSsh = useAppStore((s) => s.openSsh);
  const openComposer = useAppStore((s) => s.openComposer);
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);
  const { mounted, shown } = usePresence(open, 160);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useAppStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="anim-scrim absolute inset-0 bg-ink/30"
        data-shown={shown}
        aria-label="关闭搜索"
        onClick={() => setOpen(false)}
      />
      <Command
        className="anim-panel relative mx-auto mt-[12vh] w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-xl bg-card shadow-float"
        data-shown={shown}
        loop
      >
        <Command.Input
          autoFocus
          placeholder="搜索资产、跳转页面、连接 SSH…"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-body outline-none placeholder:text-subtle"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-meta text-muted">
            没有匹配项
          </Command.Empty>
          <Command.Group
            heading="页面"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle"
          >
            {NAV.map((n) => (
              <Item
                key={n.id}
                onSelect={() => {
                  setView(n.id);
                  setOpen(false);
                }}
              >
                {n.label}
              </Item>
            ))}
          </Command.Group>
          <Command.Group
            heading="服务器"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle"
          >
            {servers.map((s) => (
              <Item
                key={s.id}
                onSelect={() => {
                  setView("servers");
                  if (s.status !== "offline") openSsh(s.id);
                  setOpen(false);
                }}
              >
                SSH {s.name} · {s.host}
              </Item>
            ))}
          </Command.Group>
          <Command.Group
            heading="其它资产"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle"
          >
            {domains.map((d) => (
              <Item
                key={d.id}
                onSelect={() => {
                  setView("domains");
                  setOpen(false);
                }}
              >
                {KIND_LABEL.domain} {d.name}
              </Item>
            ))}
            {mailboxes.map((d) => (
              <Item
                key={d.id}
                onSelect={() => {
                  setView("mail");
                  setOpen(false);
                }}
              >
                {KIND_LABEL.mail} {d.address}
              </Item>
            ))}
            {aiAssets.map((d) => (
              <Item
                key={d.id}
                onSelect={() => {
                  setView("ai");
                  setOpen(false);
                }}
              >
                {KIND_LABEL.ai} {d.name}
              </Item>
            ))}
            {secrets.map((d) => (
              <Item
                key={d.id}
                onSelect={() => {
                  setView("vault");
                  setOpen(false);
                }}
              >
                {KIND_LABEL.secret} {d.name}
              </Item>
            ))}
            {certs.map((d) => (
              <Item
                key={d.id}
                onSelect={() => {
                  setView("certs");
                  setOpen(false);
                }}
              >
                {KIND_LABEL.cert} {d.cn}
              </Item>
            ))}
          </Command.Group>
          <Command.Group
            heading="操作"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle"
          >
            <Item
              onSelect={() => {
                openComposer("server");
                setOpen(false);
              }}
            >
              添加服务器
            </Item>
            <Item
              onSelect={() => {
                openComposer("domain");
                setOpen(false);
              }}
            >
              添加域名
            </Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function Item({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center rounded-md px-2 text-meta transition-colors duration-150 ease-out data-[selected=true]:bg-line"
    >
      {children}
    </Command.Item>
  );
}
