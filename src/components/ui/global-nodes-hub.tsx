import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { ServerNodesPanel } from "../server-nodes-panel";
import { Button } from "./button";
import { Plus, Activity } from "lucide-react";
export function GlobalNodesHub() {
  const servers = useAppStore((s) => s.servers);
  const [selected, setSelected] = useState("");
  const server = servers.find((s) => s.id === selected) ?? servers[0];
  const count = servers.reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">自建节点</h2>
          <p className="mt-2 text-sm text-muted">
            {count} 个已录入节点 · {servers.length} 台服务器
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => useAppStore.getState().setView("usage")}>
            <Activity />
            流量记录
          </Button>
          <Button variant="outline" onClick={() => useAppStore.getState().openComposer("server")}>
            <Plus />
            添加服务器
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-card p-4 text-sm text-muted">
        3x-ui
        的真实流量在「用量记录」中连接面板后采集，可按入站或客户端筛选并关联节点。机场订阅统计整个订阅的用量。
      </div>
      {server ? (
        <div className="rounded-xl border border-line">
          <label className="flex flex-wrap items-center gap-3 border-b border-line p-4 text-sm">
            所属服务器
            <select
              aria-label="所属服务器"
              className="min-w-0 rounded-md border border-line bg-card p-2"
              value={server.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.nodes?.length ?? 0} 个节点）
                </option>
              ))}
            </select>
          </label>
          <ServerNodesPanel key={server.id} server={server} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line p-10 text-center">
          <h3 className="font-semibold">先添加节点所属服务器</h3>
          <p className="my-3 text-sm text-muted">填写服务器名称与地址后，即可录入真实节点。</p>
          <Button onClick={() => useAppStore.getState().openComposer("server")}>添加服务器</Button>
        </div>
      )}
    </div>
  );
}
