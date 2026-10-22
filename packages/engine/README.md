# 通用 tick 引擎

`@si-arena/engine` 编排多人比赛、记录规范动作并验证确定性回放。运行依赖只有 protocol，不导入沙箱、具体游戏、数据库或 Vue。调用方通过工厂提供每位玩家的独立执行适配器。

| 入口                    | 内容                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `@si-arena/engine`      | `runMatch`、`replayMatch`、`MemoryReplaySink`、`parseGameState`、`stateHash` 与公共契约；可被浏览器导入 |
| `@si-arena/engine/node` | `ReplayFileSink` 与 `readReplayFile`；Node 文件与 gzip 操作                                             |

核心 SHA-256 使用 Web Crypto，浏览器需提供 `crypto.subtle` 的安全上下文；Node 要求 26 及以上。

## 本地完整比赛

在仓库根目录运行：

```sh
pnpm example:paper --seed 42
```

该命令构建共享包，使用真实 V8 isolate 沙箱执行圈地官方 bot 与 idle 对手，按默认发行预算跑到终局，流式保存 gzip 回放，再从文件独立重演并核对哈希。它打印比赛结果、校验结论与文件绝对路径。默认文件位于系统临时目录；`--out <path>` 可指定不存在的目标文件，相对路径按示例进程工作目录解析。已有文件不会被覆盖。

示例是本地开发命令，不连接平台服务，不创建线上匹配。完整的 `arena init/dev/run/replay` 用户工具由 CLI 层组装，引擎保持独立。

## 组装比赛

```ts
import { runMatch } from "@si-arena/engine";
import { ReplayFileSink } from "@si-arena/engine/node";
import { MatchLogBudget, SandboxPlayer } from "@si-arena/sandbox";
import { paperGame, PAPER_SDK_SOURCE } from "@si-arena/game-paper/game";

const source = "export default () => ({ type: 'idle' })";
const logBudget = new MatchLogBudget(paperGame.manifest.resolvedLimits.logs.matchBytes);
const summary = await runMatch({
  matchId: "local-example",
  game: paperGame,
  seed: 42,
  players: [
    { id: "alpha", slot: 0, name: "Alpha", official: false },
    { id: "beta", slot: 1, name: "Beta", official: false },
  ],
  captureLogs: true,
  sink: new ReplayFileSink("./replays/local-example.json.gz"),
  async createExecutor(player, context) {
    return SandboxPlayer.create({
      ...context,
      playerId: player.id,
      source,
      sdkSource: PAPER_SDK_SOURCE,
      isolation: { kind: "local" },
      parseAction: paperGame.rules.parseAction,
      defaultAction: { type: "idle" },
      logBudget,
    });
  },
});
console.log(summary.result, summary.finalStateHash);
```

工厂接收固定身份、发行限额与日志开关，返回 `execute(tick, observation, defaultAction)` 和幂等 `close()`。`SandboxPlayer` 直接满足这个接口。适配器必须校验动作并原子提交 Memory，失败时保留旧 Memory，按预算结束请求，并在 close 时释放执行中的请求。引擎检查身份、tick 和规范动作；适配器声称成功却返回非法数据属于系统错误。

所有观察和默认动作来自同一份冻结的世界，全部生成后才并发分派。收齐结果后按固定席位整理动作，调用一次 step。失败结果使用规则计算的当前默认动作，不直接信任失败输出的 action；淘汰者不再执行，动作集合不包含其 ID。

比赛开始时复制发行、规则函数、玩家与配置。世界从 tick 0 开始，每次只推进 1 tick，在发行 maxTicks 内返回完整参与者、有效名次和有限分数的结果。观察、动作和回调 frame 与外部数据隔离，规则修改输入会触发错误。每份规则输出只做一次严格快照（protocol 的 `snapshotJson`），之后在解析器、执行器与回调之间按引用共享；适配器收到的观察是深冻结快照，需要修改时自行复制。规则、观察、适配器、存储错误或取消会终止整场、关闭已创建的执行器并中止回放，不能转成玩家失误计分。

`signal` 支持取消；可选 `onTick` 接收新的冻结世界、事件与当前记录，用于本地会话和可视化。事件不写入标准回放。

## 回放保存与校验

`ReplaySink` 提供 start、append、finish 和 abort。引擎只在规则推进及契约检查成功后追加当前记录；只有终局、最终哈希和执行器清理均成功后，才结束文件，不积累每 tick 世界或 Memory。

- `ReplayFileSink` 按背压输出单个 JSON/gzip 文件，默认最多 64MiB 未压缩数据。先写权限为 0600 的唯一临时文件，结束后 fsync 数据并原子创建目标硬链接；Unix 还同步目录。worker 后续仍须在数据库事务确认执行权后引用该候选文件，文件生成不等于已计分。
- `MemoryReplaySink` 用于测试和短本地会话，默认 16MiB 上限，仅完整完成后暴露 replay，不能替代服务端流式存储。
- `readReplayFile` 默认限制压缩输入 32MiB、解压结果 64MiB，拒绝损坏 gzip、无效 UTF-8 或 JSON。`replayMatch` 默认最多校验 32MiB JSON，可由可信调用方调整读取预算。

```ts
import { replayMatch } from "@si-arena/engine";
import { readReplayFile } from "@si-arena/engine/node";
import { paperGame } from "@si-arena/game-paper/game";

const raw = await readReplayFile("./replays/local-example.json.gz");
const summary = await replayMatch(raw, paperGame);
console.log(summary.result);
```

调用方从注册表选择可信发行，引擎核对游戏 ID、规则发行、botProtocolVersion、引擎兼容标识和完整限额，不执行文件指定的代码。它从完整 S0 开始，不调用 init、不加载 bot；校验连续 tick、活跃玩家的完整规范动作、诊断边界、首次终局位置、结果与 SHA-256。缺记录、终局后多余记录、额外世界快照或源码字段、发行或哈希不符均拒绝。

哈希按 UTF-16 码元递归排序对象键，保持数组顺序，-0 编码为 0。日志、错误和资源数据不参与规则判定，也不会让重演重新替换动作。只有整个 replayMatch Promise 成功后，才能将文件标记为有效回放。

## 游戏扩展与验证

可信 `GameDefinition` 提供 manifest、纯规则、parseConfig、parseState 和 parseObservation；数据解析器接收固定配置与参赛席位，观察还需校验当前玩家身份及 tick。错误的系统观察在执行 bot 前终止比赛。新增游戏通过独立包和显式注册接入，不在引擎增加 game ID 分支。

```sh
pnpm test --project engine
pnpm check
pnpm test:artifacts
```

测试覆盖执行顺序、观察隔离、默认动作、Memory 恢复、淘汰、取消和清理、规则与存储故障、回放篡改、gzip 边界，以及真实沙箱中的官方圈地完整比赛。打包检查还在仓库外运行真实比赛并重演，不依赖源码别名或 workspace 链接。
