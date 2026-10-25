# GSAP（本地副本）

- 版本：GSAP 3.15.0，取自官方仓库 `greensock/gsap` 的 `esm/` 目录，文件未改动。
- 包含：`index.js`、`gsap-core.js`、`CSSPlugin.js`、`ScrollTrigger.js`、`Observer.js`。
- 许可：GSAP Standard "no charge" License，见 https://gsap.com/standard-license 。
- 使用入口：`src/motion.js`，页面代码不直接引用本目录。

以本地文件引入是为了不改动 `package.json` 与 `package-lock.json`，现有 `npm ci` 流程保持不变。
以后若改为 npm 依赖（`npm i gsap`），只需把 `src/motion.js` 顶部的两行 import 改为 `from "gsap"` 与 `from "gsap/ScrollTrigger"`，再删除本目录。
