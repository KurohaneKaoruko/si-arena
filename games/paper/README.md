# @si-arena/game-paper

网格圈地游戏包。规则与 SDK 入口不依赖 Vue、数据库或平台账号。

- `src/manifest.ts`：游戏元数据、配置与解析后的默认资源预算。
- `src/sdk/`：玩家观察、状态和动作类型。
- `src/rules/`：规则引擎类型与事件契约。
- `src/renderer/`：浏览器渲染资源，独立 export 入口。
- `bots/`：官方 bot 源码目录。

完整玩法见 [圈地设计](../../docs/designs/paper.md)，接口约束见 [游戏模块](../../docs/architecture/monorepo-and-modules.md)。
