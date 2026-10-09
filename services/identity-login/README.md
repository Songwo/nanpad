# 知屿主身份登录服务

这个独立服务用于知屿的首次登录和个人资料绑定。普通用户使用各自的 Linux.do 账号授权，无需申请 Connect 应用。应用开发者的 Client Secret 只配置在服务器，不进入桌面安装包。

运行环境为 Node.js 20 或更高版本，仅使用内置模块，无需安装 npm 依赖。入口为 `main.mjs`，固定监听 `127.0.0.1`，默认端口 `49284`，通过现有 Cloudflare Tunnel 对外提供 HTTPS。

## 应用申请与配置

Linux.do Connect 中登记的回调地址：

```text
https://auth.allinsong.top/oauth/linuxdo/callback
```

配置从 `ZHIYU_IDENTITY_CONFIG` 指定的 JSON 文件读取，也支持同名环境变量覆盖。生产配置建议放在 `/etc/zhiyu-identity/config.json`，归属 `root:zhiyu-identity`，权限 `0640`。不在代码目录、Git、命令历史或聊天中存放实际密钥。

| 配置键                   | 含义                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`          | 固定 HTTPS 源，默认 `https://auth.allinsong.top`                                                   |
| `LINUXDO_CLIENT_ID`      | 开发者申请的 Connect 应用 Client ID                                                                |
| `LINUXDO_CLIENT_SECRET`  | Connect 应用 Client Secret，仅服务端使用                                                           |
| `SESSION_ENCRYPTION_KEY` | 32 字节密码学随机数据的标准 Base64 编码                                                            |
| `PORT`                   | 本机监听端口，默认 `49284`                                                                         |
| `TRUST_CLOUDFLARE_PROXY` | 已确认只通过本机 Cloudflare Tunnel 接入时设为 `true`，使用 Cloudflare 提供的客户端 IP 分配限流额度 |

缺少应用凭据或会话密钥时，健康检查仍响应 `{"ok":true,"configured":false}`，登录请求返回 `503` 和明确的未配置提示。无效密钥会阻止启动，不会生成临时密钥掩盖配置问题。

目录布局采用 `/opt/zhiyu-identity/releases/<版本>/` 存放 `main.mjs`、`server.mjs`，`/opt/zhiyu-identity/current` 指向当前版本。仓库中的 systemd 示例与这个布局一致。切换版本后重启服务；处理中授权会失效，用户可重新发起。服务只处理登录身份，不访问知屿的文档、资产或密钥库。

Cloudflare Tunnel 的域名路由指向 `http://127.0.0.1:49284`，保留公网 Host `auth.allinsong.top`。业务接口只接受这个 Host。本机 `127.0.0.1:<端口>` Host 仅允许 `/healthz` 健康检查；不需要开放服务器防火墙入站端口。

## 协议与数据处理

1. 桌面主进程监听随机端口，并生成自己的 `state` 与 S256 PKCE，调用 `POST /v1/login/start`。
2. 服务端另行生成官方授权用的 `state` 与 PKCE，返回官方授权 URL。
3. 浏览器在 Linux.do 登录，回调服务校验一次性 state，通过固定官方接口换取令牌和用户资料。
4. 回调只将一分钟有效、绑定桌面 PKCE 的一次性交接码发给原始本机地址，URL 中没有提供方 token。
5. 桌面以 verifier 调用 `POST /v1/login/exchange`，获取用户资料和 AES-256-GCM 加密凭据。
6. `POST /v1/session/profile` 使用 Bearer 加密凭据获取更新的资料；必要时更新提供方 token，并验证稳定 subject 一致。

返回的加密凭据本身是访问凭证，桌面端应使用系统保护存储保存，不写入普通个人资料或日志。会话最长 30 天，资料刷新不会无限延长有效期。服务无账号数据库，重启保留会话密钥即可继续使用已有凭据；替换会话密钥会让所有已有凭据失效。退出登录删除本机凭据，不代表撤销 Linux.do 端授权。需要远端撤销时，应在 Linux.do 的授权管理操作。

待授权状态最多 1024 项、有效五分钟；交接码最多 1024 项、有效一分钟；每个来源每分钟最多 120 次业务请求，最多 64 个同时处理的请求。超过容量会明确拒绝，不静默替换其他用户的有效状态。

服务不记录 URL 参数、请求头、令牌、密钥或用户资料；不跟随官方请求重定向，不使用 Cookie；上游响应最多 1 MiB，单次请求最多 15 秒。API 禁用缓存，拒绝跨站 Origin，头像仅保留 Linux.do 的可信 HTTPS 地址。邮箱和等级缺失时返回 `null`。

## 验证

项目根目录运行：

```text
node --test scripts/identity-login.test.mjs
node --check services/identity-login/server.mjs
node --check services/identity-login/main.mjs
```

测试通过真实本机 HTTP 请求和合成 OAuth 提供方验证登录、PKCE、取消、过期、重放、身份一致性、上游大小限制、请求校验及限流。测试不访问真实 Linux.do 账号，也不使用生产 Client Secret。
