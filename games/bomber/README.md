# @si-arena/game-bomber

炸弹人游戏包：2–4 人在固定 15×13 的镜像地图上放置定时炸弹，炸墙拾取道具，被火焰波及即出局，第 300 tick 起外圈逐圈坍塌。规则与 SDK 入口不依赖 Vue、数据库或平台账号。完整玩法见 [炸弹人设计](../../docs/designs/bomber.md)。

- `src/manifest.ts`：游戏元数据、配置、竞技场设置与解析后的默认资源预算。
- `src/constants.ts`：固定地图尺寸、引信、道具上限、坍塌时间表与圈数计算。
- `src/sdk/`：玩家观察、状态、动作与 SDK 类型，以及可信运行时 SDK 源码。
- `src/game.ts`：可信游戏定义、配置、世界与观察身份校验、官方 bot 资源位置。
- `src/rules/`：初始化、观察、动作校验、同时结算、火焰与连锁、道具、坍塌与终局判定。
- `src/renderer/`：规则页展示数据、深色配色、Canvas 地图绘制与玩家得分摘要，独立 export 入口。
- `bots/`：官方 bot 与玩家模板。
- `PROMPT.md`、`SDK.md` 与 `bots/template.js`：统一参赛提示词、接口说明和玩家模板，供网页及独立开发包共用。
- `tests/`：规则、契约、确定性、完整对局重演、真实沙箱对局与 renderer 测试。

## 公开入口

| 入口                             | 内容                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@si-arena/game-bomber`          | `bomberManifest`、`bomberCatalogEntry`、`ringOf`、`collapsedRings` 与基础状态类型                                   |
| `@si-arena/game-bomber/sdk`      | `BomberAction`、`BomberObservation`、`BomberState`、`BomberTickInput` 等类型与 `BOMBER_SDK_SOURCE`                  |
| `@si-arena/game-bomber/rules`    | `bomberRules`、`parseBomberAction`、`parseBomberState`、`parseBomberObservation`、`bomberCollapse` 及事件、结果类型 |
| `@si-arena/game-bomber/renderer` | `drawBomberBoard`、`bomberPlayerSummaries`、`bomberHighlights`、`BOMBER_PALETTE`、`bomberPresentation`              |
| `@si-arena/game-bomber/game`     | `bomberGame`、`BOMBER_SDK_SOURCE`、`officialBotUrl`、`developmentFiles`                                             |

manifest 声明 `arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" }`，平台据此运行全服唯一的炸弹人竞技场；规则本身只负责一局比赛。

`drawBomberBoard` 接收已验证的世界与 Canvas 上下文，在深色底上绘制石柱、带内嵌的软墙、带斜线的坍塌格、网格、带引信环的炸弹、标有 F/B 的道具和带编号的圆形玩家；可选的动画输入与圈地游戏相同（`previousState`、`events`、`progress`、`reducedMotion`、`erroredPlayers`），补完玩家移动插值、本 tick 爆炸事件的火焰格、出局标记以及出错玩家的警示徽标。`bomberPlayerSummaries` 按席位生成得分、颜色与存活标记。绘制不修改世界，也不调用规则 step。

`bomberRules` 实现共享 `GameRules` 契约：

- `init` 接收无符号 32 位种子、固定配置及 2–4 名不同 ID、席位 0..n-1 的玩家，先打乱四个角的归属，再对左上象限逐格抽软墙与隐藏道具并四向镜像。输入数组顺序不决定席位，`step` 不再消耗随机数。
- `observe` 为存活玩家返回不含 `hidden` 的公开观察（含 `activeBombs` 与坍塌时间表）；已出局玩家与终局世界返回 `null`。输入世界的格子数组是引擎快照时按引用共享。
- `parseAction` 返回规范动作或校验错误，不允许额外字段；`defaultAction` 返回 `{ type: "idle" }`。
- `step` 只接收全部存活玩家的规范动作，按移动、放炸弹、引信与连锁、摧毁、火焰致死、拾取、坍塌、清理的顺序推进一 tick，返回新世界、确定性事件与可选终局结果。输入世界和动作不会被修改。
- `parseBomberState` 校验 JSON 世界的字段、石柱与坍塌格、隐藏道具位置、炸弹与道具、席位、位置、能力上限与出局记录，返回独立副本；不合规数据抛出 `TypeError`。

结果的 `reason` 为 `elimination`（存活不超过 1 人）或 `tick-limit`；`players[].score` 为最终得分（软墙每面 1 分、击杀每人 10 分，出局者为 0），`rank` 按设计文档的名次规则计算，`alive` 标记是否存活。

`bots/official.js` 使用同一 SDK、观察、Memory 与预算：每 tick 从场上所有炸弹推算未来 8 个 tick 内每格的着火时刻（含连锁），用广度优先搜索只走到达时不着火、之后仍有去处的格子；邻近软墙或对手且放弹后仍有逃生路径时放炸弹；顺路拾取道具；坍塌开始后把即将坍塌的圈视为致命并向中心转移。运行器通过可信 officialBotUrl 读取文本后送入沙箱，不在宿主 import 执行 bot。

## 验证

从仓库根目录执行，源码测试无需预先构建：

```sh
pnpm test --project bomber-rules
pnpm --filter @si-arena/game-bomber typecheck
```

测试覆盖镜像地图生成与密度、出生保护、移动阻挡与穿越、放弹限制与同格放弹、火焰形状与阻挡、连锁爆炸、同 tick 软墙阻挡与计分归属、道具显现与烧毁、火焰致死与击杀计分、同时死亡并列、死者炸弹继续爆炸、拾取上限、坍塌时间表与压死、中心不坍塌、名次与并列、状态与观察校验、随机对局重演，以及 2 人和 4 人官方 bot 完整对局经引擎重演、4 人真实沙箱对局无执行错误。
