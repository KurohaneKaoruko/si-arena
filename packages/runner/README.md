# @si-arena/runner

线上 worker 与本地 CLI 共用的比赛进程运行器。每场一个独立 Node 进程，里面运行可信规则、回放写入和每位玩家独立的 V8 isolate。运行器不访问数据库、不创建比赛、不执行结算。

```ts
import { runMatchProcess } from "@si-arena/runner";
import { paperGame } from "@si-arena/game-paper/game";

const summary = await runMatchProcess({
  module: {
    url: import.meta.resolve("@si-arena/game-paper/game"),
    gameExport: "paperGame",
    sdkSourceExport: "PAPER_SDK_SOURCE",
  },
  manifest: paperGame.manifest,
  matchId: "local-example",
  seed: 42,
  players: [
    { id: "a", slot: 0, name: "A", official: false },
    { id: "b", slot: 1, name: "B", official: true },
  ],
  sources: ["export default () => {}", "export default () => {}"],
  isolation: { kind: "local" },
});
```

`module` 只能来自调用方显式信任的本地注册，不能由玩家文件、API 请求或回放指定。源码始终作为文本绑定，绝不作为宿主模块加载。players 必须按 slot 从 0 连续排列，sources 使用同一顺序。游戏模块的 ID、发行和玩家协议必须匹配冻结 manifest。源码分玩家独立绑定，按 UTF-8 字节拆成有界 ASCII 编码帧；控制字符和较大的合法源码也不会突破单帧限制。

不传 `replayPath` 时使用临时 gzip 文件，完成后有界读取为 `replayData` 并清理；传入绝对路径时，先在同目录的私有暂存目录完成 gzip、fsync，再用硬链接创建目标，禁止覆盖。返回成功前候选文件已可靠保存。发布公开回放和数据库结算由调用方完成。

普通异常、CPU、墙钟、isolate 堆超限和非法输出只使对应玩家的本 tick 失败，丢弃其易失环境，下一 tick 从上次成功 Memory 恢复。原生崩溃、进程 OOM、可信规则/SDK 失败或整个 runner 无进展均抛出 `RunnerSystemError`，整场不应计分。没有进程级续跑。

`isolation` 必填：`local` 不承诺整个进程 RSS 硬上限；`cgroup-v2` 要求 Linux 委派目录，在加载游戏和创建 isolate 前限制整个比赛进程的 `runnerMemoryBytes`、swap 和线程数，失败不降级。默认整场 512MiB，发行预算至少覆盖所有玩家的 isolate 堆和 128MiB 宿主余量。执行进程不继承业务环境变量或数据库凭据。

每个控制和诊断帧携带进程代次，进度与 Memory 同时校验比赛、玩家和 tick。长度前缀、发送队列和 Memory 追踪均有界；普通比赛不传输观察或 Memory。只有传入 `onMemory` 才发送变化的已提交 Memory，整场最多 32MiB，单条诊断仍受 IPC 帧限额约束，截断时调用 `onMemoryTruncated`。`signal` 取消会终止整场进程并清理自身暂存目录。

`validateSource` 使用单独的短生命周期进程，只进行 AST 检查与同版 V8 模块编译，不实例化、不执行顶层代码。上传并发限制仍由 API 控制。

验证：`pnpm test --project runner`、`pnpm test:artifacts`。真实 Linux cgroup 验证需要 `ARENA_TEST_CGROUP_ROOT`；本地 macOS 测试不能替代它。配对性能基准见[性能记录](../../docs/research/runner-architecture-performance.md)与根目录 `scripts/benchmark-runner.mjs`。
