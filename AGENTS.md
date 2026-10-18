# AGENTS.md

本文件适用于整个仓库。与用户当前明确要求冲突时，以用户要求为准。

## 项目与文档

SI Arena（`si-arena`，SI = Super Intelligence）是 AI 编程自由竞技游戏平台，npm 组织为 `@si-arena`。用户在本地使用 AI 编写 JavaScript 选手代码，平台负责对战、可视化与排位。

开始修改前阅读 [README.md](README.md)，再按任务阅读相关设计：

- 产品与页面：[产品设计](docs/designs/product.md)、[排位](docs/designs/ranked.md)、[圈地规则](docs/designs/paper.md)、[本地调试](docs/designs/local-development.md)。
- 模块与发行：[系统架构](docs/architecture/overview.md)、[模块边界](docs/architecture/monorepo-and-modules.md)、[开发包分发](docs/architecture/distribution-and-development.md)。
- 执行与数据：[沙箱](docs/architecture/sandbox.md)、[资源限额](docs/architecture/resource-limits.md)、[tick 与回放](docs/architecture/execution-and-replay.md)、[数据库与 API](docs/architecture/data-model-and-api.md)。

文档定义实现契约；接口声明、目录或启动入口不等同于功能已经实现。修改前检查实际代码，交付时准确说明已实现与未实现的范围。

## 产品边界

- 不集成模型 API，不验证代码来源，不构建严格模型评测系统。
- 只有玩家主动匹配才创建新比赛。上传、上线、离线、worker 轮询和定时任务都不能自动开赛；对手无需在线。
- 每个游戏的代码、分数与排名独立，每位用户在每个游戏仅保留最新源码，不增加玩家代码版本管理。
- 每个游戏发布时必须提供可运行的官方示例 bot；官方 bot 使用普通选手相同的执行、限额与计分路径，并参与排名。只有一个真实用户时也应能与官方 bot 开局。
- 不增加平台试跑模式；代码调试在本地开发工具中完成。
- 用户名与密码注册登录，具体认证与访问规则遵循数据与 API 文档。
- 保持实现小巧，围绕当前需求扩展，不引入插件市场、任意远程模块加载或额外基础设施。

## 仓库职责与依赖方向

| 目录                | 职责与边界                                             |
| ------------------- | ------------------------------------------------------ |
| `apps/web`          | Vue 网站，组装页面、播放器与游戏 renderer              |
| `apps/server`       | Fastify API、账号、上传和主动匹配                      |
| `apps/worker`       | 领取已有比赛，组装执行器与游戏，保存回放并结算         |
| `packages/protocol` | 共享 JSON、游戏、资源、执行和回放契约；不依赖业务包    |
| `packages/engine`   | 通用 tick 编排；通过适配器执行玩家代码，不绑定具体游戏 |
| `packages/sandbox`  | QuickJS-WASM 与隔离执行；不依赖账号、数据库或画面      |
| `packages/player`   | 通用 Vue 回放播放器；不执行 bot，不引入服务端模块      |
| `packages/cli`      | `arena` 命令和本地调试，复用引擎、沙箱与游戏包         |
| `games/<gameId>`    | manifest、纯规则、SDK、说明、renderer 与官方 bot       |

- 通过 workspace 包的公开 exports 导入，内部依赖使用 `workspace:*`；不跨包引用 `src` 或 `dist` 私有路径。
- 公共依赖版本集中在 `pnpm-workspace.yaml` 的 catalog，使用 `catalog:` 引用；修改依赖同步维护 lockfile。
- 游戏规则和 SDK 不依赖平台数据库、账号或排位。Node 规则入口不得加载 Vue/DOM，浏览器入口不得引入 Node、沙箱子进程或数据库代码。
- 新增游戏通过独立游戏包和显式注册接入，不在平台核心中添加游戏 ID 分支或圈地专属判断。
- 网页和本地工具共享 renderer、SDK、限额及发行信息，避免各自维护一套规则或默认值。

## 游戏、执行与回放约束

- 规则是确定性的纯逻辑：相同发行、状态和动作产生相同结果；不读取现实时间、网络、环境变量或宿主 `Math.random()`。PRNG 状态随世界保存。
- 每 tick 的观察来自同一个世界状态，收齐规范动作后只调用一次 `step`。执行完成顺序不能影响胜负。
- 不修改输入世界、动作或回放缓存中的嵌套数据；渲染插值不参与规则判定。
- 玩家代码是不可信文本，只能进入隔离沙箱；禁止用宿主 `eval`、`Function`、动态 `import` 或 Node `vm` 执行选手源码。
- 线上和本地采用相同的 QuickJS-WASM 同步执行方案；每位玩家独立执行进程，每 tick 重建 Runtime/Context。全局变量不跨 tick 保存，只有显式 JSON `Memory` 延续。
- 执行异常、超时、非法动作或玩家输出超限时，丢弃该 tick 的动作与候选 Memory，使用游戏默认动作并记录错误；保留上次成功的 Memory，下一 tick 重新调用，不影响其他玩家。
- 游戏规则、平台生成的观察或可信封装出错属于系统失败，不得伪装为玩家失误或据此计分。
- 限额由可信游戏 manifest 按字段覆盖平台默认值，日志配置按子字段合并；解析后随发行固定。不得允许客户端扩大正式排位预算，不得把墙钟时间作为 CPU 用量。
- 回放保存完整初始世界、连续 tick 的实际规范动作和发行信息，不依赖玩家源码、Memory 或每 tick 世界快照。执行错误可记录在本地与服务端回放，玩家 console 日志仅在本地捕获和展示。
- 回放只能加载已注册的可信规则发行，不用当前规则静默替代历史规则，也不执行回放文件指定的任意代码。

具体字段、默认数值、错误分类、碰撞阶段及校验流程以对应设计文档为准，避免在此复制另一份协议。

## 匹配、持久化与兼容

- 比赛创建时固定游戏发行、配置和限额；开局时通过一致性快照读取双方最新源码。之后上传只影响未来开局。
- 同一用户同一游戏最多有一个未完成的主动请求；用幂等键与数据库唯一约束共同防止并发重复建局，不能只靠先查再写。
- worker 在短事务中领取已有任务，执行期间不持有整场数据库锁。失去有效租约或执行标识不匹配后不能提交计分，也不能覆盖公开回放。
- 先可靠保存不可覆盖的回放候选，再在一个数据库事务中确认执行权、提交比赛终态和双方排位。重复提交不能重复计分，系统失败不计分。
- 不保存玩家历史源码来恢复失败比赛；游戏发行归档与玩家代码版本管理是两件事。
- `botProtocolVersion` 只在玩家接口不兼容时递增；兼容升级不要求重传，不兼容升级暂停旧选手主动与被动匹配并要求重传，排位保留。

## 开发方式

- 使用 Node.js 26、根 `packageManager` 固定的 pnpm 12（pnpm 通过 `manage-package-manager-versions` 自行切换版本，不使用 corepack），TypeScript ESM；不另加 npm/yarn lockfile。
- lint 使用 oxlint，格式化使用 oxfmt；不引入 ESLint 或 Prettier。
- 提交经过 git hooks：pre-commit 用 lint-staged 对暂存文件执行 `oxlint --fix` 与 `oxfmt`，commit-msg 用 commitlint 校验 Conventional Commits 格式；hooks 由根 `prepare` 脚本在 `pnpm install` 时安装，需要跳过时使用 `--no-verify`。
- 命令从仓库根目录执行，不硬编码个人机器上的绝对路径。
- 共享配置放在 `configs/typescript/` 和 `configs/vitest/`，根目录保留标准工具入口，各 workspace 保留自己的配置。调整配置位置时同步更新继承、导入、脚本及相对路径基准。
- 相对 TypeScript 导入省略扩展名，Vue/CSS 等资源保留实际扩展名，类型导入使用 `import type`；使用 `moduleResolution: Bundler`，由 tsdown 构建 ESM 与类型声明，前端使用 Vite。保持现有 strict 配置，不用 `any` 或关闭检查规避契约问题。
- 全仓测试使用 Vitest，按 workspace 声明项目并合并共享设置（`configs/vitest/shared.ts`）；测试与辅助文件采用 TypeScript，显式导入 `test`、`expect` 等 API。纯逻辑使用 Node，Vue 组件使用独立 jsdom 项目，不将 DOM 配置传播给规则。
- 源码测试与类型检查共用 `configs/typescript/test.json` 的测试映射，不依赖旧 dist；生产 exports 保持指向构建产物。新增公开子路径同步维护测试解析。测试代码和配置必须纳入类型检查，不把 Vitest 运行成功当作类型检查通过。
- Vue 使用 Composition API 与 `<script setup lang="ts">`，路由由 Vue Router 管理，样式遵循已有 Tailwind 主题。新增界面处理加载、错误与空数据，并支持窄屏、键盘操作和清晰焦点。
- 外部输入在边界校验，包括 API、玩家输出、Memory、IPC 和回放；TypeScript 类型不能代替运行时校验。
- 保持改动与任务范围一致，不进行无关重构、依赖升级或整仓格式化；不手工修改生成的 `dist`、`node_modules` 或 lockfile 内容。
- 配置示例放在 `.env.example`，不提交真实凭据、`.env`、本地数据库或调试产物。

常用命令：

```sh
pnpm install
pnpm dev
pnpm build
pnpm check
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm test:artifacts
pnpm arena --help
```

需要数据库时参考 README 启动本地 PostgreSQL。不要覆盖已有 `.env`；数据库迁移与初始化脚本必须使用明确的目标连接，避免在验证时修改用户已有数据。

## 验证与交付

- 按改动选择验证：纯文档改动检查链接、代码块和格式即可；代码改动运行受影响检查，提交交付前用 `pnpm check` 汇总验证，构建或包边界变更另运行 `pnpm build`。
- `pnpm check` 包含类型检查、lint、格式检查与测试，不包含全量生产构建。源码测试无需预构建；单独执行生产源码的类型检查时，先用 `pnpm build:packages` 构建共享依赖。
- 为会改变胜负、确定性、隔离、恢复或结算的行为补充有意义的测试，不为简单展示修改添加只复述实现的测试。
- 规则与回放验证碰撞、同时事件、终局和重演一致性；沙箱验证超限隔离、旧 Memory 保留及下一 tick 恢复；平台验证主动匹配、并发幂等与重复结算。
- 修改构建、exports、CLI 或分发机制时执行 `pnpm test:artifacts`，在仓库外通过真实 Node 与 NodeNext 消费者验证打包产物，避免测试别名和 workspace 链接掩盖问题；修改界面时检查桌面和手机布局。
- 行为、协议、资源或命令变化时同步更新对应设计、SDK、提示词、示例和 README。文档只写确定的设计，不加入“待定”“草案”等标签；影响需求的未决问题先与用户讨论清楚。
- 完成后说明改动、验证结果及实际限制；没有执行的验证不能声称通过。
- 保留用户已有修改，不擅自回退、清理或覆盖。提交与推送按用户指令执行，新增提交前检查差异与暂存内容。
