# AI 服务账号与网页登录授权

## 支持范围

| 服务商             | 登录方式                                             | 账号信息                      | 用量来源                                                             | 限制                                                                                                                        |
| ------------------ | ---------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| OpenAI / ChatGPT   | 系统浏览器 + PKCE + 本机 1455 回调                   | 邮箱、当前工作区、套餐        | `chatgpt.com/backend-api/wham/usage`                                 | Codex 主次时间窗口、额外功能窗口、可用 credits；不是 ChatGPT 网页各功能的完整用量或 OpenAI API 账单                         |
| Anthropic / Claude | 系统浏览器 + PKCE + 粘贴完整 `code#state` 或回调链接 | 邮箱、账号                    | `api.anthropic.com/api/oauth/usage`                                  | 额度通常含 5 小时、7 天及模型窗口；部分窗口与网页共享，但不等于网页功能完整明细                                             |
| xAI / Grok         | 系统浏览器 + PKCE + 本机 56121 回调                  | OIDC 账号信息                 | `cli-chat-proxy.grok.com/v1/billing?format=credits` 及 `/v1/billing` | 周额度、产品额度、月度账单、预付余额与按需消费；不是 Grok 网页全部权益                                                      |
| Google / Gemini    | 系统浏览器 + PKCE + 动态本机回调                     | Google 邮箱、Code Assist 套餐 | `loadCodeAssist`、`retrieveUserQuota`                                | 按模型和计量单位显示剩余比例与数量；需 Code Assist 资格和项目，不是 Gemini 网页、Google One 全部权益或 AI Studio API 总账单 |

四种服务独立保存授权，可以连接多个账号。选择服务商不会把令牌发送到其他模型网关。接口缺失时显示未提供或实际错误，不根据订阅名称编造额度。

## 操作步骤

1. 在侧栏选择「AI 订阅」，点击「添加资产」，默认进入「快速登录」。已有订阅可在编辑窗口切换到「快速登录」。
2. 选择 OpenAI、Claude、Grok 或 Gemini，点击「网页登录授权」；密钥库锁定时会先要求解锁。
3. 在系统浏览器中自行输入账号和密码、完成二次验证并授权。
4. 等待授权时，应用直接显示「回调链接或授权码」输入框。OpenAI、Grok、Gemini 等待回调自动返回；Claude 将网页给出的完整 `code#state` 或回调链接粘贴到输入框，点击「完成授权」。任何服务自动回调没有完成时，都可以提交浏览器当前完整回调链接。界面显示正在验证授权时不要重复提交，显示正在同步额度时无需再填写回调。
5. 授权成功后自动添加或更新订阅，并查询一次额度。同一账号重复登录不会重复创建记录；没有返回的月费、用量和到期日显示未提供。
6. 点击订阅卡片，在详情中的「AI 服务账号」刷新用量、查看账号与套餐，或断开授权。已在模型设置中连接的账号可点击「添加到订阅」关联。

「手动填写」仍可记录暂不支持网页登录的服务。授权订阅中的名称、标签、说明及月费可手动编辑；账号套餐和用量由服务商响应更新。模型设置中的账号入口仍然可用，两处共享同一份加密授权。

授权窗口有效期 5 分钟，取消、超时或重复使用的回调不能创建账号。回调校验完整 origin、路径和唯一 state/code 参数，使用 PKCE 绑定本次授权请求。关闭授权界面会取消未完成的会话；重新发起登录会建立新的会话。不能使用上次登录的回调链接，也不能只粘贴缺少 state 的授权码。完整链接包含一次性授权信息，请勿发布到 Issue 或日志中。

固定回调端口被其他应用占用时，程序保留供应商登记的回调地址，切换到手动完成；不会关闭其他应用。浏览器可能显示本机页面无法处理此次回调，此时复制地址栏中的完整链接即可。只接受本次登录发出的回调地址，不接受任意网站地址。

## 授权完成后仍无法读取额度

界面中的「本机已保存授权」表示本机已有该账号的授权记录，不代表最新额度查询成功，也不能单凭它确认浏览器中某一条旧回调链接已经处理。如果仍在等待本次授权，可以提交对应的回调链接；已经开始同步额度时，不需要重复填写。

额度查询返回 HTTP 403 表示请求被服务商拒绝，仅凭这个状态码无法确定具体原因。应用会保留已保存的授权，并单独显示额度同步失败；重新粘贴已完成或旧会话的回调不能解决额度接口拒绝。可通过「查看官网权益」核对账号与产品范围，稍后重试刷新；需要切换账号时再发起「重新授权」。本版未确认真实账号 HTTP 403 的上游原因，也不声称已修复该拒绝。

## 套餐和用量为何可能不同

网页登录允许读取的范围由服务商发放的 OAuth 权限决定。ChatGPT 登录使用 Codex 客户端授权，Google 登录使用 Gemini CLI / Code Assist 授权；登录成功不代表得到了所有网页功能的用量权限。不同工作区、账号、产品或计量周期必须分别理解。

- OpenAI 优先采用最近一次额度响应中的套餐；额度尚未查到时，显示登录令牌中的套餐元信息。网页切换到其他工作区时，它可能与本机选择的账号不同，重新授权后可确认当前工作区。
- Gemini 采用 `paidTier` 或 `currentTier` 的 Code Assist 套餐名称。单独提供的 `remainingAmount` 仍会显示实际剩余数量；没有百分比时不显示虚构的百分比，也不反推总额度。
- Grok 月度 `monthlyLimit` / `used` 为美分，界面以美元展示；预付余额、按需限额与消费按接口提供的美元处理。月度账单限额不是订阅月费，不能由限额推断 SuperGrok 或 Heavy 套餐名称。
- 服务商未返回的月费、订阅到期日及网页分类额度显示未提供。令牌有效期、额度重置时间与账单周期结束均不会当作订阅到期日。

每个账号的用量详情注明数据来源、覆盖范围、查询时间及分类窗口。刷新失败会保留此前成功取得的数据并标记过期，不把历史快照当作实时值。Grok 某个账单接口失败时，另一个接口已读到的数据仍会保留，旧分类会标为过期。

## 凭据与刷新

Access Token 和 Refresh Token 均存入主密码加密库。普通 IPC 账号结果只包含显示字段，没有原始令牌。锁库后需要重新解锁才能读取或刷新账号。

查询时若 Access Token 即将到期，程序先刷新并保存新的令牌，再查询额度。接口返回 401 时最多自动刷新一次后重试；403 显示本次请求被拒绝，429 显示请求过于频繁。这些通用状态也可能来自令牌请求，不能全部解释为额度查询失败，更不能由 403 推断具体拒绝原因。额度刷新失败的类型、尝试时间与脱敏原因会保存在加密库中，重启后仍可查看；原始响应、令牌不会放入错误消息或资产记录。

刷新不会代表订阅续费，也不会购买额度。程序只调用查询接口，不为了取得 Grok 限流响应头偷偷发起一次模型推理。

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
- [OpenAI 官方额度响应类型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs)
- [OpenAI 额度查询实现](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/service/openai_quota_service.go)
- [Grok 周/月账单结构](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/pkg/xai/billing.go)
- [Grok OIDC 元信息](https://auth.x.ai/.well-known/openid-configuration)

自动化测试覆盖四种服务的协议、完整链接和授权码回调、端口冲突、取消和重放、令牌轮换、401 重试、403 错误持久化、跨账号拒绝及分类额度映射。上游网络响应使用协议 fixture，不能替代用户真实账号的权限验证；需要用户在真实服务商网页完成登录，才能确认该账号的资格和实际额度。服务商若要求额外访问校验或拒绝当前客户端，应用会显示具体状态，不能承诺通过此 OAuth 获取所有网页套餐权益。
