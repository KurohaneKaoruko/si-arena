## 0.6.0

### Minor Changes

- 整场独立 runner 进程与每玩家常驻 isolate，原子 Memory 检查点、共享快照编码和有界 gzip 写入；CLI 支持按资源并行的 --jobs、顺序输出与独立失败。进程内存契约改为 runnerMemoryBytes，发行更新为 paper@0.3.0 与 royale@0.2.0，玩家协议版本保持不变。

### Patch Changes

- Updated dependencies:
  - @si-arena/protocol@0.6.0
