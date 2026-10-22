# 本地分发与开发流程

## 分发目标

项目使用 `si-arena` 标识，对外 npm 包归属 `@si-arena` 组织。统一 CLI 为 `@si-arena/cli`，可执行入口为 `arena`，不为每个游戏创建独立 CLI 或额外的 create 脚手架包。

玩家可以下载引擎、游戏包、SDK 和官方 bot 到本地运行，不依赖平台业务后端。线上与本地从 monorepo 的同一批源码构建，不维护第二套模拟规则。

软件发行管理与玩家代码管理分开：游戏和工具保留可复现发行，玩家在平台每游戏仍仅有最新代码。

## 一条命令下载

```sh
npx @si-arena/cli@latest init paper ./paper-bot --server http(s)://<平台地址>
```

pnpm 用户使用等价入口：

```sh
pnpm dlx @si-arena/cli@latest init paper ./paper-bot --server http(s)://<平台地址>
```

`init <gameId> <directory>` 先通过 `GET /games/:gameId` 获取当前发行 ID，再通过 `GET /games/:gameId/releases/:releaseId` 获取不可变发行元数据，按该版本的下载地址获取并校验网页同款 ZIP，解压到目标目录，输出安装、启动命令。`--release <releaseId>` 跳过当前发行查询，直接选择指定历史软件发行。不能在读完旧发行元数据后再请求可变的 current 下载别名，避免发布切换时混用版本。

CLI 默认连接 `http://127.0.0.1:3000`，平台地址由 `--server <url>` 传入，支持源站或以 `/api` 结尾的基址；官方 npm 包不烧入特定部署地址，自托管构建可设置 `SI_ARENA_SERVER_URL` 固定自己的默认地址。`--server` 接受 HTTP 与 HTTPS，无域名的部署可直接使用 IP + HTTP。下载地址必须与所选服务同源，HTTP 重定向被拒绝。发行元数据给出压缩包字节数与 SHA-256，CLI 在解压前验证；内部 release.json 的摘要、发行、组件版本和 resolvedLimits 必须与外部元数据一致，每个发行文件还验证字节数与 SHA-256。校验值来自受信连接的元数据，不仅依赖 ZIP 内部自述。

目标目录不存在时创建，已存在且非空时拒绝覆盖，目标本身不能是符号链接。ZIP 最大 32MiB，解压最多 128MiB、2048 个文件加清单。只创建常规文件，不恢复符号链接属性，拒绝越界、重复、大小写冲突和 Windows 保留路径；所有内容校验后写入相邻临时目录，再原子移入目标。失败时清理临时内容，保留原有空目录和并发写入的用户文件。用户无需平台账号，命令不上传代码、不发起线上匹配，不自动安装全局工具。

初始化只下载和生成项目，不自动安装依赖或执行玩家代码。用户进入目录后运行 `pnpm install`，再启动本地工具。npm 用于获取 CLI，与 monorepo 和开发包使用 pnpm 管理依赖不冲突。

CLI 不携带全部游戏，新游戏通过同一发行 API 与下载包接入。网站保留 ZIP 下载入口，与 CLI 共用产物、发行清单、校验信息和冻结的 `resolvedLimits`。

## 本地命令与可信注册

`arena run --bot <file>` 执行单场或默认并行的批量比赛。`--opponent <file>` 可重复指定本地对手，省略时补入官方 bot。每批开始前读取并检查源码，每场重新创建 Memory。`--jobs` 指定并行场数，默认取 CPU 人数配额与可用内存预算的较小值，`--jobs 1` 串行；结果按种子序号输出，系统失败场次单独报告，其他场继续，批次返回非零退出码。`--matches` 范围 1–1000，`--seed` 从指定 uint32 开始递增并回绕。`--out` 目录保存不可覆盖的 gzip 回放；取消时删除未完成文件，保留已完成文件。

终端回放入口为 `arena replay <file> --verify`；`--logs` 打印完整校验成功后的日志、错误和截断标记，不执行玩家代码。标准输出使用 JSON Lines，分别给出发行与限额、单场结果、批量摘要或回放校验结果。

CLI 通过 `defineLocalGame({ game, module, officialBotUrl })` 注册游戏，不依赖具体游戏包。发行启动器可通过 `runCli` 注入注册集合；仓库工具使用显式 `--registry <local-module>` 加载可信配置。模块运行在宿主中，不能是玩家源码，也不能由回放指定；CLI 不自动发现配置、不加载远程模块。多个游戏使用 `--game` 选择，同一注册固定规则发行，历史回放必须匹配对应发行。

注册配置负责组装可信的软件组件，不能取代下载时的发行清单与完整性校验。下载发行仍按 release.json 和外部元数据协议固定组件。已实现的命令操作见 [CLI README](../../packages/cli/README.md)。

## 开发包内容

每个游戏提供独立 ZIP 开发包，解压后结构如下：

```text
paper-devkit/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  README.md
  release.json
  arena.mjs
  PROMPT.md
  SDK.md
  bot.js
  bots/official.js
  sdk/
  vendor/
    si-arena-cli-<version>.tgz
    si-arena-engine-<version>.tgz
    si-arena-protocol-<version>.tgz
    si-arena-sandbox-<version>.tgz
    si-arena-runner-<version>.tgz
    si-arena-player-<version>.tgz
    si-arena-game-<gameId>-<version>.tgz
  dist/viewer/
  LICENSES/
```

开发包必须包含完整编译产物、可独立解析的依赖声明和可读示例代码。isolated-vm 的预编译二进制随依赖安装，macOS arm64、Linux x64/arm64 与 Windows x64 无需用户安装 C/C++ 编译器。

`pnpm install` 从包源安装第三方依赖，首次安装需要网络；安装完成后的比赛与回放不访问平台服务。开发包不分发 `node_modules` 或第三方包源缓存。

## workspace 构建

内部包使用 workspace 依赖表达源码关系，并设置清晰的 exports。发布时应转换或打包这些依赖，不能留下脱离仓库就无法解析的 `workspace:*` 链接。

pnpm 打包会转换 workspace 依赖声明，但不会自动把所有依赖实体都包含进 ZIP；产物脚本必须保证每个声明都可解析到已发布包、随包本地归档或已经打入的产物。[pnpm 文档](https://pnpm.io/workspaces)

内部包通过 pnpm pack 形成随包本地归档，开发包的依赖与 pnpm-workspace.yaml overrides 将整条内部依赖链指向 vendor/，不要求内部包已经发布到 npm。归档保留公开 exports、类型与比赛子进程，安装后按原包布局解析；viewer 额外构建成共享 Vue 控件和 renderer 的静态产物。SDK 类型、运行源码、官方 JS 与许可证同时放入开发目录。不得因树摇或资源路径改写遗漏动态加载文件。

仓库命令为 `pnpm build:devkits`，在完整构建后读取 `configs/devkits.ts` 的可信注册。构建入口拒绝不同步的根锁文件，用同一 catalog、供应链策略和已有解析生成独立锁文件，记录根锁文件 SHA-256；初始化不执行 pnpm，用户安装时使用开发包固定的锁文件。server 从 `DEVKITS_DIR`（默认根目录 `data/releases`）提供 `<gameId>/<release>/metadata.json` 和 `devkit.zip`。发布目录通过相邻候选目录原子移入，已有发行内容不同则失败，不覆盖历史产物。

## 发行清单

`release.json` 使用 `DevkitManifest`：`formatVersion: 1`，`game` 为完整 GameCatalogEntry（含发行、botProtocolVersion、配置和 resolvedLimits），`engineCompatibility`、`components` 精确版本映射、`runtime` 的 Node/pnpm 要求与构建精确版本、`sourceLockSha256`，以及 `files` 的相对路径到字节数和 SHA-256 映射。清单自身由外部 `manifestSha256` 保护。`GameReleaseMetadata` 保存同一发行描述，另有 `archive: { url, bytes, sha256 }` 和 `manifestSha256`。已发布档案不可覆盖；模板初始化时校验原始摘要，用户编辑 bot.js 后运行比赛不再要求它保持下载时的摘要。

CLI 启动时检查 Node 主版本，初始化和本地执行均要求 Node.js 26 及以上。运行环境采用 Node.js 26 与 pnpm 12，包配置声明 `node: >=26`、`pnpm: >=12`。每次发行在清单和锁文件中记录构建所用精确版本及依赖，不在安装时漂移版本。构建入口读取根 package.json 的 packageManager 和锁文件，拒绝锁文件不同步的构建。

回放播放器使用可信发行注册表查找规则与 renderer。当前注册 paper@0.3.0、royale@0.2.0 与 snake@0.1.0，不支持无用户的圈地 v1；其他发行或协议不匹配时拒绝。后续如需支持历史发行，必须显式提供其可信规则与 renderer，不保留用户历史 bot。

## 本地 CLI

命令职责：

| 命令 | 责任 |
| --- | --- |
| `arena init` | 解析游戏发行并下载独立开发包，生成本地目录 |
| `arena dev` | 启动 loopback 调试页面：与官方或本地对手自动开局，运行中显示进度，完成后逐 tick 回看并对比 Memory，可同种子或换种子重开 |
| `arena run` | 无界面执行一场或多场，输出摘要、错误和回放 |
| `arena replay` | 打开已有回放，不加载 bot |

开发包通过 package script 提供 `pnpm arena ...` 入口，无需全局安装。初始化使用临时获取的 `@si-arena/cli`；进入项目后的命令使用开发包固定版本的本地工具，不能因初始化 CLI 使用 latest 而自动升级本地运行器。启动说明必须与实际 scripts 一致。

修改代码后重启本地对局，保持线上“本场代码固定”的语义。多场批量运行每场独立初始化世界和 Memory，可以指定可复现种子序列。玩家文件只由本地运行器读取后作为字符串送入沙箱，不能直接通过宿主 `import` 执行。

viewer 使用与网站相同的通用播放器和游戏 renderer。调试 API 只暴露本地会话所需信息，不包含平台数据库、账号、排名或匹配服务。

## 实现顺序

1. 按圈地规则建立 protocol、纯规则引擎与官方 bot。
2. 实现 V8 isolate 隔离、失败恢复与规定限额，通过验收并记录测量结果。
3. 打通本地 CLI 的完整比赛、日志与动作回放；验证引擎重演与原运行一致。
4. 实现 PostgreSQL 模型、上传、用户主动匹配、任务与幂等排位结算。
5. 实现 Vue 网站的游戏页面、上传、匹配、排名与回放。
6. 从仓库外验证独立下载包，并完成线上 OS 隔离配置。
7. 用第二个最小游戏检验模块边界，避免把圈地专属逻辑写进平台核心。

第二个最小游戏仅作为架构验证样例，首发只发布圈地游戏。

## 必要验证

### 规则与回放

覆盖会改变胜负的碰撞、闭合、同时事件和结束条件。固定初始世界和动作，验证完整重演得到一致结果；剥离日志和诊断后结果不变。不同出生位置和并列规则都有明确样例。

### 沙箱

覆盖死循环、分配失败、深递归、异常对象、日志洪泛、Memory 与动作输出超限。检查其他 isolate 仍可执行，失败后下一 tick 有新的调用，旧 Memory 不被部分修改。比赛进程崩溃或失去响应时整场系统失败、不计分、不发布有效回放，其他比赛继续。

### 平台

上传不创建比赛；无主动请求时后台不新建比赛；离线用户可被选中；单个真实用户可与官方开局；重复匹配请求只有一场；重复结算不重复更新排名；系统失败不计分；比赛进行时上传只影响未来开局。

使用不同幂等键同时匹配也只能创建一场。兼容升级可继续参赛，不兼容升级要求重传且保留排位。排队期间替换为不兼容代码时，本场失败且不计分。租约失效的旧 worker 既不能结算，也不能覆盖已公开回放。

### 独立分发

在非 monorepo 目录解压安装，完成官方对战、日志回放、批量运行和不匹配发行的拒绝。验证目标 macOS/Linux/Windows 环境的 isolated-vm 二进制加载、Node API 和进程终止行为，不能只以开发机成功作为跨平台结论。

初始化期间切换平台当前发行时，仍按已解析发行下载和校验同一产物。压缩包摘要、大小或内部发行不一致时失败，不生成完整项目标记。

## 开发约束

- 每个游戏必须附带说明、SDK、官方 bot 和 renderer 后才能发布。
- 规则变更同步更新提示词、类型、官方代码与发行信息。
- 不把平台业务或数据库依赖引入可下载的引擎与游戏包。
- 参数配置由 schema 约束；正式排位不能接受客户端任意扩大预算。
- 构建、启动、迁移和测试脚本必须与根 README 的操作说明一致。
