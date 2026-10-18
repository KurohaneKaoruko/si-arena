# SI Arena

项目标识为 `si-arena`，SI 是 **Super Intelligence** 的缩写。npm 组织为 `@si-arena`，统一命令行包为 `@si-arena/cli`。

SI Arena 是一个通过网页参与的 AI 编程竞技游戏平台。玩家在本地使用自己选择的 AI，根据游戏页面提供的统一提示词和 SDK 编写 JavaScript 选手代码，上传后主动发起匹配，通过可视化对战和排位比较策略表现。

项目采用自由竞技模式。平台不集成模型 API，不验证代码由哪个模型生成，也不开展严格的模型能力评测。

## 核心玩法

1. 选择游戏，下载提示词、SDK、游戏包和官方示例 bot。
2. 在本地使用 AI 编写代码，通过本地工具运行、调试和查看回放。
3. 上传该游戏的最新 JS 代码。
4. 主动发起排位，系统选择实力接近的对手；对手可以离线。
5. 观看比赛或回放，查看结果和错误，再修改代码继续竞技。

只有玩家主动发起匹配才会产生新比赛。上传代码、玩家离线或后台定时任务都不会自动开赛。官方 bot 由特殊的官方用户持有，正常参与匹配和排名，使只有一个真实用户时也能立即匹配到对手。

每个游戏的代码、局内得分和排位独立。平台只保留每位玩家在每个游戏的最新代码，不提供历史版本和回滚。

## 首个游戏

首个游戏为 Paper.io 风格的网格圈地对抗：离开领地产生尾迹，安全回到领地完成圈地，切断对手尾迹可以淘汰对手。游戏以 tick 推进，策略代码每 tick 执行一次，所有玩家动作统一结算。

游戏采用 40×30 网格、两人对战，每场最多 600 tick。完整规则见 [圈地游戏设计](docs/designs/paper.md)。

## 技术方向

| 部分         | 选型                                                        |
| ------------ | ----------------------------------------------------------- |
| 仓库与包管理 | pnpm 12 workspace monorepo                                  |
| 网站         | Vue 3、TypeScript、Vite、Vue Router、Tailwind CSS           |
| 业务后端     | Node.js 26、TypeScript、Fastify 5                           |
| 数据库       | PostgreSQL 18、Drizzle ORM、node-postgres                   |
| 玩家代码执行 | quickjs-emscripten 同步发行版、QuickJS-WASM、独立执行子进程 |
| 游戏扩展     | 独立游戏包：规则、SDK、说明、渲染器、官方 bot               |
| 本地调试     | 与服务端共用引擎、游戏包和沙箱的 CLI 与可视化工具           |

回放保存初始世界状态和每 tick 的有效动作意图，通过确定性的规则引擎还原比赛，不依赖玩家代码。本地回放可以包含玩家日志；本地与服务端回放都记录执行错误。

## 仓库开发

要求 Node.js 26 和 pnpm 12；根目录的 packageManager 固定 pnpm 精确版本，由 pnpm 自身的版本管理切换，不依赖 corepack，也不需要 `.nvmrc`。lint 使用 oxlint，格式化使用 oxfmt。

```sh
pnpm install
cp .env.example .env
pnpm dev
```

网页地址为 [http://127.0.0.1:5173](http://127.0.0.1:5173)，API 地址为 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Vite 将 `/api` 与 `/health` 代理到 API。`pnpm dev` 先构建共享包，再并行监视各 workspace 的变化。

API 提供 `/health`、`/api/games` 和 `/api/games/:gameId`。health 仅表示 HTTP 进程存活，不代表数据库或比赛执行服务就绪。worker 入口负责读取配置，不自动创建比赛。

| 命令                                   | 用途                         |
| -------------------------------------- | ---------------------------- |
| `pnpm dev:web`                         | 网页开发服务                 |
| `pnpm dev:server`                      | Fastify 开发服务             |
| `pnpm dev:worker`                      | worker 启动入口              |
| `pnpm build`                           | 按依赖顺序构建全部 workspace |
| `pnpm check`                           | 类型、lint、格式和契约测试   |
| `pnpm test`                            | 资源配置与 API 集成测试      |
| `pnpm arena --help`                    | 仓库内 CLI 帮助              |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle 迁移生成与应用       |

PostgreSQL 的本地启动命令为 `docker compose up -d db`，数据保存在命名 volume；数据库连接使用 .env 中的 DATABASE_URL。游戏目录与规则页不依赖数据库连接。

apps 包含 web、server、worker；packages 包含 protocol、engine、sandbox、player、cli；games/paper 包含圈地的 manifest、SDK、规则与渲染入口。规则与渲染分别导出，服务端加载游戏元数据不会引入 Vue 或 DOM。

## 玩家开发包

统一 CLI 的下载、调试和回放协议见 [本地开发与调试](docs/designs/local-development.md) 与 [分发设计](docs/architecture/distribution-and-development.md)。npm 包统一属于 `@si-arena`，游戏开发包与平台服务通过发行清单保持版本一致。

## 文档导航

- [玩法设计索引](docs/designs/README.md)：产品范围、排位、圈地玩法、本地调试体验。
- [技术架构索引](docs/architecture/README.md)：系统划分、游戏模块、沙箱、tick 与回放、数据与接口、分发。

先阅读 [产品与参与流程](docs/designs/product.md)，再阅读 [系统架构与技术选型](docs/architecture/overview.md)。

## 设计规范

文档定义玩法、接口和实现约束。每个游戏可在 manifest 中覆盖资源限额；平台默认每 tick 20ms CPU、32MiB QuickJS 运行内存、64KiB Memory，圈地继承这些默认值。完整配置与继承规则见 [资源限额](docs/architecture/resource-limits.md)。这些数值是执行契约，验收测试负责检查实现是否满足契约。
