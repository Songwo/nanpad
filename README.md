# 司南 · Nanpad

> 个人数字资产指挥台 —— 一个真实可用的桌面软件。服务器、域名、邮箱、AI 订阅、密钥与证书，一屏尽览。

司南（Sīnán）是汉代的磁石罗盘：一块方形地盘，一根永远知道方向的勺针。这个软件做的是同一件事——把散落在各处的数字资产收进一块盘面，让你一眼看出**哪边有问题**。

**它不是一个网页 demo。** 主机指标通过真实 SSH 连接采集，域名到期日来自真实 WHOIS 查询，证书信息是直接跟对方服务器握手读回来的，终端是真的 PTY。

![证书视图](screenshots/certs.png)

<sub>上图是真实数据：github.com 的 Sectigo 证书还有 87 天，npmjs.org 的 Google Trust Services 证书还有 79 天，而 expired.badssl.com 被判定为 `CERT_HAS_EXPIRED` 并冒泡到右栏「需要留意」。</sub>

---

## 目录

- [这是什么](#这是什么)
- [真实到什么程度](#真实到什么程度)
- [截图](#截图)
- [安装与运行](#安装与运行)
- [功能](#功能)
- [安全模型](#安全模型)
- [界面与动效](#界面与动效)
- [键盘快捷键](#键盘快捷键)
- [项目结构](#项目结构)
- [设计系统](#设计系统)
- [打包分发](#打包分发)
- [技术栈](#技术栈)
- [已知边界](#已知边界)
- [路线图](#路线图)

---

## 这是什么

一个 **Electron 桌面应用**，跑在你自己的电脑上，不连任何后端服务器，没有账号，没有云端。

它解决的问题是：你手上有几台 VPS、十几个域名、一堆邮箱转发规则、几个 AI 订阅、若干 API Key 和 SSL 证书。它们分散在阿里云、Cloudflare、OpenAI、1Password……**没有任何一个地方能同时告诉你「下周有什么要到期、哪台机器现在不对劲」**。司南就是那个地方。

架构上分两半：

- **主进程（Node）** —— 握着真实能力：`ssh2` 连服务器、`net` 打 WHOIS、`tls` 握手读证书、`crypto` 加密凭据库
- **渲染进程（React）** —— 只管界面，通过 `contextBridge` 暴露的一个白名单 API 跟主进程说话，拿不到 Node，也拿不到未列出的 IPC 通道

同一套界面代码还能作为网页跑（`npm run dev`），那种模式下没有主进程，SSH 终端退化成一个明确标注「模拟会话」的演示壳——用来预览界面，不用来干活。

---

## 真实到什么程度

| 能力 | 实现 | 说明 |
| --- | --- | --- |
| **SSH 终端** | `ssh2` + `xterm.js` | 真实 PTY。真的登录、真的回显、Ctrl-C 真的会打断远端进程，窗口拉伸会把新的行列数同步给远端 |
| **主机指标** | SSH 一次性脚本 | CPU 取两次 `/proc/stat` 采样（间隔 400ms）算出来，不是 `top` 的首帧假值；内存读 `MemAvailable`，磁盘读 `df -Pk /`，另带 uptime、负载、内核版本 |
| **域名到期** | 原生 WHOIS（TCP 43） | IANA 查 TLD 归属 → 注册局 → 最多再跟一跳注册商。解析注册商、注册日、到期日、域名状态 |
| **DNS** | `dns.resolveNs` | NS 记录以实时查询为准，WHOIS 里的记录只作兜底；再据此推断 DNS 服务商（Cloudflare / Route 53 / DNSPod…） |
| **SSL 证书** | `tls.connect` | 直接握手，读签发者、有效期、SAN、序列号、协议版本。**故意不校验证书链**——过期或不受信任正是要报出来的情况，拒绝握手反而会把它藏起来 |
| **凭据存储** | scrypt + AES-256-GCM | 主密码派生密钥只存在内存，磁盘上只有密文 |
| 邮箱 / AI 订阅 / 密钥 | 手工录入 | 这两类没有通用协议可查（IMAP 与各家计费 API 差异太大），目前只做记录与到期提醒 |

不联网的东西一律不假装：没连过的主机不会显示编造的 CPU 数字，采集失败会把失败原因直接写在卡片上。

---

## 截图

<table>
<tr>
<td width="50%"><img src="screenshots/domains.png" alt="域名视图"><br><em>真实 WHOIS：注册商、到期倒计时、DNS 服务商</em></td>
<td width="50%"><img src="screenshots/credentials.png" alt="凭据录入"><br><em>录入主机时填 SSH 凭据，可当场「测试连接」</em></td>
</tr>
</table>

![首次启动](screenshots/first-run.png)

---

## 安装与运行

需要 **Node 22+**。

```bash
npm install
npm run desktop
```

这会启动渲染进程的 Vite 开发服务器（`127.0.0.1:8090`）并拉起 Electron 窗口，改代码即时热更新。

想直接跑打包好的界面（不带热更新）：

```bash
npm run desktop:build
npx electron .
```

只想在浏览器里看界面（无真实能力，SSH 为模拟）：

```bash
npm run dev     # http://localhost:8080
```

> Windows 上 `npm run dev` 走 `scripts/with-app-env.mjs`，该脚本用 `spawn` 直接调 `vite`，在 Windows 会报 `ENOENT`。替代命令：
>
> ```bash
> node scripts/with-app-env.mjs node node_modules/vite/bin/vite.js dev --host 0.0.0.0 --port 8080
> ```

### 第一次用

桌面版**首次启动是空的**——不塞演示数据，因为这里的按钮会真的拨号出去，示例 IP 只会变成一排连接失败。

1. 点「添加第一台主机」，填主机名、IP、端口、用户名
2. 在「SSH 凭据」里选密码或私钥，点**测试连接**确认能通
3. 保存时会让你设一个**主密码**（第一次），凭据加密后落盘
4. 之后每个视图右上角的「刷新」会去采集真实数据；解锁密钥库后，主机指标每 90 秒自动扫一轮

---

## 功能

| 模块 | 说明 |
| --- | --- |
| **总览** | 健康分、在线主机数、AI 月费、待处理数；支出趋势图；最近动态 |
| **服务器** | 主机名 / IP / 端口 / 系统 / 区域 / 标签；CPU·内存·磁盘来自真实采集；一键开真实 SSH 会话 |
| **域名** | WHOIS 实查：注册商、到期倒计时、域名状态、实时 NS 记录 |
| **邮箱** | 邮箱 / 别名 / 转发三种类型，容量占用（手工录入） |
| **AI 订阅** | 厂商、套餐、月费、本月用量、续费日（手工录入） |
| **密钥** | API / SSH / 密码 / Token，一键复制 |
| **证书** | TLS 实查：签发者、有效期、SAN、协议版本、证书链是否受信 |
| **终端** | 真实 SSH 会话，xterm.js 渲染，命令历史与窗口 resize 都是原生行为 |

**状态语义**（全局一致，三色制）：

- 🟢 **正常** —— 无需关注
- 🟡 **注意** —— 到期 ≤ 21 天 / 负载 ≥ 78% / 用量 ≥ 90%
- 🔴 **告警** —— 主机不可达、证书链不受信、到期 ≤ 7 天、资源 ≥ 90%

右栏「需要留意」把六类资产的异常按严重度汇总在一起，不随视图切换。

---

## 安全模型

**存在哪里**

| 内容 | 位置 | 形式 |
| --- | --- | --- |
| 资产记录 | `%APPDATA%/Nanpad/assets.json`（macOS 为 `~/Library/Application Support/Nanpad`） | 明文 JSON |
| SSH 密码 / 私钥 | 同目录 `vault.enc` | AES-256-GCM 密文 |
| 主密码 | **哪儿都不存** | 只在内存里派生成密钥 |

**怎么加密**

主密码经 `scrypt`（N=2^15, r=8, p=1）派生出 32 字节密钥，每条记录独立随机 IV，AES-256-GCM 加密并保存认证标签。解锁校验用的是一段密封常量而非口令哈希——磁盘上没有任何可以离线爆破口令的材料。锁定（或退出）之后密钥即从内存丢弃。

**边界在哪**

- 凭据**不写入** `assets.json`，导出 JSON 时也不会带出去
- 渲染进程拿不到明文私钥：编辑主机时只回读「已保存（密码/私钥）」这个事实，不回读值
- `contextIsolation: true`、`nodeIntegration: false`，preload 里通道名写死，页面无法访问未列出的 IPC
- 打包页面带 CSP，只允许本地脚本
- **本软件不是密码管理器**：一个能读你用户目录的进程，仍然可以在你解锁期间读到内存中的密钥。它防的是「笔记本丢了 / 备份被翻」，不是本机上的恶意程序

---

## 界面与动效

桌面端是 **三栏布局**：左侧导航、中间内容列、右侧常驻信息栏（全局搜索 / 需要留意 / 快捷终端 / 最近动态）。中间列的卡片列数用 CSS **容器查询**决定，跟随列宽而不是窗口宽度——右栏占掉 340px，视口断点看不到这件事。

窗口是无边框的：侧栏顶部是拖拽区，右栏为系统窗口按钮让出 52px。

动效遵循一条原则：**交互状态用 transition，一次性入场用 keyframes**。前者能在动画中途反向、不会卡住；后者只在元素出现时跑一次。

- **卡片放大 / 收起** —— FLIP 共享元素动画。详情面板从被点击的那张卡片长出来，关掉时缩回**它当前的真实位置**（滚动过也不会缩错地方）
- **标签下划线** —— 一根横条在两个标签之间滑动，宽度贴合文字
- **视图切换** —— 内容整体 opacity + translateY + blur 入场，列表项 40ms 阶梯错峰
- **数字滚动** —— 健康分、月费等大数字三次缓出滚到位
- **弹层** —— 遮罩淡入、面板 blur + scale 入场；退场时长约为入场一半（退场不该抢注意力）
- **采集反馈** —— 探测中的卡片显示「正在采集…」，失败时把失败原因留在卡片上
- **终端** —— 玻璃背景模糊，xterm 主题与全局 token 同源

全部动效受 `prefers-reduced-motion: reduce` 保护。

---

## 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `⌘K` / `Ctrl+K` | 全局搜索：跳转页面、定位资产、直接连 SSH |
| `⌘N` / `Ctrl+N` | 在当前分类下新建资产 |
| `/` | 打开命令面板 |
| `Esc` | 关闭当前弹层 / 详情（终端里 Esc 归远端 shell，用标题栏关闭） |

---

## 项目结构

```
electron/
├─ main.mjs               主进程：窗口、菜单、IPC 路由、单实例
├─ preload.cjs            contextBridge → window.sinan（唯一对外接口）
├─ renderer/index.html    渲染进程入口（CSP 在这里）
└─ services/
   ├─ ssh.mjs             ssh2 连接管理、PTY 会话、指标采集脚本、错误翻译
   ├─ net-probe.mjs       WHOIS 两跳查询 + DNS NS + TLS 证书握手
   └─ vault.mjs           scrypt + AES-256-GCM 凭据库

src/
├─ components/
│  ├─ app-shell.tsx       三栏骨架、全局快捷键、定时采集
│  ├─ sidebar.tsx         左栏导航 + 主 CTA + 个人菜单（含锁定密钥库）
│  ├─ right-rail.tsx      右栏：全局搜索 / 需要留意 / 快捷终端 / 最近动态
│  ├─ views.tsx           标签栏（滑动下划线）、总览、六个资产列表、首次引导
│  ├─ asset-card.tsx      六种资产卡片（compact / 展开两态共用）
│  ├─ expand-layer.tsx    FLIP 放大详情层
│  ├─ live-shell.tsx      xterm + 真实 PTY
│  ├─ ssh-terminal.tsx    终端窗口外壳 + 浏览器端模拟壳
│  ├─ credential-fields.tsx  SSH 凭据录入与测试
│  ├─ vault-gate.tsx      主密码对话框（唯一输入口）
│  ├─ composer.tsx        新增 / 编辑表单
│  ├─ command-palette.tsx ⌘K 命令面板
│  └─ refresh-button.tsx  整批刷新 / 单条重采
├─ lib/
│  ├─ desktop.ts          window.sinan 的类型定义与取用（浏览器下返回 null）
│  ├─ probes.ts           把探测结果写回资产、并发控制、状态判定
│  ├─ vault-state.ts      密钥库状态与 require() 解锁流程
│  ├─ store.ts            zustand + persist（桌面写文件，网页写 localStorage）
│  ├─ motion.ts           usePresence / useCountUp / FLIP 计算 / 减动效判定
│  ├─ status.ts           状态语义、健康分、异常统计
│  └─ types.ts            资产类型定义
├─ desktop/main.tsx       Electron 渲染进程挂载点
└─ styles.css             设计 token + 组件类 + 动效 keyframes
```

---

## 设计系统

所有 token 定义在 `src/styles.css` 的 `@theme` 里，是 Tailwind v4 的单一来源。JSX 里没有裸十六进制色值，也没有 `p-[16px]` 这类随手值。

**颜色**（中性色 + 三个状态色）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-canvas` | `#f4f5f5` | 页面底色 |
| `--color-card` / `--color-sidebar` | `#ffffff` | 卡片、侧栏 |
| `--color-ink` | `#0f1419` | 正文、主按钮 |
| `--color-muted` / `--color-subtle` | `#536471` / `#8b98a5` | 次级、三级文字 |
| `--color-line` / `--color-line-strong` | `#eff3f4` / `#cfd9de` | 分隔线、输入框描边 |
| `--color-ok` / `--color-warn` / `--color-crit` | `#00ba7c` / `#ffad1f` / `#f4212e` | 正常 / 注意 / 告警 |

**字体**：IBM Plex Sans（正文，中文回落思源黑体 / Noto Sans SC）+ IBM Plex Mono（主机名、IP、终端）。

**动效尺度**：`--dur-fast: 150ms`（悬停、按压）、`--dur-base: 240ms`（弹层）、`--dur-slow: 340ms`（下划线、FLIP），缓动统一 `--ease-out-soft`。

> 一个值得记下的坑：`tailwind-merge` 只认识原生 Tailwind 的类名。自定义颜色 `text-card` 会被它归成**字号**类，于是后面的 `text-body` 把颜色悄悄吃掉——主按钮因此变成黑底黑字。`src/lib/utils.ts` 用 `extendTailwindMerge` 把本项目 token 全部登记了一遍。

---

## 打包分发

```bash
npm run desktop:pack     # 只出目录：release/win-unpacked/
npm run desktop:dist     # 出安装包：Windows NSIS / macOS dmg / Linux AppImage
```

> **打包前请先停掉开发服务器。** Vite 的文件监听会占住项目目录的句柄，electron-builder 重命名 `release/win-unpacked.tmp` 时会拿到 `EPERM`。停掉 dev server 后重跑即可。

图标源文件在 `build/icon.png`（512×512），electron-builder 会自动转成各平台格式。

---

## 技术栈

- **Electron 44** —— 桌面外壳，主进程持有 Node 能力
- **ssh2** —— SSH 连接与 PTY
- **@xterm/xterm** —— 终端渲染
- **React 19** + **TypeScript**（`strict`）
- **Tailwind CSS v4** —— CSS-first token，容器查询
- **zustand**（+ `persist`）—— 状态与持久化
- **recharts** / **cmdk** / **lucide-react** / **sonner**
- **Vite 8** —— 渲染进程构建（桌面与网页两套配置）
- **electron-builder** —— 打包

---

## 已知边界

- **邮箱与 AI 订阅是手工录入**：IMAP 能查容量但查不到「别名/转发」这类配置，各家 AI 厂商的用量 API 也各不相同，暂时不做半吊子实现
- **WHOIS 解析是尽力而为**：各 TLD 的返回格式没有统一标准，常见后缀（.com/.net/.org/.io/.dev/.cn 等）覆盖良好，冷门后缀可能只拿到部分字段
- **主机指标面向 Linux**：采集脚本读 `/proc`，BSD / macOS 主机只能拿到能拿的部分（系统名、uptime 等）
- **没有代码签名**：自己打的包在 Windows 上会被 SmartScreen 提示，属正常现象

---

## 路线图

- [ ] 深色模式（token 已就位，只差一层 `prefers-color-scheme` 覆盖）
- [ ] 托盘常驻 + 到期与离线的系统通知
- [ ] 指标历史留存，画出真实的 CPU / 内存曲线
- [ ] SFTP 文件浏览（`ssh2` 已经带了）
- [ ] 资产之间的关联（域名 → 证书 → 主机）
- [ ] 把「需要留意」导出成 ICS 日历

---

## 许可

MIT
