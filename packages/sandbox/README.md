# @si-arena/sandbox

单个玩家的 V8 isolate 执行器。生产比赛由 `@si-arena/runner` 创建独立比赛进程，再在其中为每位玩家创建 `SandboxPlayer`。sandbox 不负责进程、数据库、文件回放或游戏注册。

`SandboxPlayer.create` 接收身份、源码文本、可信 `sdkSource`、完整限额、动作解析器和默认动作；`execute(tick, observation, defaultAction)` 返回规范动作、错误、CPU 和可选本地日志。它与 engine 的执行适配器结构兼容；`createSandboxExecutor` 提供延迟创建与幂等关闭。

源码静态检查在玩家绑定时完成，每个 session 独立缓存结果。可信封装、SDK 与玩家模块在环境创建时加载一次，成功 tick 间复用 isolate 与全局缓存。每 tick 观察与 Memory 通过捕获的解析器重新构建，旧引用不会指向新输入。可信准备合并为一次调用，协议拥有的不可变快照复用编码。

玩家入口保持 `export default function ({ game, Memory }) { ... }`，同步返回 undefined。SDK 工厂定义游戏视图、动作方法和默认意图；平台不提供策略或寻路。可信工厂失败为系统错误。首次及重建后的玩家源码编译和顶层执行、入口、动作方法、日志与严格输出序列化计入玩家 CPU，可信初始化和视图准备不计入。

动作和候选 Memory 必须同时成功才提交。失败丢弃候选值和 isolate，保留上次成功的 Memory。正常结果的 `memory` 诊断副本按需复制，`memorySnapshot` 是只读的已提交快照，普通引擎执行不复制诊断数据。快照不进入回放。`close()` 释放 isolate，不影响其他玩家。

每个 isolate 独立计量 `cpuTime`，每 1ms 轮询超限并销毁，返回结果前再次检查；墙钟超时独立兜底。堆预算由 isolated-vm 限制，捕获的分配/栈 RangeError 属普通 JS，未捕获的错误使 tick 失败。`stackBytes` 仍为描述字段，不控制 isolated-vm 执行线程的栈。灾难性 V8 错误终止比赛进程，由外层按系统失败处理。

没有 Node、网络、定时器、宿主业务对象或任意模块导入；删除 WebAssembly、SharedArrayBuffer 和 Atomics。玩家对象只在受限环境内严格序列化，宿主不遍历玩家对象或调用其 getter。原型污染、微任务、日志和错误提取均受现有预算与验证约束。

`compileSource` 是供 runner 校验进程使用的内部执行原语；上传 API 和本地文件校验使用 `@si-arena/runner` 的 `validateSource`，保持进程隔离。

```sh
pnpm test --project sandbox
pnpm test --project runner
pnpm test:artifacts
```

isolated-vm 7.0.1 保持现有预编译二进制安装方式，不增加原生扩展或第二套 JS 引擎。
