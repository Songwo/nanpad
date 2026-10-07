# 知屿 Zhiyu

自 1.2.0 起，「司南 Nanpad」更名为「知屿 Zhiyu」。知屿是连接文档、账号与数字资产的个人工作空间。

标记使用两片相连的岛形纸页。应用内为继承主题颜色的单色版本；桌面图标以深青色为底，使用米白和浅玉色，保留小尺寸的识别度。源码中的同一几何生成各平台尺寸，避免侧栏、任务栏和安装图标各自漂移。

- 矢量源：`src/lib/brand-mark.mjs`
- 界面标记：`src/components/logo.tsx`
- 图标生成：`node scripts/make-icon.mjs`
- 可复用文件：`public/brand/zhiyu.svg`、`public/brand/zhiyu.png`
- 视觉说明：`public/brand/zhiyu-preview.png`
- Windows：`build/icon.ico`，包含 16/24/32/48/64/128/256px PNG 图层
- 分享卡：`public/og.jpg`

本版为直接绘制的原创矢量设计，没有使用或声称使用 image2.5 生图。设计说明为：两片相连的岛形纸页，深青色底，米白与浅玉色主体，简洁几何，小尺寸清晰，无锁头、罗盘或拟物描边。

为保持升级兼容，内部应用 ID、`Nanpad` 数据目录、仓库路径、安装程序文件名及 `nanpad://` 协议保留原标识。历史更新日志中的旧品牌称呼保留原状。
