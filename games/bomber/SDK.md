# 炸弹人玩家 API

玩家接口 v1。游戏发行、接口版本和资源限制分别见 `release.json` 的 `game.release`、`game.botProtocolVersion` 和 `game.resolvedLimits`。完整玩法与研究流程见 PROMPT.md。

## 最小入口

将所有代码写在一个 UTF-8 JavaScript 文件中，用 ESM 默认导出同步函数。每 tick 调用一次。下面演示入口、Memory 和动作方法，不是完整的对战策略：

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

入口返回 `undefined`，通过动作方法选择本 tick 的动作。可以直接结束函数或 `return;`，也可以 `return game.self.bomb()`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                        | 含义                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `game.self.move(direction)` | 登记上、右、下或左移动一格；方向为 `"up"`、`"right"`、`"down"`、`"left"` |
| `game.self.bomb()`          | 登记在脚下放一枚炸弹，本 tick 不移动                                     |
| `game.self.idle()`          | 登记停留                                                                 |

未调用动作方法时默认停留。同 tick 多次调用采用最后一次，三种动作相互覆盖。这些方法返回 `undefined`，不立即修改位置或地图；所有存活玩家执行结束后统一结算。方向参数正确时，目标格被石柱、软墙、坍塌格或炸弹阻挡，或位于地图外，就留在原地。脚下已有炸弹或数量已达上限时，`bomb()` 不放弹。这些情况不算接口错误，API 也不会自动避开火焰或坍塌。

例如先 `bomb()` 再 `move("right")`，最终只移动、不放弹；先 move 再 bomb 则只在原位置放弹。动作不是依次执行的命令队列。

方向参数错误会产生 `INVALID_ACTION`，即使用 catch 捕获后再调用合法动作，本 tick 仍执行失败。执行异常、超时或资源超限时，也会丢弃本 tick 的动作和 Memory 修改，改用 idle，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponents 仅供读取。API 不提供火焰预测、寻路、逃生路线或放弹时机；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的数据

`game.tick = t` 表示已完成 t 次结算，本次动作参与第 t + 1 次结算。`game.events` 是上次结算的事件，tick 0 时为空。比赛结束后不再调用入口，最终结果从 CLI 输出或回放查看。

`game` 是本 tick 的只读数据。坐标原点左上，向右 x 增大、向下 y 增大，地图下标 `index = y * width + x`。

| 字段                                | 含义                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game.tick`                         | 已完成的结算次数，从 0 开始                                                                                                                                     |
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

`fuse` 是自然爆炸前剩余的结算次数：炸弹放下的那个 tick 结算中就从 8 减到 7，之后每 tick 减 1。未被连锁提前引爆时，观察到 `fuse` 为 f 的炸弹在当前 tick 起第 f 次结算（f = 1 即本 tick 结算）爆炸。火焰只存在于爆炸的那一个 tick，上一 tick 的火焰格在 `events` 的 `explosion.cells` 中，不代表本 tick 仍着火。软墙里的隐藏道具不可见，内部 `rngState` 不属于玩家 API。

玩家 id 是身份标识，slot 是本局固定席位，出局后不重新编号。opponents 只含其他存活玩家，应按 id 或 slot 查找，不能把数组下标当作 slot。

game 中的数据均已冻结，不能修改。保存旧 game 或角色引用不会获得下一 tick 的数据；调用旧引用上的动作方法会产生 `INVALID_ACTION`。可以缓存自己的计算结果，但每 tick 都要读取当前传入的 game。

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

事件列表只包含上一 tick 的事件，不受玩家上次执行是否成功的影响。本地调试中的原始观察数据（JSON）包含 `tick`、`maxTicks`、`selfId`、`selfSlot`、`board`、`bombs`、`powerups`、`collapse`、存活玩家 `players`、`eliminated` 和 `events`，供本地调试查看；代码中通过 game 访问，不会另行收到 observation 或 sdk 参数。

## Memory 与资源限制

每场比赛为每位玩家创建独立的 V8 isolate。成功执行后保留环境，因此全局变量、闭包、Map 和 TypedArray 可以跨 tick 使用，但都占用堆内存。任一 tick 失败后环境会重建，这些缓存随之丢失，只恢复上次成功的 JSON Memory。

Memory 初始为空对象，每 tick 重新传入。通过增删改属性更新它，给局部变量重新赋值不会替换 Memory。只保存 JSON 对象、数组、字符串、有限数字、布尔值和 null，不能直接保存 Map、Set、TypedArray、函数或 game。每 tick 使用本次传入的 Memory。出局后不再调用入口。

玩家模块编译和初始化（首次调用及失败后重建时）、入口执行、API 调用、日志格式化、动作和 Memory 序列化都计入玩家 CPU。平台提供的 API 模块加载、game 数据构建和输入传递不计入玩家 CPU；平台另设实际耗时上限，防止调用长时间不结束。

只有本 tick 执行成功，动作和 Memory 修改才会一起生效。资源限制见 `release.json` 的 `game.resolvedLimits`。

Memory 中自增的计数只在执行成功时保留，不能代替当前 game.tick 计算比赛时限。

禁止异步函数、Promise、import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。console 日志仅在本地按限额记录，线上不收集。回放保存实际采用的动作和错误，不保存源码、Memory 或函数。
