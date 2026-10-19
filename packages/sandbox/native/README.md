# 同步 QuickJS 构建

绑定与引擎来自 [quickjs-emscripten v0.32.0](https://github.com/justjake/quickjs-emscripten/tree/v0.32.0)，固定 Git 修订 `df4efb9ef2cb25c417ecb57986da462d11b244ed`，其 vendored Bellard QuickJS 版本为 `2025-09-13`。构建使用 Emscripten 5.0.1，输出 Node CommonJS 加载器和同步 WASM，不启用 Asyncify。

`build.mjs` 在临时目录应用以下改动，保留上游文件和 MIT 许可证：

1. WASM 版本的默认分配器使用 `malloc_usable_size` 累计实际已分配内存；上游 Emscripten 分支返回 0，只能发现单次大分配，无法正确累计存活的小额分配。
2. `js_malloc_rt`、`js_realloc_rt` 和 `JS_ThrowOutOfMemory` 设置不可由玩家清除的原生失败位。
3. 原生栈检查设置独立失败位，玩家 catch 栈异常也不能提交动作。
4. 导出仅供宿主调用的读取与重置函数。每个进程同时只运行一个 Runtime，失败位在下一 tick 初始化前重置，不暴露给玩家。

CPU 中断由宿主保存不可清除的标记，提交前再次检查原生位和线程 CPU 用量。不会读取玩家异常的 message 来猜测 OOM，也不因玩家自行抛出同名异常而宣称资源超限。

安装并激活 Emscripten 5.0.1 后，从仓库根运行：

```sh
pnpm --filter @si-arena/sandbox build:wasm
```

`EMCC` 可指定编译器路径；`ARENA_QUICKJS_SOURCE` 可指定本地上游 checkout，脚本校验其 HEAD 后复制到临时目录再打补丁。默认下载固定 tag 并核对修订，不修改用户 checkout。普通 TypeScript 构建复用已提交的 `runtime/` 文件，不联网重新编译 WASM。

`runtime/build.json` 记录版本、补丁标识和 WASM SHA-256。修改原生逻辑后重新构建并运行沙箱测试、全仓检查、打包验证及性能脚本。生成的加载器/WASM 不参与代码格式化和 lint；构建脚本与 TypeScript 包装器正常检查。

## 本地性能记录

在 Apple M4、macOS arm64、Node.js 26.11.1、quickjs-emscripten 0.32.0 上采样，关闭日志，使用默认 20ms CPU 预算、两个 1200 格数组作为观察。5 tick 预热后取 100 tick：

| 项目                       |   均值 |    P95 |
| -------------------------- | -----: | -----: |
| 子进程内线程 CPU           |  772μs | 1057μs |
| 完整往返墙钟               | 1535μs | 2014μs |
| Runtime/Context 创建       |   71μs |  121μs |
| 可信封装与观察/Memory 注入 |  605μs |  819μs |
| SDK 初始化                 |   13μs |   14μs |
| AST 检查与玩家模块加载     |   54μs |  103μs |
| 入口与动作/Memory 序列化   |   24μs |   42μs |
| 结果提取                   |    8μs |   15μs |
| Runtime/Context 清理       |   57μs |   92μs |

阶段数据在当前进程单独采样；完整 CPU 和往返数据在真实子进程采样，不能将两组均值直接相加推算 IPC。往返还包含宿主校验、序列化、调度与清理，不能代替 CPU 用量，也不代表生产并发吞吐量。冷启动、不同源码/Memory 大小和其他机器需单独测量；启动 Node/WASM 使用独立 startup 预算。
