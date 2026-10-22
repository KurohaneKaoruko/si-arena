# @si-arena/game-snake

贪吃蛇大作战游戏包：2–4 条蛇同场，吃食物变长、恢复体力，撞墙、撞身、饿死或头对头更短的一方即出局。规则与 SDK 入口不依赖 Vue、数据库或平台账号。完整玩法见 [贪吃蛇设计](../../docs/designs/snake.md)。

- `src/manifest.ts`：游戏元数据、配置、竞技场设置与解析后的默认资源预算。
- `src/constants.ts`：固定配置、tick 上限，以及按人数计算地图边长的公式。
- `src/sdk/`：玩家观察、状态、动作与 SDK 类型，以及可信运行时 SDK 源码。
- `src/game.ts`：可信游戏定义、配置、世界与观察身份校验、官方 bot 资源位置。
- `src/rules/`：初始化、观察、动作校验、同时结算、食物生成与终局判定。
- `src/renderer/`：规则页展示数据、深色配色、Canvas 地图绘制与玩家长度摘要，独立 export 入口。
- `bots/`：官方 bot 与玩家模板。
- `PROMPT.md`、`SDK.md` 与 `bots/template.js`：统一参赛提示词、接口说明和玩家模板，供网页及独立开发包共用。
- `tests/`：规则、契约、确定性、完整对局重演、真实沙箱对局与 renderer 测试。

## 公开入口

| 入口                            | 内容                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@si-arena/game-snake`          | `snakeManifest`、`snakeCatalogEntry`、`snakeMapSize` 与基础状态类型                               |
| `@si-arena/game-snake/sdk`      | `SnakeAction`、`SnakeObservation`、`SnakeState`、`SnakeTickInput` 等类型与 `SNAKE_SDK_SOURCE`     |
| `@si-arena/game-snake/rules`    | `snakeRules`、`parseSnakeAction`、`parseSnakeState`、`parseSnakeObservation` 及事件、结果类型     |
| `@si-arena/game-snake/renderer` | `drawSnakeBoard`、`snakePlayerSummaries`、`snakeHighlights`、`SNAKE_PALETTE`、`snakePresentation` |
| `@si-arena/game-snake/game`     | `snakeGame`、`SNAKE_SDK_SOURCE`、`officialBotUrl`、`developmentFiles`                             |

manifest 声明 `arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" }`，平台据此运行全服唯一的贪吃蛇竞技场；规则本身只负责一局比赛。

`drawSnakeBoard` 接收已验证的世界与 Canvas 上下文，在深色底上绘制网格、食物圆点、内缩的身体节与带圆环和编号的头部；可选的动画输入与圈地游戏相同（`previousState`、`events`、`progress`、`reducedMotion`、`erroredPlayers`），补完头部沿 move 事件滑动、刚让出的尾节渐隐、出局叉号以及出错玩家的警示徽标。`snakePlayerSummaries` 按席位生成长度、颜色与存活标记。绘制不修改世界，也不调用规则 step。

`snakeRules` 实现共享 `GameRules` 契约：

- `init` 接收无符号 32 位种子、固定配置及 2–4 名不同 ID、席位 0..n-1 的玩家，按人数生成地图，种子决定四个角与席位的对应关系。输入数组顺序不决定席位。
- `observe` 为存活玩家返回公开观察；已出局玩家与终局世界返回 `null`。输入世界的身体与食物列表是引擎快照时按引用共享。
- `parseAction` 返回规范动作或校验错误，不允许额外字段；`defaultAction` 返回沿当前 `heading` 前进。
- `step` 只接收全部存活玩家的规范动作，一次推进一 tick，返回新世界、确定性事件与可选终局结果。输入世界和动作不会被修改；只有食物生成消耗 `rngState`。
- `parseSnakeState` 校验 JSON 世界的字段、席位、身体链、朝向、体力、食物与出局记录，返回独立副本；不合规数据抛出 `TypeError`。

结果的 `reason` 为 `elimination`（存活不超过 1 条）或 `tick-limit`；`players[].score` 为最终长度（出局者为 0），`rank` 按设计文档的名次规则计算，`alive` 标记是否存活。

`bots/official.js` 使用同一 SDK、观察、Memory 与预算：每 tick 标出所有蛇尾巴移动后仍被占用的格子和等长或更长对手头部能到达的格子，对四个方向做洪泛填充估算活动空间与到最近食物的距离；体力低于 40 或自己不是最长时优先觅食，否则优先保留空间，被等长对手同距离争夺的食物只在没有别的食物时才去追。运行器通过可信 officialBotUrl 读取文本后送入沙箱，不在宿主 import 执行 bot。

## 验证

从仓库根目录执行，源码测试无需预先构建：

```sh
pnpm test --project snake-rules
pnpm --filter @si-arena/game-snake typecheck
```

测试覆盖四种出局原因与原因叠加、尾巴让位与进食保尾、开局重叠、头对头长短判定与同时进食、食物补充与 15% 加餐、无空格不生成、终局时仍生成食物、名次与并列及同归于尽、各人数地图尺寸与出生点、状态与观察校验、随机对局从 JSON 重演（含 `rngState` 与食物位置），以及 2 条和 4 条官方 bot 完整对局经引擎重演、4 条真实沙箱对局无执行错误。
