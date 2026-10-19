## 0.1.0

### Minor Changes

- cpuMs 只计量玩家求值阶段：可信引导（运行时、上下文、bootstrap、SDK）不被 CPU 中断、不计入玩家预算，由 wallMs 兜底；慢速宿主不再把平台固定开销算进玩家预算，也不会把整场判为系统失败。

### Patch Changes

- Updated dependencies:
  - @si-arena/protocol@0.1.0
