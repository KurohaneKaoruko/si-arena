# SI Arena CLI

统一的 `arena` 命令使用引擎、QuickJS 沙箱与可信游戏包执行比赛、保存回放和校验重演，要求 Node.js 26 及以上。

## 在仓库运行

从仓库根目录执行：

```sh
pnpm build:packages
pnpm arena --help
pnpm arena run --bot ./games/paper/bots/official.js --seed 42
pnpm arena run --bot ./my-bot.js --opponent ./another-bot.js --matches 20 --seed 42
```

根脚本加载 [可信注册配置](../../configs/arena.local.mjs)，已注册圈地。`--bot` 指定玩家文件；省略 `--opponent` 时补入官方 bot。多人游戏允许重复传入 `--opponent`，指定对手后不再自动补位，人数必须在游戏范围内。

源码作为 UTF-8 文本读取，先在隔离进程中检查大小和语法，再进入比赛，不作为 Node 模块导入。圈地的玩家入口示例：

```js
export default function tick({ observation, Memory, sdk }) {
  console.log("tick", observation.tick);
  return { type: "idle" };
}
```

动作由游戏定义。运行错误、超限或非法动作会记录到回放并使用游戏默认动作，下一 tick 继续；系统或规则错误会使本场失败。

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

这里实现本地执行与终端回放校验。已保存回放可在网站 `/replays` 页面打开，文件在浏览器内读取，见 [播放器说明](../player/README.md)。CLI 的 `init` 下载、`dev` 实时调试服务尚未接入；完整开发包约定见 [分发设计](../../docs/architecture/distribution-and-development.md)。
