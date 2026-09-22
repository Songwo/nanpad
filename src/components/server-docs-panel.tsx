import { BookOpen, Check, Copy, Download, Eye, FileCode, FileText, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";
import { useAppStore } from "@/lib/store";
import type { Server } from "@/lib/types";
import { t } from "@/lib/i18n";

const DOCS_TEMPLATES: { label: string; icon: string; content: (s: Server) => string }[] = [
  {
    label: "VLESS-Reality 部署与维护",
    icon: "⚡",
    content: (s) => `# ${s.name} - Xray VLESS Reality 节点运维指南

## 1. 服务端配置 (/usr/local/etc/xray/config.json)
\`\`\`json
{
  "inbounds": [
    {
      "port": 443,
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "YOUR_UUID_HERE",
            "flow": "xtls-rprx-vision"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "gateway.icloud.com:443",
          "xver": 0,
          "serverNames": ["gateway.icloud.com"],
          "privateKey": "YOUR_SERVER_PRIVATE_KEY",
          "shortIds": ["1a2b3c4d"]
        }
      }
    }
  ],
  "outbounds": [
    { "protocol": "freedom" }
  ]
}
\`\`\`

## 2. 常用维护指令
- 重启服务: \`systemctl restart xray\`
- 查看状态: \`systemctl status xray\`
- 实时日志: \`journalctl -u xray -f\`
`,
  },
  {
    label: "Nginx 反代与 SSL 配置",
    icon: "🌐",
    content: (s) => `# ${s.name} - Nginx 反向代理与 SSL 备忘

## 1. 站点反代配置 (/etc/nginx/conf.d/${s.host || "app"}.conf)
\`\`\`nginx
server {
    listen 80;
    server_name ${s.host || "example.com"};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${s.host || "example.com"};

    ssl_certificate /etc/letsencrypt/live/${s.host || "example.com"}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${s.host || "example.com"}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
\`\`\`

## 2. 重新加载
\`\`\`bash
nginx -t && systemctl reload nginx
\`\`\`
`,
  },
  {
    label: "Docker Compose 常用基础栈",
    icon: "🐳",
    content: (s) => `# ${s.name} - Docker 服务编排清单

\`\`\`yaml
version: '3.8'

services:
  caddy:
    image: caddy:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
\`\`\`

## 维护命令
- 后台启动: \`docker compose up -d\`
- 停止容器: \`docker compose down\`
- 查看日志: \`docker compose logs -f\`
`,
  },
  {
    label: "Linux SSH 安全硬化清单",
    icon: "🛡️",
    content: (s) => `# ${s.name} - 服务器安全与硬化备忘

## 1. SSH 配置强化 (/etc/ssh/sshd_config)
- 禁止 Root 密码远程登录: \`PermitRootLogin prohibit-password\`
- 禁用纯密码验证: \`PasswordAuthentication no\`
- 更改默认端口: \`Port ${s.port || 22}\`

## 2. UFW 防火墙放行
\`\`\`bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ${s.port || 22}/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
\`\`\`

## 3. 安装 Fail2ban
\`\`\`bash
apt install fail2ban -y && systemctl enable --now fail2ban
\`\`\`
`,
  },
];

export function ServerDocsPanel({ server }: { server: Server }) {
  const upsertServer = useAppStore((s) => s.upsertServer);
  const [docContent, setDocContent] = useState(server.docs || "");
  const [mode, setMode] = useState<"preview" | "edit">(server.docs ? "preview" : "edit");
  const [hasUnsaved, setHasUnsaved] = useState(false);

  useEffect(() => {
    setDocContent(server.docs || "");
    setHasUnsaved(false);
  }, [server.id, server.docs]);

  function handleChange(val: string) {
    setDocContent(val);
    setHasUnsaved(val !== (server.docs || ""));
  }

  function handleSave() {
    upsertServer({
      ...server,
      docs: docContent,
    });
    setHasUnsaved(false);
    toast.success(t("文档已保存"));
  }

  function applyTemplate(templateContent: string) {
    if (docContent.trim() && !window.confirm(t("当前文档非空，应用模板将覆盖现有内容，确定继续吗？"))) {
      return;
    }
    const updated = templateContent;
    setDocContent(updated);
    upsertServer({
      ...server,
      docs: updated,
    });
    setHasUnsaved(false);
    setMode("preview");
    toast.success(t("已应用运维文档模板"));
  }

  async function handleCopyDoc() {
    if (!docContent.trim()) {
      toast(t("文档内容为空"));
      return;
    }
    try {
      await navigator.clipboard.writeText(docContent);
      toast.success(t("已复制全文 Markdown 内容"));
    } catch {
      toast.error(t("复制失败"));
    }
  }

  function handleExportDoc() {
    if (!docContent.trim()) {
      toast(t("文档内容为空"));
      return;
    }
    const blob = new Blob([docContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${server.name || "server"}-runbook.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("已导出 Markdown 文件: {0}", a.download));
  }

  return (
    <div className="space-y-3 p-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
            <BookOpen className="size-4 text-sky-400" />
            {t("服务器文档 & Runbook")}
            {hasUnsaved && (
              <span className="size-2 rounded-full bg-amber-400 animate-ping" title={t("存在未保存更改")} />
            )}
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {t("记录该主机的安装备忘、服务配置、部署脚本及运维文档（支持 Markdown 渲染）")}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mode Switch */}
          <div className="flex rounded-lg border border-line bg-surface-subtle p-0.5 mr-1">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "edit"
                  ? "bg-card text-ink shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <FileCode className="size-3.5" />
              {t("编辑")}
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "preview"
                  ? "bg-card text-ink shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <Eye className="size-3.5" />
              {t("预览")}
            </button>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopyDoc}
            title={t("复制全文 Markdown")}
            className="size-7"
          >
            <Copy className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleExportDoc}
            title={t("导出 Markdown 文件")}
            className="size-7"
          >
            <Download className="size-3.5" />
          </Button>

          <Button
            variant={hasUnsaved ? "primary" : "outline"}
            size="sm"
            onClick={handleSave}
            className="btn-pill h-7 text-xs px-3 ml-1"
          >
            <Save className="mr-1 size-3.5" />
            {hasUnsaved ? t("保存更改") : t("已保存")}
          </Button>
        </div>
      </div>

      {/* Templates Selector Pill Bar */}
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        <span className="text-[11px] text-muted flex items-center gap-1 mr-1">
          <Sparkles className="size-3 text-amber-400" />
          {t("常用模版")}:
        </span>
        {DOCS_TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            onClick={() => applyTemplate(tpl.content(server))}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-subtle px-2.5 py-0.5 text-[11px] text-muted hover:text-ink hover:border-line-focus hover:bg-line/40 transition-colors"
          >
            <span>{tpl.icon}</span>
            <span>{t(tpl.label)}</span>
          </button>
        ))}
      </div>

      {/* Content Area */}
      {mode === "edit" ? (
        <div className="relative rounded-xl border border-line bg-canvas overflow-hidden focus-within:border-line-focus transition-colors">
          <textarea
            value={docContent}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={t("在此处编写服务器专属 Markdown 文档、运维命令、配置文件等...")}
            rows={14}
            className="w-full resize-y bg-transparent p-3.5 font-mono text-xs text-ink outline-none leading-relaxed placeholder:text-muted/60"
          />
          <div className="border-t border-line/60 bg-surface-subtle/50 px-3 py-1.5 flex justify-between items-center text-[11px] text-muted font-mono">
            <span>{t("{0} 字符", docContent.length)}</span>
            <span>Markdown GFM Supported</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-card p-4 min-h-[280px] max-h-[460px] overflow-y-auto">
          {docContent.trim() ? (
            <Markdown>{docContent}</Markdown>
          ) : (
            <div className="py-12 text-center text-muted">
              <FileText className="mx-auto size-8 opacity-40 mb-2" />
              <p className="text-xs">{t("暂未撰写文档，可切换到“编辑”模式或点击上方模版快速开始")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
