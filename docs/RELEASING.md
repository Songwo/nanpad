# 发布流程

当前发布目标为 Windows x64 NSIS 安装包。其他平台的打包配置不代表已验证可发布。

## 版本准备

更新 package.json、package-lock.json 与 src/lib/changelog.ts，执行 `node scripts/write-changelog.mjs` 同步 CHANGELOG.md。本版说明保存在 `docs/releases/v0.3.0.md`。README 的安装包名、构建目录及教程应与版本一致；描述实际支持范围，不将本机协议测试写成真实账号登录成功。

## 必须验证

```bash
npm ci
npm run typecheck
npm run lint
npm run i18n:check
npm test
npm run desktop:build
node scripts/agent-integration.mjs
node scripts/ai-subscription-integration.mjs
node scripts/website-account-integration.mjs
npm run build
```

检查桌面首次启动、升级解锁、Markdown 输出、主题化下拉菜单、锁库状态以及未配置网络服务时的错误。AI 订阅需检查快速登录入口、自动及手动回调、重复授权、分类额度，以及刷新失败后仍保留账号和上次结果。本版还需确认等待授权时回调输入直接可见，验证授权与同步额度阶段分别显示，令牌请求的 403 / 429 不被误写成额度查询错误。头像与资产图片需检查上传、更换、移除、保存及重启恢复，并确认超限文件和无效格式被拒绝。

0.3.0 另外检查网站账号类型选择、URL 清理、加密保存失败处理、注册邮箱关联、重载和导出无凭据。邮箱覆盖 TLS 验证、首次基线、UID 重置、未读与新增区分、取消和锁库。Agent 的实时邮箱许可必须在主进程检查，定位凭据只能返回位置。推送覆盖默认关闭、首次不发送、独立游标、渠道验证、失败重试、取消和不含邮件内容的通知正文。真实推送验收由维护者使用自己授权的接收目标操作，不能用自动化向私人或群聊目标发测试消息。

网页开发和生产输出均执行 browser-smoke，查看桌面及移动截图。真实供应商登录由账户持有人在网页完成，不通过自动化读取私人浏览器会话。Release 说明分别记录自动化验证和真实账号验证的范围；额度查询来源不能写成各家网页订阅的全部权益。

## 生成与上传

```bash
npm run desktop:dist -- --win --x64 --publish never
```

打包脚本将主进程及编译后的界面放入系统临时目录中的独立暂存区，使用仓库锁文件版本安装 `ssh2`、`imapflow`、`openai`、`minisearch` 及其运行依赖，再通过 electron-builder 内置的目录遍历器收集依赖，避免将网页构建工具装进桌面包。排除可选原生加速模块，SSH 使用库自带的 JavaScript 实现；无需 Visual Studio 编译环境。复用本机已安装的同版本 Electron，输出到 `release/v版本号/`；构建结束清理暂存区。

安装包生成后检查版本和包内容，运行 `node scripts/release-smoke.mjs release/v0.3.0/win-unpacked/Nanpad.exe` 验证打包程序，计算 SHA256，补齐 Release 说明中的验证记录。该脚本使用独立临时数据目录，不修改日常资料。发布时显式选择源码、文档和必要资源，不提交临时截图、日志、用户数据或运行目录。将发布标签指向已经验证的提交，再上传 `Nanpad-0.3.0-setup.exe` 与 `SHA256SUMS.txt`。

首次公开仓库时检查可达历史、截图和附件，不只扫描当前目录。确认源码许可证及第三方声明，排除用户数据、真实邮箱、Token、回调链接及个人浏览器截图。历史中已存在的信息不能靠删除当前文件解决，历史处理和仓库可见性变化应由维护者明确决定。

当前发行未配置 Authenticode 证书。需要签名发行时，在维护者受保护的构建环境中配置 electron-builder 签名参数；证书与密码不得写入仓库。
