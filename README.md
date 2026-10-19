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

源码的相对 TypeScript 导入省略扩展名，例如 `import { buildApp } from "./app"`。TypeScript 使用 Bundler 模块解析并负责类型检查；Node 应用和共享包通过根 `tsdown.config.ts` 构建 ESM 与类型声明，保持各包既有 dist 路径，输出中的导入由构建器处理为 Node 可直接加载的形式。前端继续使用 Vite；Vue、CSS 等资源引用保留扩展名。

API 提供 `/health`、`/api/games`、`/api/games/:gameId`，`/api/auth` 下的注册、登录、当前会话、登出与密码修改接口，以及按游戏的参赛信息（`/me`）、代码上传（`PUT /me/code`，text/plain）、主动匹配（`POST /matches`，幂等键请求头）、排行榜与比赛详情查询。上传走沙箱静态校验（受限 AST + 同版 QuickJS compileOnly）。health 仅表示 HTTP 进程存活，不代表数据库或比赛执行服务就绪。worker 独立进程直连数据库领取已有比赛，按冻结发行执行整场、把回放写入 `REPLAYS_DIR`（终稿 `<matchId>.json.gz`，候选在 `candidates/` 下），并在单事务中完成 Elo 结算；worker 不创建比赛。

| 命令                                   | 用途                         |
| -------------------------------------- | ---------------------------- |
| `pnpm dev:web`                         | 网页开发服务                 |
| `pnpm dev:server`                      | Fastify 开发服务             |
| `pnpm dev:worker`                      | worker 启动入口              |
| `pnpm build`                           | 按依赖顺序构建全部 workspace |
| `pnpm check`                           | 类型、lint、格式和契约测试   |
| `pnpm test`                            | Vitest 全仓源码测试          |
| `pnpm arena --help`                    | 仓库内 CLI 帮助              |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle 迁移生成与应用       |

提交时 git hooks 自动运行：pre-commit 用 lint-staged 对暂存文件执行 `oxlint --fix` 与 `oxfmt`，commit-msg 用 commitlint 校验 Conventional Commits 格式（如 `feat: ...`、`chore: ...`）。hooks 在 `pnpm install` 时由根 `prepare` 脚本安装。

PostgreSQL 的本地启动命令为 `docker compose up -d db`，数据保存在命名 volume；数据库连接使用 .env 中的 DATABASE_URL。首次使用先运行 `pnpm db:migrate` 创建表结构；server 启动时会幂等初始化 `official` 官方账号，并为每个已注册游戏安装官方 bot 源码（排位分与统计保持不变）。游戏目录与规则页不依赖数据库连接，认证接口需要数据库。数据库集成测试需要 `ARENA_TEST_DATABASE_URL` 指向可创建临时库的连接，例如 `ARENA_TEST_DATABASE_URL=postgresql://si_arena:si_arena@127.0.0.1:5433/si_arena pnpm test --project server`；测试自建并清理独立数据库，未设置该变量时自动跳过。

apps 包含 web、server、worker；packages 包含 protocol、engine、sandbox、player、cli 与 db（server 与 worker 共享的 Drizzle 表结构、连接和迁移）；games/paper 包含圈地的 manifest、SDK、规则与渲染入口。规则与渲染分别导出，服务端加载游戏元数据不会引入 Vue 或 DOM。

`packages/sandbox` 提供可调用的独立进程执行器：QuickJS 每 tick 重建、线程 CPU/堆/栈限制、Memory 提交与失败回滚、本地日志，以及受限源码校验。使用方法、Linux 进程内存隔离和性能命令见 [沙箱包说明](packages/sandbox/README.md)。

`packages/engine` 提供通用比赛编排、流式 gzip 回放和确定性重演校验，通过适配器调用沙箱。圈地包附带可信游戏定义、运行时 SDK 与官方示例 bot。在根目录运行 `pnpm example:paper --seed 42` 可完成一场本地比赛、保存回放并验证重演，输出结果和回放绝对路径。使用方法见 [引擎说明](packages/engine/README.md)。

共享配置集中在 `configs/`：`typescript/base.json` 定义编译选项，`typescript/test.json` 定义测试源码映射和检查范围，`typescript/tooling.json` 检查工具配置与脚本，`vitest/shared.ts` 定义各测试项目共用的设置。根目录保留 `vitest.config.ts`、`tsdown.config.ts` 工具入口；各 workspace 保留自己的配置并引用共享设置。

## 测试

全仓使用 Vitest，根 `vitest.config.ts` 通过 `test.projects` 发现 apps、packages 与 games 下的项目配置。调度、规则和文件读取使用 Node 环境；web 的 Vue 组件使用 jsdom 和 Vue 插件。新增模块沿用对应目录结构，添加自己的 `vitest.config.ts` 即可被发现，项目名须唯一。

`configs/vitest/shared.ts` 统一测试文件模式、mock 清理和 workspace 源码解析。测试使用 `tests/**/*.test.ts`，显式从 Vitest 导入 `test`、`expect` 等 API。源码路径统一维护在 `configs/typescript/test.json`，Vitest 与测试类型检查使用相同映射；生产包的 exports 仍指向 dist。新增游戏的标准根入口、game、rules、sdk、renderer 均可复用映射，引擎 node 子路径也显式映射到源码，自定义公开子路径需补充相应映射。

`pnpm test` 无需预先构建。测试配置使用 Vite runner loader，以支持无后缀的 TypeScript 配置导入。Node 测试、辅助文件和项目配置纳入 `configs/typescript/test.json`；Vue 测试由 web 的 `tsconfig.test.json` 和 vue-tsc 检查。Vitest 执行成功不能替代类型检查，`pnpm typecheck` 会检查这些文件。

```sh
pnpm test
pnpm test --project paper-rules
pnpm test:watch --project paper-rules
pnpm test:coverage
pnpm test:artifacts
```

覆盖率由根配置统一汇总源码，包含未覆盖的源文件，输出文本、HTML 与 LCOV 报告至 `coverage/`。仅声明类型的模块没有可执行逻辑，不据此添加无意义的运行时测试。

`pnpm test:artifacts` 先完成生产构建，再将公开 workspace 包打包、解压至仓库外并安装声明的运行依赖；使用未加载 TypeScript loader 的真实 Node 校验 exports、CLI、已编译 API、完整圈地比赛及沙箱子进程，并通过严格 NodeNext 消费者检查声明文件。该命令不发布 npm 包，不连接业务数据库，临时目录在结束后清理。

## 本地 CLI

先运行 `pnpm build:packages`，再执行：

```sh
pnpm arena run --bot ./games/paper/bots/official.js --seed 42
pnpm arena run --bot ./my-bot.js --opponent ./another-bot.js --matches 20 --seed 42
pnpm arena replay ./replays/match-实际文件名.json.gz --verify --logs
```

CLI 支持按发行下载初始化、指定 bot、官方或本地对手、顺序批量比赛、gzip 回放及日志校验。输出 JSON Lines，包含发行、完整限额、结果和回放绝对路径。回放无需 bot 文件。根脚本通过可信配置注册游戏，CLI 自身不绑定圈地。命令与接入方式见 [CLI 说明](packages/cli/README.md)。`arena dev` 的实时本地调试服务单独开发。

## 网页参赛与回放

启动数据库并执行迁移后，运行 `pnpm dev` 同时启动网站、API 和 worker。在网页注册或登录，进入游戏详情的「我的参赛策略」，选择 `.js` 文件并点击「上传并替换」，再点击「发起匹配」。比赛详情自动更新状态，结束后展示名次、得分、排位分变化与在线回放；排行榜和「我的比赛」按游戏独立展示。账号页可以修改密码，修改后所有设备需要重新登录。

登录凭据保存在浏览器 localStorage，会话过期后重新登录；退出会撤销当前会话。比赛结果和回放无需登录即可查看，普通玩家的最新代码仅本人可见。上传只替换代码，不会创建比赛；匹配请求在网络失败时复用幂等键，已有未完成的主动比赛会直接打开。

server 和 worker 必须使用同一个 `REPLAYS_DIR`；默认是仓库根目录下的 `data/replays`，相对路径同样以仓库根目录为基准。`GET /api/matches/:matchId/replay` 仅提供已完成比赛的 gzip 文件，不设置 `Content-Encoding`；浏览器和 CLI 自行解压。进行中的比赛每秒轮询，失败按 2/4/8 秒退避，隐藏页面暂停，恢复可见立即查询，终态停止轮询。

运行 `pnpm dev:web`，打开 [http://127.0.0.1:5173/replays](http://127.0.0.1:5173/replays)，选择 CLI 生成的 `.json.gz` 文件。文件在浏览器内读取、校验和重演，不上传，不依赖 API 或数据库。支持圈地地图、倍速播放、单步、时间轴、错误跳转、按玩家和级别查看日志，以及动作、CPU 和执行前观察。播放器与游戏 renderer 显式注册，未注册或校验失败的发行不播放。使用与扩展方式见 [播放器说明](packages/player/README.md)。

## 玩家开发包

游戏页提供统一提示词、SDK 说明、官方 bot 和最小模板，可以复制或下载。运行以下命令生成独立 ZIP，并从本地 API 初始化：

```sh
pnpm build:devkits
pnpm exec arena init paper ./paper-bot --server http://127.0.0.1:3000
cd paper-bot
pnpm install --frozen-lockfile
pnpm arena run --bot ./bot.js --seed 42
pnpm arena replay ./replays/实际文件名.json.gz
```

`pnpm build:devkits` 先构建，再按 `configs/devkits.ts` 注册生成 `data/releases/<gameId>/<release>/devkit.zip` 和不可变元数据。server 使用相同的 `DEVKITS_DIR`，相对路径以仓库根目录为基准。构建校验根锁文件，固定内部包本地归档、第三方依赖、WASM、SDK、提示词、示例及共享回放界面；已存在发行的内容不可覆盖，修改发行内容时递增游戏 `release`。

`arena init` 校验发行、ZIP 大小及 SHA-256、内部清单与逐文件摘要，拒绝非空目录与越界路径，不安装依赖或执行代码。安装后运行比赛和回放无需平台 API、数据库或账号。开发包的可视化回放命令输出 loopback URL，在浏览器打开即可，Ctrl+C 停止；`--verify --logs` 仍用于终端校验。

对外 npm 入口为 `npx @si-arena/cli@latest init paper ./paper-bot`。构建 CLI 时通过 `SI_ARENA_SERVER_URL` 固定公开服务地址，`--server` 可覆盖；本地构建默认 `http://127.0.0.1:3000`。仓库构建与测试不发布 npm 包，首次正式使用 npx 前需将 CLI 及其公开依赖发布到 npm。

统一 CLI 的下载、调试和回放协议见 [本地开发与调试](docs/designs/local-development.md) 与 [分发设计](docs/architecture/distribution-and-development.md)。npm 包统一属于 `@si-arena`，游戏开发包与平台服务通过发行清单保持版本一致。

## 文档导航

- [玩法设计索引](docs/designs/README.md)：产品范围、排位、圈地玩法、本地调试体验。
- [技术架构索引](docs/architecture/README.md)：系统划分、游戏模块、沙箱、tick 与回放、数据与接口、分发。

先阅读 [产品与参与流程](docs/designs/product.md)，再阅读 [系统架构与技术选型](docs/architecture/overview.md)。

## 设计规范

文档定义玩法、接口和实现约束。每个游戏可在 manifest 中覆盖资源限额；平台默认每 tick 20ms CPU、32MiB QuickJS 运行内存、64KiB Memory，圈地继承这些默认值。完整配置与继承规则见 [资源限额](docs/architecture/resource-limits.md)。这些数值是执行契约，验收测试负责检查实现是否满足契约。
