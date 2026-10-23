# 贪吃蛇大作战玩家 API

当前发行为 `当前游戏发行（见 release.json）`、玩家接口 v1。玩家提交自包含的 UTF-8 JavaScript ESM，默认导出同步函数，每 tick 调用一次：

```js
/** @param {import("@si-arena/game-snake/sdk").SnakeTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  const { head, heading } = game.self;
  if (heading === "right" && head.x + 1 >= game.board.width) game.self.move("down");
  else game.self.move(heading);
}
```

入口返回 `undefined`，通过角色方法登记动作意图。可以直接结束函数或 `return;`，也可以 `return game.self.move("right")`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                        | 含义                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `game.self.move(direction)` | 登记上、右、下或左移动一格；方向为 `"up"`、`"right"`、`"down"`、`"left"` |

蛇不能停留。未调用动作方法时默认沿当前 `heading` 前进。同 tick 多次调用采用最后一次。方法返回 `undefined`，不立即修改身体或地图；所有存活玩家执行结束后统一结算。方向格式正确但越界、撞身或头对头吃亏，属于有效意图，由规则判定出局，不由 API 自动避险。

方向错误产生 `INVALID_ACTION`，即使玩家 catch 后又调用合法动作，该 tick 也失败。执行异常、超时、CPU/堆/栈、动作或 Memory 超限，同样整体丢弃所有命令和候选 Memory，使用默认前进，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponents 是公开数据。API 不提供寻路、安全方向、威胁距离或觅食策略；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的公开事实

`game` 每 tick 是全新的只读视图。坐标原点左上，向右 x 增大、向下 y 增大。

| 字段                         | 含义                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `game.tick`                  | 当前输入 tick，从 0 开始                                                                                                          |
| `game.maxTicks`              | 本局回合上限，固定 500                                                                                                            |
| `game.self`                  | 自己的 `id`、`slot`、`body`（从头到尾的 `{x,y}` 数组）、`head`（等于 `body[0]`）、`length`、`health`、`heading`，以及 `move` 方法 |
| `game.opponents`             | 其他存活的蛇数组，按 slot 排列，每项含 `id`、`slot`、`body`、`head`、`length`、`health`、`heading`                                |
| `game.eliminated`            | 已出局玩家数组，按 slot 排列，每项含 `id`、`slot`、`tick`（出局时已完成的 tick 数）、`causes`                                     |
| `game.board.width`, `height` | 地图边长，2–4 人分别为 15、17、19                                                                                                 |
| `game.food`                  | 地图上的食物格子数组，按 `y * width + x` 升序，永远不在任何蛇身上                                                                 |
| `game.events`                | 上一 tick 结算产生的公开事件，tick 0 为空数组                                                                                     |

`health` 在 1–100 之间，每 tick 减 1，吃到食物回到 100。`body` 中相邻两节要么相邻要么重合，重合只出现在尾部（开局三节重叠尚未展开的部分）；`heading` 是上一次移动的方向，开局为出生时的朝向。内部 `rngState` 不属于玩家 API，策略随机数由玩家用可复现算法维护。

身体数组、坐标、事件及公开对象均冻结；修改它们会失败。保留旧 game 或角色引用不会更新为下一 tick 数据，调用旧引用的动作方法产生 `INVALID_ACTION`，不能向当前 tick 提交。易失缓存可以保存自己的计算结果，但每 tick 应从当前输入获取角色与视图。

## 公开事件

所有事件的 `playerId` 都是事件主体。事件中的坐标为整数格子；`move.to` 与 `death.position` 在越界出局时是地图外的目标格，最多超出边界一格。

| type         | 其他字段                                           |
| ------------ | -------------------------------------------------- |
| `move`       | `playerId`, `from`, `to`                           |
| `eat`        | `playerId`, `position`                             |
| `death`      | `playerId`, `position`（出局时的头部格）, `causes` |
| `food-spawn` | `position`                                         |

事件按移动、进食、出局、食物生成的顺序排列，同类事件按席位顺序；本 tick 开始时存活的每条蛇都有一个 `move` 事件，包括本 tick 出局的蛇。death.causes 为一个或多个 `boundary`、`starvation`、`body-collision`、`head-collision`，按此固定顺序列出。例如：

```js
const fallen = game.events.filter((e) => e.type === "death").map((e) => e.playerId);
```

事件对应上一世界结算，无论玩家自己的上一次执行是否成功，都不会缺失或积压。原始 JSON 观察包含 `tick`、`maxTicks`、`selfId`、`selfSlot`、`board`、存活的 `snakes`、`eliminated`、`food` 和 `events`，供本地调试查看；运行时通过 game 访问，不另行传入 observation 或 sdk。

## Memory、预算与恢复

每场每位玩家独占常驻 V8 Isolate/Context，源码和可信 API 模块在环境创建时加载一次。全局变量、闭包、Map、TypedArray 可在成功 tick 间缓存，受同一个堆上限限制；任一失败后缓存丢失，仅恢复上次成功的 JSON Memory。Memory 每 tick 重新注入，通过增删改属性更新；根引用不能替换，不要保存含动作方法的 game 对象。出局后不再调用入口。

首次及重建后的玩家模块编译/初始化、每 tick 入口、API 方法调用、日志格式化和命令/Memory 序列化计入玩家 CPU。可信 API 模块加载、当前视图构建与输入注入属于平台开销，墙钟看门狗继续生效。命令与 Memory 原子提交，具体预算以开发包 release.json 的 resolvedLimits 为准。

禁止异步函数、Promise、import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。本地 console 日志有界捕获，线上不收集。标准回放保存规范动作和错误，不保存源码、Memory 或可调用对象。
