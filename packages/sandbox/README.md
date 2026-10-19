# 玩家代码沙箱

`@si-arena/sandbox` 在独立 Node 子进程中使用同步 QuickJS-WASM 执行玩家的单文件 ESM。每位玩家独占一个可复用进程，每 tick 新建 Runtime/Context，只通过 JSON Memory 延续记忆。

## 调用

```ts
import { MatchLogBudget, SandboxPlayer } from "@si-arena/sandbox";
import { resolveResourceLimits } from "@si-arena/protocol";
import { paperRules } from "@si-arena/game-paper/rules";
import { paperManifest } from "@si-arena/game-paper";

const limits = resolveResourceLimits();
const state = paperRules.init({
  seed: 1,
  config: paperManifest.config,
  players: [
    { id: "alpha", slot: 0 },
    { id: "beta", slot: 1 },
  ],
});
const observation = paperRules.observe(state, "alpha");
const logBudget = new MatchLogBudget(limits.logs.matchBytes);
const player = await SandboxPlayer.create({
  matchId: "local-match",
  playerId: "alpha",
  source: `export default ({ Memory }) => {
    Memory.turns = (Memory.turns ?? 0) + 1
    console.log('turn', Memory.turns)
    return { type: 'idle' }
  }`,
  limits,
  isolation: { kind: "local" },
  parseAction: paperRules.parseAction,
  defaultAction: { type: "idle" },
  captureLogs: true,
  logBudget,
});

try {
  const outcome = await player.execute(0, observation);
  // outcome.action 已经过游戏校验；失败时为默认动作。
  // outcome.memory 是独立副本，失败时保留最近一次成功的 Memory。
} finally {
  await player.close();
}
```

`observation` 由调用方针对当前世界和玩家生成。`execute(tick, observation, defaultAction)` 的第三个参数可传入当前 tick 由规则计算的默认动作，省略时使用创建选手时的默认动作。`parseAction` 和默认动作属于可信游戏实现，不能由玩家代码提供。

CLI 与 worker 共用 `createSandboxExecutor(options)`：参数与 `SandboxPlayer.create` 相同，但不传 `defaultAction`；每次 `execute(tick, observation, defaultAction)` 显式传入当前默认动作，首次执行才启动子进程。返回的 `close()` 可重复调用，并等待正在进行的启动完成后释放子进程；关闭后拒绝执行。启动失败保持为系统失败。

宿主侧的 JSON 校验、复制和 UTF-8 截断统一复用 `@si-arena/protocol`，拒绝隐藏属性、访问器、符号键、稀疏数组与隐式转换。无效观察属于系统错误，不推进 tick 或改变 Memory。QuickJS 内部保留独立的受控序列化器。

每场双方必须共享同一个 `MatchLogBudget`，以限制整场日志总量。本地启用 `captureLogs`，服务端使用默认的关闭配置：服务端 console 为空实现，不遍历或格式化参数。日志、截断标记和错误可以由引擎直接加入回放记录。

`sdkSource` 可注入可信、自包含的 ESM，通过 `export default` 提供 SDK；默认导出空对象。SDK 与玩家都在 QuickJS 内初始化，不向玩家传递宿主函数或业务对象。SDK 初始化、观察注入、玩家顶层代码、入口、日志格式化与序列化均计入 tick CPU 用量。

## 失败和生命周期

- 玩家异常、CPU/堆/栈超限、非法动作、Memory 无效或超限返回 `ok: false`，整体丢弃动作和候选 Memory。结果中包含默认动作、旧 Memory、受限错误与可选本地日志。
- 线程 CPU 通过 Node.js 26 的 `process.threadCpuUsage()` 计量；墙钟由父进程看门狗独立限制，不用墙钟差值冒充 CPU。
- 超时或执行器退出后，父进程结束旧代次并异步重建。重建时等待不超过该游戏一个 tick 的墙钟预算，未就绪时返回执行错误，下一 tick 可继续。无法确认的进程退出记为 `EXECUTOR_ERROR`；只有确切的原生失败标记或 cgroup OOM 事件才记内存错误。
- 启动失败、可信 SDK 错误、无效观察或平台封装超出 IPC 预算会抛出 `SandboxSystemError`。游戏解析器自身抛出的异常同样传播给调用方，不能按玩家失误计分。
- 每个选手同时只能执行一个 tick，tick 非负且严格递增。调用方控制整场并发，并在比赛结束或取消时调用 `close()`。

IPC 使用四字节大端长度前缀；解析 JSON 前检查长度，限制排队字节，并在每个动作、日志和截断消息上验证比赛、玩家、tick 和进程代次。关闭或被替换的请求不再接收迟到消息。

## 源码校验

`validateSource({ source, limits, isolation })` 使用独立的短生命周期进程，在 CPU、堆、栈和墙钟预算内进行 Acorn AST 检查和同版 QuickJS compileOnly 校验。拒绝静态 import、动态 import、导出转发与顶层 await，不执行顶层代码、不调用入口、不排空 Promise jobs。源码体积不合规时在启动子进程前拒绝。

语法校验不承诺入口或策略执行成功；入口是否为同步函数、动作与 Memory 是否有效在实际 tick 中检查。上传 API 的校验并发数由服务端控制为 2，比赛进程配额单独管理。

比赛 tick 路径也运行同一 AST 检查，但它属于平台策略：每个执行子进程对每份源码只检查一次，且不计入该 tick 的 CPU 预算（进程重建后重新检查一次）。因此接近 codeBytes 上限的合法源码不会因解析耗时被判 `CPU_LIMIT`。

## 操作系统隔离

`isolation` 必须显式指定：

- `local`：用于本地开发，提供独立进程、QuickJS 堆/栈、CPU、墙钟和输出限额；不声称限制整个进程的 RSS。
- `cgroup-v2`：Linux 服务端提供已委派的绝对目录 `root`，其中启用 memory 与 pids 控制器。执行器在初始化 WASM 前加入独立子组，设置该发行的 `processMemoryBytes`、禁用 swap、限制进程/线程数，并读取内核 OOM 事件。设置失败立即拒绝启动，不能降级为 local。

生产部署以低权限账号运行执行器，在部署层限制网络、文件系统和系统调用，并为进程组预留容量。cgroup 目录来自可信服务配置，不接受玩家路径。macOS 的本地验证不能替代 Linux cgroup 集成验证。

## WASM、测试与性能

预构建的同步 WASM 和 Node 加载器位于 `runtime/`，随 npm 包分发；普通使用者无需安装编译器。固定上游修订、原生补丁、编译命令、许可证和 SHA-256 见 [构建说明](native/README.md)。

```sh
pnpm test --project sandbox
pnpm --filter @si-arena/sandbox benchmark
pnpm test:artifacts
```

测试覆盖异常回滚、超限后恢复、被 catch 的分配失败、累计小额分配、进程死亡与墙钟终止、Promise、宿主能力隔离、恶意 getter/原型修改、日志预算、长度前缀和发布后实际执行。Linux 主机可设置 `ARENA_TEST_CGROUP_ROOT` 为已委派目录，再运行同一测试命令，验证真实 OOM 终止；未提供 Linux 环境时该项显式跳过。

性能脚本使用两个 1200 格数组模拟观察体积，执行 5 tick 预热与 100 tick 采样；分别报告线程 CPU、往返墙钟和内部阶段用量。它只测执行器，不连接平台、不创建排位。
