# 卫星互联网研究中心网站

私有源码交接包，供指定协作者继续优化。包含六个公开栏目、React 前端、Node 内容后台、FlowUs 单向同步及 Sites 镜像实现；不包含生产账号、令牌或合作留言。

## 快速开始

安装 **Node.js 22.12 或更高版本**，建议 Node 22 LTS 最新补丁。在项目根目录执行：

```sh
npm ci
node --env-file-if-exists=.env scripts/init-public-demo.mjs
npm run dev
```

第二步将交接时的公开内容与媒体初始化到新数据目录，已有内容会拒绝覆盖。若只需基础示例，可跳过这一步。Windows PowerShell 如遇执行策略提示，使用 `npm.cmd`。

地址以启动日志或本机 `.runtime/connection.json` 为准，端口自动选择。后台为该地址下的 `/admin`。首次启动生成独立 `admin` 账号；未预设 `ADMIN_PASSWORD` 时，初始密码位于本机 `.runtime/admin-credentials.txt`，登录后在“账号安全”修改。

## 生产运行与检查

```sh
npm run build
npm start
```

```sh
npm test
npm run test:sites
```

`npm run preview` 只预览前端，不提供完整后台。服务数据默认写入 `data/`，请保持单个 Node 进程写同一目录；更新源码不能覆盖持久数据。

## 配置与维护

默认不需要 `.env`。需要自定义时，复制 `.env.example` 为 `.env` 并在本机填写；初始化与启动须使用相同的 `DATA_DIR`。FlowUs 和 Sites 授权均需在新环境单独配置，不随仓库传递。

当前设计保留白底、大中文黑体标题、蓝色胶囊按钮及静态卫星概念图。用户已取消视差；观点卡片采用已确认的轻元信息、重点标题、紧邻摘要和独立阅读入口。

详见 [交接说明](docs/HANDOFF.md)、[内容维护指南](docs/CONTENT-GUIDE.md)及 [FlowUs 接入指南](docs/FLOWUS-SETUP.md)。页面入口在 `src/App.jsx`，本轮首页样式在 `src/home-satellite.css`，静态卫星在 `src/SatelliteHero.jsx`，服务入口在 `server/index.mjs`。

现有 Sites 的内容更新仍依赖本机 Node 服务；电脑离线时展示最后成功快照。全天自动同步需要另行部署常驻 Node 服务。仓库保持私有，第三方文章、字体、图标和图片的权利不因源码交接而改变。
