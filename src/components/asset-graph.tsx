import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Globe,
  Shield,
  Server,
  Mail,
  KeyRound,
  Sparkles,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  Link2,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import { assetGraph, type AssetRow } from "@/lib/asset-view";
import type { AssetLink } from "@/lib/operations";
import { KIND_LABEL } from "@/lib/status";
import { t } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { useSettings } from "@/lib/settings";
import { openFromEvent } from "./asset-card";
import { StatusBadge } from "./ui/status-badge";
import { Button } from "./ui/button";
import { useAppStore } from "@/lib/store";
import { refKey } from "@/lib/operations";

type AssetNode = Node<{ asset: AssetRow; vertical: boolean }, "asset">;
const ICONS = {
  domain: Globe,
  cert: Shield,
  server: Server,
  mail: Mail,
  ai: Sparkles,
  secret: KeyRound,
};
function GraphNode({ id, data, isConnectable }: NodeProps<AssetNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => updateNodeInternals(id), [id, data.vertical, updateNodeInternals]);
  const asset = data.asset;
  const Icon = ICONS[asset.kind];
  return (
    <div className="asset-graph-node" data-asset-id={asset.id} data-asset-kind={asset.kind}>
      <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
        isConnectable={isConnectable}
      />
      <div className="graph-node-meta">
        <span>
          <Icon className="size-4" />
          {t(KIND_LABEL[asset.kind])}
        </span>
        <StatusBadge status={asset.status} />
      </div>
      <button
        className="nodrag asset-name"
        title={t("查看 {0}", asset.name)}
        onClick={(e) => openFromEvent(e, asset.kind, asset.id)}
      >
        <span>{asset.name}</span>
        <small>{asset.detail}</small>
      </button>
      <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
        isConnectable={isConnectable}
      />
    </div>
  );
}
const nodeTypes = { asset: GraphNode };

export default function AssetGraph(props: { rows: AssetRow[]; links: AssetLink[] }) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({ rows, links }: { rows: AssetRow[]; links: AssetLink[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState(false);
  const [frameSize, setFrameSize] = useState("");
  const nodesInitialized = useNodesInitialized();
  const [linkMode, setLinkMode] = useState(false);
  const graph = useMemo(() => assetGraph(rows, links, vertical), [rows, links, vertical]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AssetNode>(graph.nodes);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const theme = useSettings((s) => s.resolved);
  const duration = reduceMotion() ? 0 : 180;
  const topology = JSON.stringify([vertical, graph.nodes.map((node) => node.id)]);
  const previousTopology = useRef(topology);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => {
      setVertical(element.clientWidth < 600);
      setFrameSize(`${element.clientWidth}:${element.clientHeight}`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // 数据更新保留拖动位置；筛选导致节点集合变化时重新布局并适配。
    const preserve = previousTopology.current === topology;
    previousTopology.current = topology;
    setNodes((previous) =>
      graph.nodes.map((node) => ({
        ...node,
        position:
          (preserve && previous.find((old) => old.id === node.id)?.position) || node.position,
      })),
    );
  }, [graph.nodes, setNodes, topology]);
  useEffect(() => {
    if (!nodesInitialized) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [topology, fitView, nodesInitialized, frameSize]);
  return (
    <div ref={container} className="asset-graph" role="region" aria-label={t("资产关系图")}>
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={1.8}
        nodesConnectable={linkMode}
        onConnect={({ source, target }) => {
          if (!linkMode) return;
          const from = rows.find((row) => encodeURIComponent(refKey(row)) === source);
          const to = rows.find((row) => encodeURIComponent(refKey(row)) === target);
          if (from && to) useAppStore.getState().linkAssets(from, to);
        }}
        edgesFocusable={false}
        deleteKeyCode={null}
        colorMode={theme}
        ariaLabelConfig={{
          "node.a11yDescription.default": t("资产节点"),
          "node.a11yDescription.keyboardDisabled": t("资产节点"),
        }}
      />
      <div className="graph-toolbar">
        <span className="graph-count">{t("{0} 条关联", graph.edges.length)}</span>
        <div className="graph-controls">
          <Button
            size="icon-sm"
            variant={linkMode ? "solid" : "ghost"}
            aria-pressed={linkMode}
            title={t("连接资产")}
            aria-label={t("连接资产")}
            onClick={() => setLinkMode(!linkMode)}
          >
            <Link2 className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title={t("放大")}
            aria-label={t("放大")}
            onClick={() => void zoomIn({ duration })}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title={t("缩小")}
            aria-label={t("缩小")}
            onClick={() => void zoomOut({ duration })}
          >
            <Minus className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title={t("适应画布")}
            aria-label={t("适应画布")}
            onClick={() => void fitView({ padding: 0.2, duration })}
          >
            <Maximize className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title={t("重排节点")}
            aria-label={t("重排节点")}
            onClick={() => {
              setNodes(graph.nodes);
              requestAnimationFrame(() => void fitView({ padding: 0.2, duration }));
            }}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
