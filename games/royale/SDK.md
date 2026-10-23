# 圈地大逃杀玩家 API

玩家接口 v1。游戏发行、接口版本和资源限制分别见 `release.json` 的 `game.release`、`game.botProtocolVersion` 和 `game.resolvedLimits`。完整玩法与研究流程见 PROMPT.md。

## 最小入口

将所有代码写在一个 UTF-8 JavaScript 文件中，用 ESM 默认导出同步函数。每 tick 调用一次。下面演示入口、Memory 和动作方法，不是完整的对战策略：

```js
/** @param {import("@si-arena/game-royale/sdk").RoyaleTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  const { x } = game.self.position;
  if (x + 1 < game.zone.min.x + game.zone.size) game.self.move("right");
  else game.self.idle();
}
```

入口返回 `undefined`，通过动作方法选择本 tick 的动作。可以直接结束函数或 `return;`，也可以 `return game.self.move("right")`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                        | 含义                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `game.self.move(direction)` | 登记上、右、下或左移动一格；方向为 `"up"`、`"right"`、`"down"`、`"left"` |
| `game.self.idle()`          | 登记停留                                                                 |

未调用动作方法时默认停留。同 tick 多次调用采用最后一次，包括 move 与 idle 相互覆盖。这些方法返回 `undefined`，不立即修改位置或地图；所有存活玩家执行结束后统一结算。方向参数正确时，越界、撞头或撞到自己的尾迹由规则判定出局，不算接口错误。

方向参数错误会产生 `INVALID_ACTION`，即使用 catch 捕获后再调用合法动作，本 tick 仍执行失败。执行异常、超时或资源超限时，也会丢弃本 tick 的动作和 Memory 修改，改用 idle，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponents 仅供读取。API 不提供寻路、回城、威胁距离、安全方向或扩张策略；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的数据

`game.tick = t` 表示已完成 t 次结算，本次动作参与第 t + 1 次结算。`game.events` 是上次结算的事件，tick 0 时为空。比赛结束后不再调用入口，最终结果从 CLI 输出或回放查看。

`game` 是本 tick 的只读数据。坐标原点左上，向右 x 增大、向下 y 增大。

| 字段                          | 含义                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `game.tick`                   | 已完成的结算次数，从 0 开始                                                                      |
| `game.maxTicks`               | 本局回合上限，固定 800                                                                           |
| `game.self`                   | 自己的 `id`、`slot`、`position: {x,y}`、`spawn: {x,y}`、`area`（领地格数），以及上述两个动作方法 |
| `game.opponents`              | 其他存活玩家数组，按 slot 排列，每项含 `id`、`slot`、`position`、`spawn`、`area`                 |
| `game.eliminated`             | 已出局玩家数组，按 slot 排列，每项含 `id`、`slot`、`tick`（出局时已完成的 tick 数）、`causes`    |
| `game.board.width`, `height`  | 地图边长，2–5 人分别为 26、31、36、40                                                            |
| `game.board.territory`        | 长度 width×height 的领地数组，索引 `y * width + x`；-1 为无主，0–4 为所属席位                    |
| `game.board.trails`           | 同样编码的尾迹数组，-1 为无尾迹                                                                  |
| `game.zone.size`              | 安全区当前边长                                                                                   |
| `game.zone.target`            | 按当前存活人数计算的目标边长 `max(10, ceil(sqrt(320 × 存活人数)))`                               |
| `game.zone.min`               | 安全区左上角格子 `{x, y}`，右下角为 `min.x + size - 1`、`min.y + size - 1`                       |
| `game.zone.ticksToNextShrink` | `size > target` 时为距下一次收缩还需结算的 tick 数（1 表示下一次结算就收缩），否则为 `null`      |
| `game.events`                 | 上一 tick 结算产生的公开事件，tick 0 为空数组                                                    |

安全区外的格子总是无主地、没有尾迹；存活玩家的头部总在安全区内。需要收缩时，`ticksToNextShrink = 10 - tick % 10`，否则为 `null`；例如输入 tick 19 且 size > target 时，下一次（第 20 次）结算收缩。是否收缩按该次结算开始时的存活人数判断。内部 `rngState` 不属于玩家 API，策略随机数由玩家用可复现算法维护。

玩家 id 是身份标识，slot 是本局固定席位，出局后不重新编号。opponents 只含其他存活玩家，应按 id 或 slot 查找，不能把数组下标当作 slot。

game 中的数据均已冻结，不能修改。保存旧 game 或角色引用不会获得下一 tick 的数据；调用旧引用上的动作方法会产生 `INVALID_ACTION`。可以缓存自己的计算结果，但每 tick 都要读取当前传入的 game。

## 公开事件

所有事件的 `playerId` 都是事件主体，尾迹切断事件的主体是受害方。事件中的坐标为整数格子，capture.cells 使用地图下标并按升序排列。

| type          | 其他字段                                           |
| ------------- | -------------------------------------------------- |
| `move`        | `playerId`, `from`, `to`                           |
| `trail-cut`   | `playerId`, `attackerId`, `position`               |
| `capture`     | `playerId`, `cells`：本次新取得归属的格子          |
| `zone-shrink` | `size`：收缩后的边长                               |
| `death`       | `playerId`, `position`（出局时的头部格）, `causes` |

事件按切断、移动、圈地、缩圈、出局的顺序排列，同类事件按席位顺序。death.causes 为一个或多个 `boundary`、`head-collision`、`head-swap`、`self-trail`、`trail-cut`、`enclosed`、`zone`，按此固定顺序列出。例如：

```js
const fallen = game.events.filter((e) => e.type === "death").map((e) => e.playerId);
```

事件列表只包含上一 tick 的事件，不受玩家上次执行是否成功的影响。本地调试中的原始观察数据（JSON）包含 `tick`、`maxTicks`、`selfId`、`selfSlot`、`board`、`zone`、存活玩家 `players`、`eliminated` 和 `events`，供本地调试查看；代码中通过 game 访问，不会另行收到 observation 或 sdk 参数。

## Memory 与资源限制

每场比赛为每位玩家创建独立的 V8 isolate。成功执行后保留环境，因此全局变量、闭包、Map 和 TypedArray 可以跨 tick 使用，但都占用堆内存。任一 tick 失败后环境会重建，这些缓存随之丢失，只恢复上次成功的 JSON Memory。

Memory 初始为空对象，每 tick 重新传入。通过增删改属性更新它，给局部变量重新赋值不会替换 Memory。只保存 JSON 对象、数组、字符串、有限数字、布尔值和 null，不能直接保存 Map、Set、TypedArray、函数或 game。每 tick 使用本次传入的 Memory。出局后不再调用入口。

玩家模块编译和初始化（首次调用及失败后重建时）、入口执行、API 调用、日志格式化、动作和 Memory 序列化都计入玩家 CPU。平台提供的 API 模块加载、game 数据构建和输入传递不计入玩家 CPU；平台另设实际耗时上限，防止调用长时间不结束。

只有本 tick 执行成功，动作和 Memory 修改才会一起生效。资源限制见 `release.json` 的 `game.resolvedLimits`。

Memory 中自增的计数只在执行成功时保留，不能代替当前 game.tick 计算比赛时限。

禁止异步函数、Promise、import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。console 日志仅在本地按限额记录，线上不收集。回放保存实际采用的动作和错误，不保存源码、Memory 或函数。
