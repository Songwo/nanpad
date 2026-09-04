/**
 * The changelog, in the app and in the repo.
 *
 * This file is the source of truth; `node scripts/write-changelog.mjs`
 * regenerates `CHANGELOG.md` from it so the two cannot drift.
 */
export interface Release {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const RELEASES: Release[] = [
  {
    version: "0.1.0",
    date: "2026-09-04",
    title: "第一个可用版本",
    changes: [
      "设置面板：主题（跟随系统 / 浅色 / 深色）、修改主密码、数据目录、版本与更新检查、更新日志。",
      "深色主题：表面按层级抬升而不是简单反色，阴影换成发丝描边，状态色与滚动条同步适配。",
      "窗口标题栏由应用自绘：整条都可拖拽，最小化 / 最大化 / 关闭与侧栏共用一套 hover。",
      "跨分类「分组」视图：一个标签看到它下面所有类型的资产，右栏与 ⌘K 都能跳进来。",
      "六类资产通用的标签与分组：标签条多选取交集，可切换平铺 / 按标签分节。",
      "每类资产都能附加密的账号密码：登录地址、账号、密码、备注，详情页一键复制。",
      "真实 SSH 终端（xterm + PTY）与主机指标采集（CPU / 内存 / 磁盘 / 负载 / 内核）。",
      "真实 WHOIS 与 DNS 查询、真实 TLS 握手读取证书，过期与不受信任会单独标红。",
      "scrypt + AES-256-GCM 凭据库；密钥完整值不再明文存放，首次解锁自动搬迁。",
      "三栏桌面布局与整套动效：FLIP 卡片放大、滑动标签下划线、视图切换入场、数字滚动。",
    ],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;
