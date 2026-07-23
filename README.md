<p align="center">
  <img src="web/public/logo.svg" width="96" alt="Visionary Infinite Canvas logo">
</p>

<h1 align="center">Visionary Infinite Canvas</h1>

<p align="center">
  <a href="https://render.com/deploy?repo=https://github.com/ursuchcute/visionary-infinite-canvas"><img src="https://img.shields.io/badge/Render-Deploy-46e3b7?style=flat-square&logo=render&logoColor=111111" alt="Deploy to Render"></a>
  <a href="https://github.com/ursuchcute/visionary-infinite-canvas"><img src="https://img.shields.io/github/stars/ursuchcute/visionary-infinite-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/ursuchcute/visionary-infinite-canvas/tags"><img src="https://img.shields.io/github/v/tag/ursuchcute/visionary-infinite-canvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://reactrouter.com/"><img src="https://img.shields.io/badge/React_Router-7-ca4245?style=flat-square&logo=reactrouter&logoColor=white" alt="React Router"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> · <a href="docs/content/docs/overview/features.mdx">功能介绍</a> · <a href="docs/content/docs/canvas/canvas-node-manual.mdx">节点手册</a> · <a href="docs/content/docs/canvas/canvas-shortcuts.mdx">快捷键</a> · <a href="SECURITY.md">安全策略</a> · <a href="NOTICE.md">开源归属</a>
</p>

Visionary Infinite Canvas 是面向 AI 图片创作的开源画布工作台，支持画布编排、图片生成与编辑、视频和音频生成、提示词库、素材管理、插件节点以及本地 Canvas Agent。

> [!IMPORTANT]
> 本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 修改开发，继续按照 GNU AGPL v3.0 发布。原项目归属、修改说明和源码义务见 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。

> [!CAUTION]
> 项目仍在持续开发，当前更适合个人、本地或经过安全评估的自托管部署。AI API Key、画布、素材和生成记录默认保存在浏览器本地。

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做和导入导出。
- AI 创作：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑、文本、音频和视频生成。
- 模型渠道：配置自己的 Base URL、API Key 与模型，并支持自定义生图和视频请求脚本。
- 画布助手：通过本地 Canvas Agent 连接 Codex / Claude Code，以 MCP 工具读取和操作画布。
- 插件系统：通过 URL 安装画布节点插件，并提供 TypeScript 插件 SDK。
- 本地数据：画布、素材、提示词与生成记录默认保存在 IndexedDB，可选 WebDAV 同步。

完整说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

## 快速开始

### 本地开发

```bash
git clone https://github.com/ursuchcute/visionary-infinite-canvas.git
cd visionary-infinite-canvas/web
bun install
bun run dev
```

启动后访问 `http://localhost:3000`，在右上角配置自己的 OpenAI 兼容 `Base URL`、`API Key` 和模型。

### Docker

```bash
git clone https://github.com/ursuchcute/visionary-infinite-canvas.git
cd visionary-infinite-canvas
docker compose up -d
```

默认访问地址为 `http://localhost:3000`。更多方式见 [Docker 部署](docs/content/docs/overview/docker.mdx) 和 [Render 部署](docs/content/docs/overview/render.mdx)。

## 开源与贡献

- 当前源码仓库：[ursuchcute/visionary-infinite-canvas](https://github.com/ursuchcute/visionary-infinite-canvas)
- 上游项目：[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)
- 开源协议：[GNU Affero General Public License v3.0](LICENSE)
- 问题与建议：[GitHub Issues](https://github.com/ursuchcute/visionary-infinite-canvas/issues)

在线提供修改版本时，请向网络用户显著提供与实际运行版本对应的完整源码。提交贡献前请阅读 [CLA.md](CLA.md)。
