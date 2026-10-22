# @si-arena/game-tank

坦克对决游戏包：两辆坦克在 21×15 的中心对称砖墙迷宫里 1v1 机动开火，炮弹打穿砖墙、迎面对消，三点生命先清零者负。规则与 SDK 入口不依赖 Vue、数据库或平台账号。完整玩法见 [坦克对决设计](../../docs/designs/tank.md)。

- `src/manifest.ts`：游戏元数据、固定配置与解析后的默认资源预算；本游戏没有竞技场，走 1v1 排位。
- `src/constants.ts`：地图尺寸、tick 上限、生成阈值与两个固定出生点。
- `src/sdk/`：玩家观察、状态、动作与 SDK 类型，以及可信运行时 SDK 源码。
- `src/game.ts`：可信游戏定义、配置、世界与观察身份校验、官方 bot 资源位置。
- `src/rules/`：地图生成、观察、动作校验、同时结算（移动、开火、两个子步的炮弹飞行、清理）与终局判定。
- `src/renderer/`：规则页展示数据、深色配色、Canvas 地图绘制与玩家生命摘要，独立 export 入口。
- `bots/`：官方 bot 与玩家模板。
- `PROMPT.md`、`SDK.md` 与 `bots/template.js`：统一参赛提示词、接口说明和玩家模板，供网页及独立开发包共用。
- `tests/`：规则、契约、确定性、完整对局重演、真实沙箱对局与 renderer 测试。

## 公开入口

| 入口                           | 内容                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `@si-arena/game-tank`          | `tankManifest`、`tankCatalogEntry`、`TANK_SPAWNS` 与基础状态类型                             |
| `@si-arena/game-tank/sdk`      | `TankAction`、`TankObservation`、`TankState`、`TankTickInput` 等类型与 `TANK_SDK_SOURCE`     |
| `@si-arena/game-tank/rules`    | `tankRules`、`parseTankAction`、`parseTankState`、`parseTankObservation` 及事件、结果类型    |
| `@si-arena/game-tank/renderer` | `drawTankBoard`、`tankPlayerSummaries`、`tankHighlights`、`TANK_PALETTE`、`tankPresentation` |
| `@si-arena/game-tank/game`     | `tankGame`、`TANK_SDK_SOURCE`、`officialBotUrl`、`developmentFiles`                          |

`drawTankBoard` 接收已验证的世界与 Canvas 上下文，在深色底上绘制砖墙（带砂浆线）、钢墙（带斜面）、带炮管与生命点的坦克和炮弹；可选的动画输入与圈地游戏相同（`previousState`、`events`、`progress`、`reducedMotion`、`erroredPlayers`），补完坦克与炮弹的插值、命中与对消闪光、击毁标记以及出错玩家的警示徽标。`tankPlayerSummaries` 按席位给出生命值、颜色与存活标记；`tankHighlights` 把命中、砖墙摧毁与击毁转成回放战况。绘制不修改世界，也不调用规则 step。

`tankRules` 实现共享 `GameRules` 契约：

- `init` 接收无符号 32 位种子、固定配置及 2 名不同 ID、席位 0..1 的玩家，用 xorshift32 生成点对称地图并保证两出生点连通；只有初始化消耗随机数。输入数组顺序不决定席位。
- `observe` 为存活玩家返回公开观察；终局世界返回 `null`。输入世界的地形是引擎快照时按引用共享。
- `parseAction` 返回规范动作（`move`、`fire`、`idle`）或校验错误，不允许额外字段；`defaultAction` 返回 `{ type: "idle" }`。
- `step` 只接收双方的规范动作，一次推进一 tick，返回新世界、确定性事件与可选终局结果。输入世界和动作不会被修改。
- `parseTankState` 校验 JSON 世界的字段、地形、席位、位置、朝向、生命、炮弹与击毁记录，返回独立副本；不合规数据抛出 `TypeError`。

结果的 `reason` 为 `elimination`（有坦克被击毁）或 `tick-limit`；`players[].score` 为最终生命值（被击毁者为 0），`rank` 按设计文档的名次规则计算，`alive` 标记是否存活。

`bots/official.js` 使用同一 SDK、观察、Memory 与预算：先躲开同行同列 4 格内朝自己飞来的炮弹；同行同列且中间无钢墙时转向对方，2 格以内直射、有砖墙或对方无处可躲时开火，否则沿射线逼近；面对面的对峙由位置顺序决定的一方离开射线；其余时间按砖墙计 3 步代价的最短路逼近，走到砖墙前开炮开路，路径与最近位置记在 Memory 里以避免两个确定性 bot 互相阻挡或绕圈。运行器通过可信 officialBotUrl 读取文本后送入沙箱，不在宿主 import 执行 bot。

## 验证

从仓库根目录执行，源码测试无需预先构建：

```sh
pnpm test --project tank-rules
pnpm --filter @si-arena/game-tank typecheck
```

测试覆盖 200 个种子的地图对称、出生区清空与连通性，转向与各种移动阻挡、移入对方离开的格子，开火与在飞限制、炮弹穿过己方、出界、钢墙、砖墙，命中与生命、同格与互换对消、对消优先于砖墙，点射击毁与死亡清理、同归于尽并列、tick 上限按生命排名，事件分组顺序，状态与观察校验、快照共享、随机对局重演，以及官方 bot 完整对局经引擎重演、真实沙箱对局无执行错误。
