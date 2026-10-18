# @si-arena/game-paper

网格圈地游戏包。规则与 SDK 入口不依赖 Vue、数据库或平台账号。

- `src/manifest.ts`：游戏元数据、配置与解析后的默认资源预算。
- `src/constants.ts`：固定地图配置与 tick 上限。
- `src/sdk/`：玩家观察、状态和动作类型。
- `src/rules/`：初始化、观察、动作校验、同时结算、圈地与终局判定。
- `src/renderer/`：浏览器展示资源，独立 export 入口。
- `bots/`：官方 bot 源码目录。
- `tests/`：契约、碰撞、圈地及确定性测试。

## 公开入口

| 入口                            | 内容                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `@si-arena/game-paper`          | `paperManifest`、`paperCatalogEntry` 与基础状态类型                              |
| `@si-arena/game-paper/sdk`      | `PaperAction`、`PaperDirection`、`PaperObservation`、`PaperPlayer`、`PaperState` |
| `@si-arena/game-paper/rules`    | `paperRules`、`parsePaperAction`、`parsePaperState` 及事件、结果类型             |
| `@si-arena/game-paper/renderer` | 页面展示数据与配色                                                               |

`paperRules` 实现共享 `GameRules` 契约：

- `init` 接收无符号 32 位种子、固定配置、两个不同 ID 及席位 0/1，创建 tick 0 世界。输入数组顺序不决定席位。
- `observe` 返回完整数据副本与自身身份；终局或淘汰者返回 `null`，未知玩家 ID 抛错。
- `parseAction` 返回规范动作或校验错误，不允许额外字段。
- `defaultAction` 返回 `{ type: "idle" }`。
- `step` 接收所有仍可行动玩家的规范动作，一次推进一 tick，返回新世界、确定性事件与可选终局结果。输入世界和动作不会被修改。
- `parsePaperState` 校验 JSON 世界的字段、网格、席位、位置和存活归属关系，返回独立副本；不合规数据抛出 `TypeError`。

`step` 不负责执行选手源码或将运行错误转换为默认动作。运行器先校验执行结果、替换失败动作，再调用规则；缺失动作、额外参与者、未规范化动作或继续推进终局均被拒绝。这些调用错误不能产生可计分的比赛。

## 按动作推进一场比赛

先在仓库根目录执行 `pnpm build:packages`。在依赖本游戏包的 ESM 模块中运行：

```js
import { paperManifest } from "@si-arena/game-paper";
import { paperRules } from "@si-arena/game-paper/rules";

let state = paperRules.init({
  seed: 2,
  config: paperManifest.config,
  players: [
    { id: "alpha", slot: 0 },
    { id: "beta", slot: 1 },
  ],
});

for (;;) {
  const tick = paperRules.step(state, {
    alpha: { type: "idle" },
    beta: { type: "idle" },
  });
  state = tick.nextState;
  if (tick.result) {
    console.log(tick.result);
    break;
  }
}
```

这个动作序列在完成 600 tick 后结束，双方各保留 9 格领地并列第一。动作来源可以替换为运行器已验证的输出；规则本身不执行任何玩家 JavaScript。

## 验证

从仓库根目录执行，源码测试无需预先构建：

```sh
pnpm test --project paper-rules
pnpm test:watch --project paper-rules
```

测试覆盖同时碰撞、旧尾迹攻击、回城被截断、四邻接圈地、同时覆盖、零领地、终局优先级、输入不可变和观察副本。完整比赛测试只保存初始世界和 600 条双方动作，序列化后重演，对比最终世界、事件与结果；生成对局额外检查动作键插入顺序和左右镜像不会改变规则判定。

完整玩法见 [圈地设计](../../docs/designs/paper.md)，接口约束见 [游戏模块](../../docs/architecture/monorepo-and-modules.md)。
