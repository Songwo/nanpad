# AI 服务账号与网页登录授权

## 支持范围

| 服务商 | 登录方式 | 账号信息 | 用量来源 | 限制 |
| --- | --- | --- | --- | --- |
| OpenAI / ChatGPT | 系统浏览器 + PKCE + 本机 1455 回调 | 邮箱、账号、套餐 | `chatgpt.com/backend-api/wham/usage` | Codex 兼容授权；不是 OpenAI API 账单 |
| Anthropic / Claude | 系统浏览器 + PKCE + 粘贴完整 `code#state` | 邮箱、账号 | `api.anthropic.com/api/oauth/usage` | 网页回调展示授权码；额度通常含 5 小时、7 天窗口 |
| xAI / Grok | 系统浏览器 + PKCE + 本机 56121 回调 | OIDC 账号信息 | `cli-chat-proxy.grok.com/v1/billing?format=credits` | 展示服务实际返回的周额度及产品额度 |
| Google / Gemini | 系统浏览器 + PKCE + 动态本机回调 | Google 邮箱、Code Assist 套餐 | `loadCodeAssist`、`retrieveUserQuota` | 需 Code Assist 资格和项目；不是 AI Studio API 总账单 |

四种服务独立保存授权，可以连接多个账号。选择服务商不会把令牌发送到其他模型网关。接口缺失时显示未提供或实际错误，不根据订阅名称编造额度。

## 操作步骤

1. 在设置打开「模型与知识库」，滚动到「AI 服务账号」。
2. 解锁密钥库，选择服务商，点击「网页登录授权」。
3. 在系统浏览器中自行输入账号和密码、完成二次验证并授权。
4. OpenAI、Grok、Gemini 等待回调自动返回；Claude 将网页给出的完整 `code#state` 粘贴回应用，点击完成授权。
5. 看到「账号已连接」后，点击刷新图标查询最新用量。

授权窗口有效期 5 分钟，取消、超时或重复使用的回调不能创建账号。回调校验 state 和路径，使用 PKCE 绑定当前设备的授权请求。端口被占用时显示错误，不接管已有服务。

## 凭据与刷新

Access Token 和 Refresh Token 均存入主密码加密库。普通 IPC 账号结果只包含显示字段，没有原始令牌。锁库后需要重新解锁才能读取或刷新账号。

查询时若 Access Token 即将到期，程序先刷新并保存新的令牌，再查询额度。刷新失败会提示重新登录。刷新不会代表订阅续费，也不会购买额度。

「断开账号」删除本机令牌，不会自动撤销服务商后台授权。完整撤销需要进入对应服务商的账号安全或已授权应用页面。

## 模型问答与订阅账号的区别

本版的问答链路仍使用单独配置的 OpenAI 兼容 API Key。网页登录授权用于查询订阅账号，不自动将这些 Token 作为第三方网关 API Key。ChatGPT、Claude、Grok、Google One 或 Code Assist 的订阅权限不能直接等同于同厂商的开发者 API 余额。

DeepSeek、通义千问、火山方舟等提供 API 地址预设；目前没有在 Nanpad 中实现它们的订阅网页登录授权。Claude 原生 Messages API 不属于当前问答的 Chat Completions 协议，使用兼容网关时填写网关地址。

## Gemini 客户端说明

适配器使用 Gemini CLI 公开分发的桌面 OAuth 客户端参数和 Google 官方登录页，包含随桌面客户端公开分发的 client secret。这不是用户密钥，也不能替代用户同意、PKCE 或授权令牌。Google 可能限制该客户端的范围或账号资格，出现拒绝时不能通过读取浏览器 Cookie 绕过。

## 核对来源与验证边界

协议实现按以下来源核对，没有引入或复制 sub2api 服务端业务代码：

- [sub2api v0.2.1](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.1)
- [OpenAI OAuth 参数](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/pkg/openai/oauth.go)
- [Claude OAuth 参数](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/pkg/oauth/oauth.go)
- [Grok OAuth 参数](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/pkg/xai/oauth.go)
- [Gemini OAuth 参数](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/pkg/geminicli/constants.go)
- [Gemini 官方 Code Assist 实现](https://github.com/google-gemini/gemini-cli/tree/main/packages/core/src/code_assist)
- [Grok OIDC 元信息](https://auth.x.ai/.well-known/openid-configuration)

自动化测试覆盖四种服务的协议、回调、令牌轮换与返回字段；需要用户在真实服务商网页完成登录，才能确认该用户账号的授权资格和实际额度。发布测试不会自动登录私人账号或声称已经验证全部真实服务商账号。
