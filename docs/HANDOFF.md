# 私有源码交接说明

更新：2026-10-22。该项目通过**私有 GitHub 仓库**交接，仅向项目持有人指定的协作者开放，不公开发布。私有仓库与源码 ZIP 均不分发生产账号、密码、令牌或合作留言。

项目是卫星互联网研究中心的 React 网站与 Node 内容后台，包含六个公开栏目、文章详情、管理员发布、文件上传、合作留言和 FlowUs 单向内容同步。本文记录本次交接的运行方式与设计约束，快速开始见仓库根目录 README。

## 本地运行

使用 **Node.js 22.12 或更高版本**，建议使用 Node 22 LTS 的最新补丁版本。最低版本依据当前锁文件中的 `file-type` 和 `@vitejs/plugin-react` 要求。保留 `package-lock.json`，首次安装优先使用锁定依赖：

```sh
npm ci
npm run dev
```

也可用 `npm install` 安装依赖，但可能更新锁文件；仅在有意调整依赖时使用。Windows PowerShell 如受脚本执行策略影响，将命令改为 `npm.cmd`。

开发服务默认监听回环地址并自动选择可用端口。以终端实际输出或本机 `.runtime/connection.json` 为准，不预设端口。后台路径为实际网站地址下的 `/admin`。

生产构建和运行：

```sh
npm run build
npm start
```

`npm run preview` 只预览前端构建，不能替代完整 Node 服务。构建脚本还会准备 Sites 兼容文件，因此必须保留 `scripts/prepare-sites-build.mjs`、`worker/index.js` 与主项目的通用 `.openai/hosting.json` 模板。

## 初始内容与管理员

空数据目录启动时，`server/storage.mjs` 从 `server/seed.mjs` 创建初始内容，并创建空留言库。这个基础种子保留早期公开材料，也是部分自动测试使用的稳定样例；它不等同于现有公开站的完整内容快照。

首次启动会创建独立的 `admin` 管理员。可以在首次启动前通过服务端环境变量 `ADMIN_PASSWORD` 设置密码；未设置时，服务生成随机密码并写入本机 `.runtime/admin-credentials.txt`。在本机直接读取后登录，进入“账号安全”修改密码。已有账号不会因重启或更换环境变量而自动重置。私有交接仓库也不携带任何现有账号、密码摘要、初始凭据或登录会话。

若发布包附带 `seed/public-content.json`、`seed/media/` 及 `scripts/init-public-demo.mjs`，可在**首次启动前**运行：

```sh
node --env-file-if-exists=.env scripts/init-public-demo.mjs
npm run dev
```

这一可选步骤用于复现交接时的公开内容。初始化脚本将公开快照写入新数据目录，将引用媒体复制到 `DATA_DIR/uploads`；目标必须不存在或为空，已有 `content.json` 或其他文件时拒绝覆盖。脚本校验路径、拒绝符号链接和非公开条目，并使用排他创建。请先停止服务，再从项目根目录运行；若初始化中断，保留现场并改用新的空 `DATA_DIR` 重试。日常内容维护在后台进行，不能重复运行初始化来覆盖已使用的站点。快照是交接时的公开版本；后续更新需另行配置 FlowUs 或使用后台发布。

发布维护者准备公开快照时，应读取公开 `/api/content`，保留已发布条目及公开站点设置，并只收集这些条目实际引用的 `/media/` 文件。不得复制整个本机 `data/`。快照不得包含草稿、FlowUs 私有配置或候选记录、账号、留言及备份；应保留文章 ID、公开来源、正文与附件信息，检查引用文件是否齐全。基础 `server/seed.mjs` 可继续作为稳定测试样例，无须为了快照改动测试预期。

## 维护入口

| 需求 | 主要位置 |
| --- | --- |
| 页面、栏目和首页卡片 | `src/App.jsx` |
| 静态卫星首屏 | `src/SatelliteHero.jsx`、`public/assets/satellite-hero-v1.webp` |
| 本轮首页宽度、卡片层级 | `src/home-satellite.css` |
| 基础排版及响应式 | `src/apple.css` |
| 关于中心 | `src/about.css` |
| 内容展示与阅读目标规则 | `src/ArticleBody.jsx`、`src/content-navigation.js` |
| 管理后台 | `src/Admin.jsx`、`src/FlowusAdmin.jsx` |
| HTTP、登录、上传、留言与静态服务 | `server/index.mjs` |
| 内容存储与初始数据 | `server/storage.mjs`、`server/seed.mjs` |
| FlowUs 读取、转换及发布 | `server/flowus-*.mjs` |
| Node 到 Sites 的同步 | `server/sites-mirror.mjs` |
| 云端内容、媒体与留言接口 | `hosting/worker.mjs` |

后台“内容库”管理研究、观点和动态，“站点信息”维护介绍和公开联系字段，“合作意向”查看私有留言。操作和备份步骤见 [内容维护指南](CONTENT-GUIDE.md)。该旧指南的正文格式章节早于现有 Markdown 渲染升级：目前正文支持表格、行内图片等格式，具体以 `src/ArticleBody.jsx` 和 FlowUs 接入指南为准；任意 HTML 仍不应作为正文能力依赖。

## 当前视觉约束

- 保持明亮白底、居中超大中文黑体标题、蓝色胶囊按钮、大片留白和宽松的介绍双栏。继续使用现有中文无衬线字体系统。
- 首页使用静态通信卫星概念图。用户已明确取消鼠标视差、三维倾斜等新增动效，不应重新加入替代动效。
- 首页及其页头、页脚内容宽度上限为 1460px；平板与手机保留响应式边距。正文仍保持可读行宽。
- 首页观点卡片采用用户确认的层级：元信息轻细，标题约 600 字重，摘要贴近标题且较轻，阅读入口与内容组相隔约 36–38px。保留疏朗的卡片外间距。
- 标题通过中文标点优先进行语义换行，短语“卫星互联网”保持完整；不能把整个标题设为不换行，320px 手机宽度仍须正常显示。
- 首屏卫星及相关空间视觉是生成的概念图，不应标注为某颗真实卫星的实拍或机构成果照片。真实文章中的图片与这些设计资产分开维护。

设计优化应从当前公开版本和明确反馈出发，避免重新改成宋体编辑风格或压缩布局。交付前检查实际桌面、平板和手机截图，并验证阅读链接、后台和表单流程。

## FlowUs 配置

新接手者需要为自己的运行环境单独授权；本机已完成的授权不会随源码转移。支持两种服务端模式：

1. 官方 CLI：配置 `FLOWUS_AUTH_MODE=cli`、`FLOWUS_CLI_PATH`、`FLOWUS_CONFIG_DIR`、`FLOWUS_WORKSPACE_ID`，在运行 Node 的服务账号下完成授权。路径使用目标操作系统中的绝对路径，授权目录保持私有。
2. V2 令牌：使用服务端 `FLOWUS_TOKEN`，或在管理员后台配置有效访问令牌。不要把令牌放入前端、仓库或公开快照。

在 `/admin` 的“FlowUs 同步”中测试连接、添加来源并明确筛选范围。现有站点已确认的范围是：观点库“状态”精确等于“研究中心”；动态库多选“类型”包含完整标签“中心动态”。不能用某个画廊视图的显示结果替代服务端发布筛选。中心介绍目前由站点设置维护，行业政策与行业资讯不应被默认扩为已接入范围。

同步方向为 FlowUs → 网站，不回写 FlowUs。成功同步可以自动发布；失败保留最后成功内容。具体支持格式、限制与操作见 [FlowUs 接入指南](FLOWUS-SETUP.md)，其中历史数量及本机授权描述只代表当时安装。

## Sites 与阿里云部署关系

现有公开 Sites 镜像由独立部署工作目录发布。完整 Node 服务负责 FlowUs 同步与后台；`hosting/worker.mjs` 是云端镜像接口，承载公开快照、媒体和云端合作留言。主项目 `worker/index.js` 只是兼容的静态路由模板，两者不可混用。

当前内容链路是 **FlowUs → 本机 Node 服务 → Sites 镜像**。本机服务每轮读取公开范围，再将已发布快照和所需媒体同步到云端；网页也会定期重新读取内容。电脑关机或本机 Node 停止时，Sites 展示最后成功快照，云端仍可保存新增留言，但新的 FlowUs 变更和留言回传要等 Node 服务恢复。现状不能表述为已经实现全天无人值守的云端同步。

交接源码不携带现有 Sites 项目身份或任何同步凭据。维护现有部署需由项目持有人另外提供访问权限和密钥；独立部署则使用自己的资源。前端镜像构建需要 `VITE_SITES_MIRROR=true`；页面代码变化需重新构建部署，文章内容变化走内容同步。

阿里云完整生产部署仍需单独实施和验收：使用单个常驻 Node 进程、独立持久数据目录、进程守护及 HTTPS 反向代理。部署环境显式配置 `HOST`、`PORT`、`DATA_DIR`、`RUNTIME_DIR`，HTTPS 下配置 `COOKIE_SECURE=true`。仅在可信的同机回环反代场景启用 `TRUST_LOOPBACK_PROXY=true`。FlowUs 授权和 Sites 同步配置也必须在服务器环境单独建立。

当前 JSON 存储只支持一个进程写同一个数据目录，登录会话在内存中，重启后需要重新登录。更新代码不得覆盖数据目录；备份内容与媒体时保持同一版本。需要多实例或更复杂权限时，再迁移数据库、对象存储及任务锁。

## 私有交接包白名单与排除项

最小可运行源码白名单：

- `package.json`、`package-lock.json`、`index.html`、`vite.config.mjs`。
- `src/`、`server/`、`tests/` 中的源码文件。
- `public/assets/` 中实际设计资产及字体、图标许可文件。
- `scripts/prepare-sites-build.mjs`、`worker/index.js`、`hosting/worker.mjs`。
- 主项目通用 `.openai/hosting.json`，当前内容仅为 `d1`、`r2` 的空配置；不包含相邻 Sites 工作目录的项目配置。
- `.gitignore`、面向接手者更新的 `README.md`、本说明及已审查的内容维护/FlowUs 文档。
- 可选的已审查 `seed/public-content.json`、`seed/media/` 和安全的首次初始化脚本；可选的已批准视觉参考图。

排除整个本机 `data/`、`.runtime/`、`.env` 及其他真实环境配置、凭据文件、FlowUs CLI 授权目录、历史备份、`node_modules/`、`dist/`、日志、压缩归档，以及未经审查的 QA、设计草稿和本机工具配置。`.env.example` 应重新制作只含空值或明确占位符的模板；不要因为文件名是 example 就默认其中没有真实配置。`.npmrc` 也应排除，除非逐项确认是可公开且确有必要的通用设置。

仓库保持私有，协作者按约定范围使用和优化源码，不因可访问仓库而获得公开再发布授权。若以后决定开源，应再明确源码许可证及内容权利；第三方字体、图标、公开文章与图片的权利说明不应被一个源码许可证自动覆盖。

## 验证

```sh
npm run build
npm test
npm run test:sites
```

自动测试主要使用隔离临时数据和模拟 FlowUs/Sites 服务。发布维护者还应从干净副本完成一次安装、首次初始化与生产启动，核对公开内容 API、图片/附件、文章路由和管理员首次登录流程。真实 FlowUs 授权、现有 Sites 权限与阿里云持续运行必须分别验收，不能由单元测试通过代替。
