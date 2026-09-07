# 发布流程

当前发布目标为 Windows x64 NSIS 安装包。其他平台的打包配置不代表已验证可发布。

## 版本准备

更新 package.json、package-lock.json 与 src/lib/changelog.ts，执行 `node scripts/write-changelog.mjs` 同步 CHANGELOG.md。README、教程与 Release 说明应描述实际支持范围，不将本机协议测试写成真实账号登录成功。

## 必须验证

```bash
npm ci
npm run typecheck
npm run lint
npm run i18n:check
npm test
npm run desktop:build
node scripts/agent-integration.mjs
npm run build
```

检查桌面首次启动、升级解锁、Markdown 输出、服务商选择、锁库状态以及未配置网络服务时的错误。网页开发和生产输出均执行 browser-smoke，查看桌面及移动截图。真实供应商登录由账户持有人在网页完成，不通过自动化读取私人浏览器会话。

## 生成与上传

```bash
npm run desktop:dist -- --win --x64 --publish never
```

打包脚本将主进程及编译后的界面放入系统临时目录中的独立暂存区，使用仓库锁文件版本安装 `ssh2`、`imapflow`、`openai`、`minisearch` 及其运行依赖，再通过 electron-builder 内置的目录遍历器收集依赖，避免将网页构建工具装进桌面包。排除可选原生加速模块，SSH 使用库自带的 JavaScript 实现；无需 Visual Studio 编译环境。复用本机已安装的同版本 Electron，输出到 `release/v版本号/`；构建结束清理暂存区。

安装包生成后检查版本和包内容，运行 `node scripts/release-smoke.mjs release/v0.2.0/win-unpacked/Nanpad.exe` 验证打包程序，计算 SHA256，准备 Release 说明。发布时显式选择源码、文档和必要资源，不提交临时截图、日志、用户数据或运行目录。将发布标签指向已经验证的提交，再上传安装包与 SHA256SUMS.txt。

当前发行未配置 Authenticode 证书。需要签名发行时，在维护者受保护的构建环境中配置 electron-builder 签名参数；证书与密码不得写入仓库。
