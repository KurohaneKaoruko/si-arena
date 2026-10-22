# @si-arena/game-royale

圈地大逃杀游戏包：2–5 人同场圈地，被淘汰即出局，安全区随淘汰收缩。规则与 SDK 入口不依赖 Vue、数据库或平台账号。完整玩法见 [大逃杀设计](../../docs/designs/royale.md)。

- `src/manifest.ts`：游戏元数据、配置、竞技场设置与解析后的默认资源预算。
- `src/constants.ts`：固定配置、tick 上限，以及按人数计算地图边长与安全区目标的公式。
- `src/sdk/`：玩家观察、状态、动作与 SDK 类型，以及可信运行时 SDK 源码。
- `src/game.ts`：可信游戏定义、配置、世界与观察身份校验、官方 bot 资源位置。
- `src/rules/`：初始化、观察、动作校验、同时结算、圈地、安全区与终局判定。
- `src/renderer/`：规则页展示数据、深色配色、Canvas 地图绘制与玩家得分摘要，独立 export 入口。
- `bots/`：官方 bot 与玩家模板。
- `PROMPT.md`、`SDK.md` 与 `bots/template.js`：统一参赛提示词、接口说明和玩家模板，供网页及独立开发包共用。
- `tests/`：规则、契约、确定性、完整对局重演、真实沙箱对局与 renderer 测试。

## 公开入口

| 入口                             | 内容                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@si-arena/game-royale`          | `royaleManifest`、`royaleCatalogEntry`、`royaleMapSize`、`royaleZoneTarget` 与基础状态类型         |
| `@si-arena/game-royale/sdk`      | `RoyaleAction`、`RoyaleObservation`、`RoyaleState`、`RoyaleTickInput` 等类型与 `ROYALE_SDK_SOURCE` |
| `@si-arena/game-royale/rules`    | `royaleRules`、`parseRoyaleAction`、`parseRoyaleState`、`parseRoyaleObservation` 及事件、结果类型  |
| `@si-arena/game-royale/renderer` | `drawRoyaleBoard`、`royalePlayerSummaries`、`ROYALE_PALETTE`、`royalePresentation`                 |
| `@si-arena/game-royale/game`     | `royaleGame`、`ROYALE_SDK_SOURCE`、`officialBotUrl`、`developmentFiles`                            |

manifest 声明 `arena: { seats: 5, keepMatches: 3, tieBreakGameId: "paper" }`，平台据此运行全服唯一的大逃杀竞技场；规则本身只负责一局比赛。

`drawRoyaleBoard` 接收已验证的世界与 Canvas 上下文，在深色底上绘制安全区外的暗区与安全区边框、领地、尾迹和带编号的头部；可选的动画输入与圈地游戏相同（`previousState`、`events`、`progress`、`reducedMotion`、`erroredPlayers`），补完头部插值、圈地闪烁、切断与出局标记、缩圈闪烁以及出错玩家的警示徽标。`royalePlayerSummaries` 按席位生成面积、颜色与存活标记。绘制不修改世界，也不调用规则 step。

`royaleRules` 实现共享 `GameRules` 契约：

- `init` 接收无符号 32 位种子、固定配置及 2–5 名不同 ID、席位 0..n-1 的玩家，按人数生成地图，种子决定出生点起始角与席位对应关系。输入数组顺序不决定席位。
- `observe` 为存活玩家返回公开观察；已出局玩家与终局世界返回 `null`。输入世界的网格是引擎快照时按引用共享。
- `parseAction` 返回规范动作或校验错误，不允许额外字段；`defaultAction` 返回 `{ type: "idle" }`。
- `step` 只接收全部存活玩家的规范动作，一次推进一 tick，返回新世界、确定性事件与可选终局结果。输入世界和动作不会被修改。
- `parseRoyaleState` 校验 JSON 世界的字段、网格、席位、出生点、头部、尾迹、安全区与出局记录，返回独立副本；不合规数据抛出 `TypeError`。

结果的 `reason` 为 `elimination`（存活不超过 1 人）或 `tick-limit`；`players[].score` 为最终领地面积（出局者为 0），`rank` 按设计文档的名次规则计算，`alive` 标记是否存活。

`bots/official.js` 使用同一 SDK、观察、Memory 与预算：每 tick 从所有对手头部做广度优先搜索，只在任何对手都来不及踩到尾迹时沿自有领地边界拉出矩形回环，逼近时按最短路回城；规划避开即将被安全区吞掉的格子和对手一闭合就会圈占的区域；能在对手回城前踩到其尾迹、且自身尾迹安全时主动切断。运行器通过可信 officialBotUrl 读取文本后送入沙箱，不在宿主 import 执行 bot。

## 验证

从仓库根目录执行，源码测试无需预先构建：

```sh
pnpm test --project royale-rules
pnpm --filter @si-arena/game-royale typecheck
```

测试覆盖七种出局原因与原因叠加、撞头与互换、切断后攻击者留迹、多人同时闭合、圈占他人尾迹、脚下领地被圈走、缩圈时机与安全区出局、清理出局者领地、名次与并列及同归于尽、各人数地图尺寸与出生点、状态与观察校验、随机对局重演，以及 2 人和 5 人官方 bot 完整对局经引擎重演、5 人真实沙箱对局无执行错误。
