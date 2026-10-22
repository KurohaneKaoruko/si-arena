# 技术架构

本目录定义 SI Arena 的系统边界、接口契约、资源限制和实现约定。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [系统架构与技术选型](overview.md) | 技术栈、服务职责、部署边界、任务与失败处理 |
| [Monorepo 与游戏模块](monorepo-and-modules.md) | 目录、依赖方向、插件接口、SDK、玩家入口 |
| [玩家代码沙箱](sandbox.md) | V8 isolate、进程隔离、资源限制、日志、恢复 |
| [资源限额](resource-limits.md) | 代码、CPU、内存、Memory、日志、IPC 与执行并发的确定值 |
| [tick 执行与回放](execution-and-replay.md) | 动作提交、确定性、回放结构、播放器与兼容性 |
| [数据模型与 API](data-model-and-api.md) | 最新代码、排位、任务、幂等结算、首版接口 |
| [本地分发与开发流程](distribution-and-development.md) | 独立下载包、构建、CLI、验证与实施顺序 |
| [部署与发布](deployment.md) | 生产 compose、镜像、上线步骤、npm 发布与备份 |

## 架构约束

- pnpm 12 workspace monorepo，前后端和游戏逻辑以 TypeScript 为主。
- Vue 3、Vite、Vue Router、Tailwind CSS；Node.js 26、Fastify 5；PostgreSQL 18、Drizzle。
- 玩家代码使用 isolated-vm 的 V8 isolate 执行，外层独立子进程隔离。
- 引擎、游戏规则、SDK、沙箱供线上和本地工具共用。
- 游戏模块为仓库内可信代码，玩家提交的 JS 是不可信代码，两者权限不同。
- 只有显式的用户匹配请求创建比赛，worker 不自行拉选手开赛。
- 每位玩家每游戏只保存最新源码，比赛内代码快照只在执行期间存在。
- 标准回放不含玩家代码或 Memory，不重新执行 bot。
- 玩家错误与系统错误分开处理，系统失败不计分。

## 阅读顺序

先读 [总览](overview.md)，再读 [模块接口](monorepo-and-modules.md)、[沙箱](sandbox.md) 和 [执行与回放](execution-and-replay.md)。数据库、API 和分发文档在实现对应组件时使用。

## 验收要求

1. V8 isolate 对死循环、深递归、分配失败、不可快速中断操作的处理及进程兜底。
2. 常驻 Runtime 的冷启动、热 tick、失败重建、存活堆和进程通信的实际成本。
3. 资源参数、并发数与小型游戏的吞吐量。
4. 本地多操作系统安装与 isolated-vm 预编译二进制加载。
5. 圈地的同时碰撞、同时闭合、领地覆盖与平局行为。

实现必须通过上述验收并记录测量结果，不能从库支持某个 API 推导出完整的安全或性能保证。资源限制以 [资源限额](resource-limits.md) 为准。

2026-10-20 的[玩家执行性能调研与优化方案](../research/player-execution-performance.md)记录原始完整比赛与阶段基准；当前玩家接口 v2 使用游戏自定义的基础动作方法登记意图，沿用常驻执行，随后完成[数据路径优化与配对实测](../research/player-data-optimization.md)，当前契约以本目录为准。

当前[基础动作 API 实施记录](../research/player-api-implementation.md)说明游戏自定义命令、公开观察、事件、失败恢复与未发布 0.2.0 的接口迁移。
