# 玩家代码沙箱

`@si-arena/sandbox` 在独立 Node 子进程中用 isolated-vm 的 V8 isolate 执行玩家的单文件 ESM。每位玩家独占一个可复用进程和常驻 Isolate/Context，成功 tick 间保留源码模块、SDK 和全局缓存；任一执行失败后重建环境，仅从上次成功的 JSON Memory 恢复。

## 调用

```ts
import { MatchLogBudget, SandboxPlayer } from "@si-arena/sandbox";
import { resolveResourceLimits } from "@si-arena/protocol";
import { paperRules } from "@si-arena/game-paper/rules";
import { paperManifest } from "@si-arena/game-paper";
import { PAPER_SDK_SOURCE } from "@si-arena/game-paper/game";

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
  source: `export default ({ game, Memory }) => {
    Memory.turns = (Memory.turns ?? 0) + 1
    console.log('turn', Memory.turns)
    game.self.idle()
  }`,
  sdkSource: PAPER_SDK_SOURCE,
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

宿主侧的 JSON 校验、复制和 UTF-8 截断统一复用 `@si-arena/protocol`，拒绝隐藏属性、访问器、符号键、稀疏数组与隐式转换。无效观察属于系统错误，不推进 tick 或改变 Memory。isolate 内部保留独立的受控序列化器。

每场双方必须共享同一个 `MatchLogBudget`，以限制整场日志总量。本地启用 `captureLogs`，服务端使用默认的关闭配置：服务端 console 为空实现，不遍历或格式化参数。日志、截断标记和错误可以由引擎直接加入回放记录。

`sdkSource` 必须是可信、自包含的 ESM，默认导出 `(observation, { submit, reject }) => game` 工厂。模块在环境创建时加载一次；工厂每 tick 接收冻结的观察与仅在沙箱内存在的提交闭包，构建 game，并用 submit 初始化该游戏默认意图。返回值必须是对象。游戏自己定义角色、方法、重复命令优先级和规范动作结构；平台不提供统一方向或角色模型，不提供寻路和策略。

玩家入口接收 `{ game, Memory }`，正常返回 undefined。游戏方法可更新私有命令集合后调用 submit，提交任意合规 JSON 动作；每 tick 结束一次性序列化并验证，没有逐命令 IPC。reject 锁定 INVALID_ACTION，catch 后不能恢复；旧 tick 的提交闭包不可用于新 tick。非 undefined 入口返回值为 ENTRYPOINT_ERROR，不能覆盖已登记命令。

SDK 与玩家都在 isolate 内初始化，不传递宿主函数或业务对象；玩家上下文没有 Node 全局，并且删除了 `WebAssembly`、`SharedArrayBuffer` 与 `Atomics`。可信模块初始化、每 tick 视图构建与输入注入不计入玩家 CPU；首次及重建后的玩家模块加载/顶层代码、每 tick 入口、动作方法、日志格式化与命令/Memory 序列化计入所在 tick 的 CPU。工厂异常属于系统失败，没有额外的免费玩家初始化预算。

## 失败和生命周期

- 全局变量、闭包和 SDK 状态为易失缓存，包含历史观察引用在内的存活对象均受同一个 isolate 堆预算限制；Memory 是每 tick 独立注入的 JSON 检查点，旧引用不会替换下一 tick 的 Memory。
- 玩家异常、CPU/堆/栈超限、非法动作、Memory 无效或超限返回 `ok: false`，整体丢弃动作、候选 Memory 和易失环境；父进程才检测到的非法游戏动作也会要求下一 tick 重建。结果中包含默认动作、旧 Memory、受限错误与可选本地日志。
- CPU 通过 isolated-vm 的 `cpuTime`（isolate 自身线程）计量，执行进程每 1ms 轮询并在超限时销毁 isolate；墙钟由 isolate 调用超时与父进程看门狗独立限制，不用墙钟差值冒充 CPU。
- 被玩家捕获的分配失败或栈溢出（V8 的 `RangeError`）是普通 JS，上限已经生效；未捕获时按 `HEAP_LIMIT` / `STACK_LIMIT` 失败。堆整体超限时 isolate 被销毁，不可捕获。入口返回后排空的微任务改不了已序列化的提交，但其 CPU 计入本 tick。
- 超时或执行器退出后，父进程结束旧代次并异步重建。重建时等待不超过该游戏一个 tick 的墙钟预算，未就绪时返回执行错误，下一 tick 可继续。无法确认的进程退出（含 V8 灾难性错误导致的退出）记为 `EXECUTOR_ERROR`；只有 isolate 自身的堆超限或 cgroup OOM 事件才记内存错误。
- 启动失败、可信 SDK 错误、无效观察或平台封装超出 IPC 预算会抛出 `SandboxSystemError`。游戏解析器自身抛出的异常同样传播给调用方，不能按玩家失误计分。
- 每个选手同时只能执行一个 tick，tick 非负且严格递增。调用方控制整场并发，并在比赛结束或取消时调用 `close()`。

源码、SDK、限额与日志开关在每个执行进程就绪后绑定一次，重建进程时重新绑定；每 tick 只发送身份、观察、已提交 Memory 与日志余额。IPC 使用四字节大端长度前缀；解析 JSON 前检查长度，限制排队字节，并在每个动作、日志和截断消息上验证比赛、玩家、tick 和进程代次。关闭或被替换的请求不再接收迟到消息。

## 源码校验

`validateSource({ source, limits, isolation })` 使用独立的短生命周期进程，在堆与墙钟预算内进行 Acorn AST 检查和同版 V8 模块编译校验。拒绝静态 import、动态 import、导出转发与顶层 await，不实例化、不执行顶层代码、不调用入口。源码体积不合规时在启动子进程前拒绝。

语法校验不承诺入口或策略执行成功；入口是否为同步函数、动作与 Memory 是否有效在实际 tick 中检查。上传 API 的校验并发数由服务端控制为 2，比赛进程配额单独管理。

比赛执行进程在绑定源码时运行同一 AST 检查，属于平台策略：每个执行子进程对每份源码只检查一次，计入启动预算而不是任何 tick 的 CPU 或墙钟预算（进程重建后重新检查一次）；未通过的源码由第一个 tick 报告 `ENTRYPOINT_ERROR`。因此接近 codeBytes 上限的合法源码不会因解析耗时被判 `CPU_LIMIT` 或 `EXECUTION_TIMEOUT`。

V8 的分层编译在玩家自己的 isolate 内随 tick 推进，没有预热；第 0 tick 含模块求值与解释执行，实测约为稳态 tick 的 10 倍、仍低于 QuickJS 稳态 tick 的一半。

## 操作系统隔离

`isolation` 必须显式指定：

- `local`：用于本地开发，提供独立进程、isolate 堆、CPU、墙钟和输出限额；栈深由 isolate 线程固定（`stackBytes` 不改变它）；不声称限制整个进程的 RSS。
- `cgroup-v2`：Linux 服务端提供已委派的绝对目录 `root`，其中启用 memory 与 pids 控制器。执行器在创建 isolate 前加入独立子组，设置该发行的 `processMemoryBytes`、禁用 swap、限制进程/线程数，并读取内核 OOM 事件。设置失败立即拒绝启动，不能降级为 local。

生产部署以低权限账号运行执行器，在部署层限制网络、文件系统和系统调用，并为进程组预留容量。cgroup 目录来自可信服务配置，不接受玩家路径。macOS 的本地验证不能替代 Linux cgroup 集成验证。

## 二进制、测试与性能

isolated-vm 7 随 npm 分发预编译二进制（macOS arm64、Linux x64/arm64 的 glibc 与 musl、Windows x64），`node-gyp-build` 在 `require` 时按平台与 Node ABI 选取；仓库在 `pnpm-workspace.yaml` 的 `allowBuilds` 中把它的安装脚本设为 false，线上镜像与开发包的 `--ignore-scripts` 安装都无需编译器。其他平台（如 Intel macOS）需要 C++ 工具链并放行该构建。

```sh
pnpm test --project sandbox
pnpm test:artifacts
```

测试覆盖异常回滚、超限后恢复、未捕获与被捕获的分配失败和栈溢出、累计分配、进程死亡与墙钟终止、Promise 与微任务、宿主能力隔离、恶意 getter/原型修改、日志预算、长度前缀和发布后实际执行。Linux 主机可设置 `ARENA_TEST_CGROUP_ROOT` 为已委派目录，再运行同一测试命令，验证真实 OOM 终止；未提供 Linux 环境时该项显式跳过。

2026-10-22 在 Apple M 系列、Node 26.12 上用 `arena run` 对比同一批 bot 与种子（终局哈希逐局一致）：

| 场景                          | 指标                         | QuickJS-WASM | V8 isolate  |
| ----------------------------- | ---------------------------- | ------------ | ----------- |
| 圈地 3 局 × 500 tick          | 玩家 bot 平均计费 CPU / tick | 2437µs       | 133µs       |
|                               | 官方 bot 平均计费 CPU / tick | 812µs        | 85µs        |
|                               | 第 0 tick 计费 CPU           | 3.7–4.5ms    | 1.5–1.6ms   |
|                               | 整批墙钟 / 进程 CPU          | 5.7s / 9.4s  | 1.4s / 2.5s |
| 大逃杀 2 局 × 800 tick × 5 人 | 玩家 bot 平均计费 CPU / tick | 2956µs       | 231µs       |
|                               | 官方 bot 平均计费 CPU / tick | 1.5–1.6ms    | 160–280µs   |
|                               | 整批墙钟 / 进程 CPU          | 9.1s / 27.6s | 3.8s / 7.5s |

历史 QuickJS 基线与优化记录见 [docs/research](../../docs/research/)，不代表当前每 tick 成本。
