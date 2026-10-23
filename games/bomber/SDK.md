# 炸弹人玩家 API

当前发行为 `当前游戏发行（见 release.json）`、玩家接口 v1。玩家提交自包含的 UTF-8 JavaScript ESM，默认导出同步函数，每 tick 调用一次：

```js
/** @param {import("@si-arena/game-bomber/sdk").BomberTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  const { x, y } = game.self.position;
  const { width, cells } = game.board;
  if (x + 1 < width && cells[y * width + x + 1] === 0) game.self.move("right");
  else game.self.idle();
}
```

入口返回 `undefined`，通过角色方法登记动作意图。可以直接结束函数或 `return;`，也可以 `return game.self.bomb()`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                        | 含义                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `game.self.move(direction)` | 登记上、右、下或左移动一格；方向为 `"up"`、`"right"`、`"down"`、`"left"` |
| `game.self.bomb()`          | 登记在脚下放一枚炸弹，本 tick 不移动                                     |
| `game.self.idle()`          | 登记停留                                                                 |

未调用动作方法时默认停留。同 tick 多次调用采用最后一次，三种动作相互覆盖。这些方法返回 `undefined`，不立即修改位置或地图；所有存活玩家执行结束后统一结算。方向格式正确但目标格是石柱、软墙、坍塌格、炸弹或地图外，属于有效意图，由规则判定为原地不动；脚下已有炸弹或炸弹数已达上限时 `bomb()` 同样有效但无事发生。走进火焰或留在即将坍塌的格子不由 API 自动避险。

方向错误产生 `INVALID_ACTION`，即使玩家 catch 后又调用合法动作，该 tick 也失败。执行异常、超时、CPU/堆/栈、动作或 Memory 超限，同样整体丢弃所有命令和候选 Memory，使用 idle，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponents 是公开数据。API 不提供火焰预测、寻路、逃生路线或放弹时机；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的公开事实

`game` 每 tick 是全新的只读视图。坐标原点左上，向右 x 增大、向下 y 增大，地图下标 `index = y * width + x`。

| 字段                                | 含义                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game.tick`                         | 当前输入 tick，从 0 开始                                                                                                                                        |
| `game.maxTicks`                     | 本局回合上限，固定 400                                                                                                                                          |
| `game.self`                         | 自己的 `id`、`slot`、`position: {x,y}`、`bombsMax`（同时可放炸弹数）、`fireRange`（火焰长度）、`activeBombs`（场上自己的炸弹数）、`score`，以及上述三个动作方法 |
| `game.opponents`                    | 其他存活玩家数组，按 slot 排列，字段同 self 但没有动作方法                                                                                                      |
| `game.eliminated`                   | 已出局玩家数组，按 slot 排列，每项含 `id`、`slot`、`tick`（出局时已完成的 tick 数）、`causes`                                                                   |
| `game.board.width`, `height`        | 固定 15 与 13                                                                                                                                                   |
| `game.board.cells`                  | 长度 195 的数组：0 空地、1 石柱、2 软墙、3 坍塌格；石柱位于 x 与 y 都为奇数的格子                                                                               |
| `game.bombs`                        | 场上炸弹数组，按放置顺序，每项含 `position`、`owner`（席位）、`fuse`、`range`                                                                                   |
| `game.powerups`                     | 地上的道具数组，每项含 `position` 与 `kind`（`"fire"` 或 `"bomb"`）                                                                                             |
| `game.collapse.startTick`           | 固定 300：第 300 个 tick 的结算坍塌第 0 圈                                                                                                                      |
| `game.collapse.interval`            | 固定 8：之后每 8 个 tick 坍塌下一圈                                                                                                                             |
| `game.collapse.nextRing`            | 下一个坍塌的圈编号 0–5（第 k 圈是到地图边缘最小距离等于 k 的格子），全部坍塌后为 `null`                                                                         |
| `game.collapse.ticksToNextCollapse` | 距下一次坍塌结算的 tick 数（1 表示下一次结算就坍塌），无坍塌时为 `null`                                                                                         |
| `game.events`                       | 上一 tick 结算产生的公开事件，tick 0 为空数组                                                                                                                   |

`fuse` 是剩余结算次数：炸弹放下的那个 tick 结算中就从 8 减到 7，之后每 tick 减 1，观察到 `fuse` 为 f 的炸弹会在当前 tick 起第 f 次结算（f = 1 即本 tick 结算）爆炸。火焰只存在于爆炸的那一个 tick，上一 tick 的火焰格在 `events` 的 `explosion.cells` 中。软墙里的隐藏道具不可见，内部 `rngState` 不属于玩家 API。

地图数组、坐标、事件及公开对象均冻结；修改它们会失败。保留旧 game 或角色引用不会更新为下一 tick 数据，调用旧引用的动作方法产生 `INVALID_ACTION`，不能向当前 tick 提交。易失缓存可以保存自己的计算结果，但每 tick 应从当前输入获取角色与视图。

## 公开事件

所有带 `playerId` 的事件以该玩家为主体。事件中的坐标为整数格子，`cells`、`destroyed` 使用地图下标并按升序排列。

| type          | 其他字段                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `move`        | `playerId`, `from`, `to`（移动无效时没有事件）                                                                        |
| `bomb-placed` | `playerId`, `position`                                                                                                |
| `explosion`   | `bombs`（本 tick 爆炸的全部炸弹，每项 `position` 与 `ownerId`）, `cells`（火焰覆盖的格子）, `destroyed`（炸开的软墙） |
| `pickup`      | `playerId`, `kind`, `position`                                                                                        |
| `collapse`    | `ring`, `cells`（本次坍塌的格子）                                                                                     |
| `death`       | `playerId`, `position`（出局时所在格）, `causes`, `killerIds`（火焰击中死者的炸弹主人，不含死者自己，按席位升序去重） |

事件按移动、放炸弹、爆炸、拾取、坍塌、出局的顺序排列，同类事件按席位或放置顺序；一个 tick 最多一个 `explosion` 和一个 `collapse` 事件。death.causes 为 `flame`、`collapse` 中的一个或两个，按此固定顺序列出。例如：

```js
const burning = game.events.find((e) => e.type === "explosion")?.cells ?? [];
```

事件对应上一世界结算，无论玩家自己的上一次执行是否成功，都不会缺失或积压。原始 JSON 观察包含 `tick`、`maxTicks`、`selfId`、`selfSlot`、`board`、`bombs`、`powerups`、`collapse`、存活玩家 `players`、`eliminated` 和 `events`，供本地调试查看；运行时通过 game 访问，不另行传入 observation 或 sdk。

## Memory、预算与恢复

每场每位玩家独占常驻 V8 Isolate/Context，源码和可信 API 模块在环境创建时加载一次。全局变量、闭包、Map、TypedArray 可在成功 tick 间缓存，受同一个堆上限限制；任一失败后缓存丢失，仅恢复上次成功的 JSON Memory。Memory 每 tick 重新注入，通过增删改属性更新；根引用不能替换，不要保存含动作方法的 game 对象。出局后不再调用入口。

首次及重建后的玩家模块编译/初始化、每 tick 入口、API 方法调用、日志格式化和命令/Memory 序列化计入玩家 CPU。可信 API 模块加载、当前视图构建与输入注入属于平台开销，墙钟看门狗继续生效。命令与 Memory 原子提交，具体预算以开发包 release.json 的 resolvedLimits 为准。

禁止异步函数、Promise、import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。本地 console 日志有界捕获，线上不收集。标准回放保存规范动作和错误，不保存源码、Memory 或可调用对象。
