# macOS 本机构建

知屿使用 Electron，可在 macOS 本机开发和打包。项目持续集成使用 Node.js 22；建议先使用相同版本与随附 npm，避免把 Node.js 26 / npm 12 的安装策略差异误判成代码错误。

```sh
npm ci
node node_modules/electron/install.js
npm run typecheck
node --test scripts/package-stage.test.mjs
npm run desktop:pack -- --mac --arm64
```

Intel Mac 将最后一条的 `--arm64` 换成 `--x64`，并在对应架构的机器和 Node.js 环境运行。产物在 `release/v<版本>/mac-arm64/Zhiyu.app` 或 `release/v<版本>/mac/Zhiyu.app`。需要 DMG 时使用 `npm run desktop:dist -- --mac --arm64`（Intel 使用 `--x64`）。

Electron 下载受网络影响时，可只为此次安装设置可信镜像，例如：

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

这仅调整 Electron 运行时下载地址。不要使用全局 `allow-remote=all` 绕过 npm 的远程依赖保护，也不要删除锁文件或用 `--force` 掩盖依赖不一致。

打包器现在先解析暂存目录的真实路径，并只用该目录作为 npm 子进程的 `cwd`，不再额外传入 `--prefix`。这解决了 macOS 的 `/var` → `/private/var` 路径别名导致刚生成的锁文件被 `npm ci` 判断为不同步的问题；打包前还会检查主进程依赖的版本与仓库锁定版本一致。

GitHub Actions 的「macOS 打包检查」分别在 Apple Silicon 和 Intel runner 上生成 `.app` 并校验二进制架构，上传的 ZIP 是未签名测试产物。该工作流不创建正式 Release，也未执行 Apple Developer ID 签名与公证；不能把 CI 测试 ZIP 描述为已签名正式安装包。
