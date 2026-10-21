# SI Arena CLI

统一的 `arena` 命令使用引擎、QuickJS 沙箱与可信游戏包执行比赛、保存回放和校验重演，要求 Node.js 26 及以上。

## 在仓库运行

下载初始化不需要本地注册模块：

```sh
pnpm exec arena init paper ./paper-bot --server http://127.0.0.1:3000
# 指定历史发行，不读取 current 别名
pnpm exec arena init paper ./paper-bot --release paper@0.2.0 --server http://127.0.0.1:3000
```

对外入口是 `npx @si-arena/cli@latest init paper ./paper-bot --server http(s)://<平台地址>`（需要已发布的 npm 包）。CLI 默认连接 loopback，平台地址由 `--server` 传入；自托管构建可设置 `SI_ARENA_SERVER_URL` 烧入自己的默认地址。`--server` 允许 HTTP 与 HTTPS，下载仅使用同源元数据中的固定发行地址，不跟随 HTTP 重定向。

初始化先固定发行，下载最大 32MiB ZIP，校验外部字节数与 SHA-256、内部 release.json 摘要、组件版本/配置及逐文件摘要，最多解压 128MiB、2048 个文件加清单。只写常规文件，不恢复 ZIP 中的符号链接属性；拒绝越界、重复、大小写冲突和 Windows 保留路径。拒绝非空目标目录，校验后在相邻临时目录完整写入并原子移入，失败不留下半个项目。不会自动安装依赖、运行模块或创建线上比赛。

进入生成目录后：

```sh
pnpm install --frozen-lockfile
pnpm arena dev --bot ./bot.js
pnpm arena run --bot ./bot.js --seed 42
pnpm arena replay ./replays/实际文件名.json.gz
pnpm arena replay ./replays/实际文件名.json.gz --verify --logs
```

无 `--verify` 的开发包回放命令仅监听 127.0.0.1，输出 URL 并提供固定播放器资源和指定回放，Ctrl+C 停止。`arena dev` 同样仅监听 127.0.0.1 并依赖开发包内置的调试页资源，启动即自动开局，运行不依赖平台服务，网页共享同一播放器和 renderer。

从仓库根目录执行：

```sh
pnpm build:packages
pnpm arena --help
pnpm arena run --game paper --bot ./games/paper/bots/official.js --seed 42
pnpm arena run --game paper --bot ./my-bot.js --opponent ./another-bot.js --matches 20 --seed 42
```

根脚本加载 [可信注册配置](../../configs/arena.local.mjs)，已注册圈地与圈地大逃杀，用 `--game` 选择。`--bot` 指定玩家文件；省略 `--opponent` 时补入官方 bot。多人游戏允许重复传入 `--opponent`，指定对手后不再自动补位，人数必须在游戏范围内。

源码作为 UTF-8 文本读取，先在隔离进程中检查大小和语法，再进入比赛，不作为 Node 模块导入。圈地的玩家入口示例：

```js
export default function tick({ game, Memory }) {
  console.log("tick", game.tick);
  game.self.idle();
}
```

动作由游戏定义。运行错误、超限或非法动作会记录到回放并使用游戏默认动作，下一 tick 继续；系统或规则错误会使本场失败。

## 实时调试

`arena dev --bot ./bot.js [--opponent <file>] [--seed <uint32>]` 仅在独立开发包内提供（依赖开发包内置的调试页资源）。命令启动后立即与官方 bot 或 `--opponent` 指定的本地对手开局，stdout 输出 `dev` JSON Line 包含 URL；浏览器打开后：

- 运行中显示 tick 进度，整场完成后自动载入完整播放器：时间轴、逐 tick 前进、错误跳转、日志筛选、观察与 CPU。
- Tick 诊断面板提供所选选手 Memory 提交前后的对比。Memory 只存在于实时会话，不写入回放，记录总量有上限，超限后停止记录并提示。
- 「重新开局（同种子）」按当前种子复现同一局面；「换种子重开」使用浏览器生成的随机 uint32。任何时候都可以重开：进行中的比赛被中止，重新读取并校验源码后开局，不热替换。
- 每场完成输出一条 `match` JSON Line（无回放路径）；启动或重开失败输出 `error` 行，页面显示原因并保留上一场结果。Ctrl+C 停止服务。

dev 会话不保存回放文件；需要文件时用 `arena run` 以相同种子复现。

## 批量比赛与输出

`--matches` 默认 1，范围 1–1000，顺序执行，每场独立创建沙箱与 Memory。整批开始前读取一次所有源码，修改文件只影响下一次命令调用。`--seed` 默认 42，接受十进制 uint32，后续比赛逐次加一，超过 `4294967295` 回到 0。种子不能消除硬件造成的 CPU 超时差异。

`--out` 指定回放目录，默认当前工作目录的 `./replays`。文件名包含序号、种子与随机 ID，不覆盖已有文件。取消或系统失败时删除未完成回放，保留已完成文件。Ctrl+C / SIGTERM 取消执行并关闭子进程。

标准输出为 JSON Lines：

- `release`：游戏发行、bot 协议、引擎兼容标识、完整限额与参赛者。
- `match`：种子、结果、最终状态摘要、错误/日志数量与回放绝对路径。
- `batch`：玩家胜平负与整批错误数量；并列第一计平局，其他第一计胜，其余计负。

玩家 tick 出错不影响成功退出。参数、文件、系统或规则失败时向 stderr 输出 JSON 错误。正常退出码为 0，取消为 130，其他失败为 1；日志与错误字符串经过 JSON 转义。

使用注册发行的完整默认限额。`isolation.processMemoryEnforced: false` 表示本地未启用 Linux cgroup 的进程 RSS 上限，QuickJS 的 CPU、堆、栈、Memory 和其他协议预算仍执行。正式排位要求见 [沙箱设计](../../docs/architecture/sandbox.md)。

## 校验回放与查看日志

使用比赛输出的实际文件路径：

```sh
pnpm arena replay ./replays/match-实际文件名.json.gz --verify
pnpm arena replay ./replays/match-实际文件名.json.gz --verify --logs
```

`--verify` 在终端重演，检查规则发行、协议、限额、连续动作、终局和最终状态 SHA-256。无需玩家文件，不执行官方 bot。`--logs` 输出关联 tick 和玩家的日志、执行错误及截断标记；完整回放通过校验后才打印诊断。省略 `--logs` 时仍显示错误、日志与截断 tick 数量。

回放保存初始世界、规范动作和诊断，不保存源码、Memory 或每 tick 世界快照。本地默认捕获有预算限制的日志；读取限制为压缩输入 32MiB、解压后 64MiB，写入限制为 64MiB 未压缩 JSON。

## 接入游戏

CLI 运行依赖不包含具体游戏。由可信发行或开发者显式提供本地注册模块：

```js
// arena.config.mjs：可信宿主配置，不是玩家源码。
import { defineLocalGame } from "@si-arena/cli";
import { paperGame, PAPER_SDK_SOURCE, officialBotUrl } from "@si-arena/game-paper/game";

export default [defineLocalGame({ game: paperGame, sdkSource: PAPER_SDK_SOURCE, officialBotUrl })];
```

```sh
arena --registry ./arena.config.mjs run --game paper --bot ./bot.js
arena --registry ./arena.config.mjs replay ./replays/match.json.gz --verify
```

注册模块运行在 Node 宿主中，必须可信且通过 `--registry` 显式指定。CLI 不自动发现配置，不从源码或回放加载模块。模块只注册规则、SDK 和官方源码位置，官方源码仍进入普通选手相同的沙箱。注册多个游戏时必须用 `--game` 选择，每个注册固定一个发行，不静默替换历史规则。

其他工具可调用 `runCli(args, { games, cwd, write, signal })`，或注册对象的 `prepare`、`run`、`verify`。`prepare` 固定并验证源码，`run` 每次创建新比赛，`verify` 只读取回放。具体游戏类型保留在 `defineLocalGame` 闭包中，通用命令无需增加游戏分支。

完整开发包约定见 [分发设计](../../docs/architecture/distribution-and-development.md)。本地和网站 `/replays` 共用浏览器播放器，见 [播放器说明](../player/README.md)。
