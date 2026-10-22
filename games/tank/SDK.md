# 坦克对决玩家 API

当前发行为 `tank@0.1.0`、玩家接口 v1。玩家提交自包含的 UTF-8 JavaScript ESM，默认导出同步函数，每 tick 调用一次：

```js
/** @param {import("@si-arena/game-tank/sdk").TankTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  const { self, opponent } = game;
  if (opponent && opponent.position.y === self.position.y && !self.bulletInFlight) {
    const direction = opponent.position.x > self.position.x ? "right" : "left";
    if (self.facing === direction) game.self.fire();
    else game.self.move(direction);
  } else game.self.move("up");
}
```

入口返回 `undefined`，通过角色方法登记动作意图。可以直接结束函数或 `return;`，也可以 `return game.self.fire()`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                        | 含义                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `game.self.move(direction)` | 登记转向并前进一格；方向为 `"up"`、`"right"`、`"down"`、`"left"`。目标格被挡住时只转向不移动 |
| `game.self.fire()`          | 登记沿当前朝向开火；`bulletInFlight` 为 true 时该动作在结算中无效，坦克停在原地且不转向      |
| `game.self.idle()`          | 登记停留                                                                                     |

未调用动作方法时默认停留。同 tick 多次调用采用最后一次，move、fire 与 idle 相互覆盖。这些方法返回 `undefined`，不立即修改位置、朝向或地图；双方执行结束后统一结算。方向格式正确但撞墙、撞到对方或在炮弹飞行时开火，都属于有效意图，由规则判定效果，不由 API 自动修正。

方向错误产生 `INVALID_ACTION`，即使玩家 catch 后又调用合法动作，该 tick 也失败。执行异常、超时、CPU/堆/栈、动作或 Memory 超限，同样整体丢弃所有命令和候选 Memory，使用 idle，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponent 是公开数据。API 不提供寻路、射线检测、威胁判断或躲避策略；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的公开事实

`game` 每 tick 是全新的只读视图。坐标原点左上，向右 x 增大、向下 y 增大。

| 字段                         | 含义                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `game.tick`                  | 当前输入 tick，从 0 开始                                                                              |
| `game.maxTicks`              | 本局回合上限，固定 600                                                                                |
| `game.self`                  | 自己的 `id`、`slot`、`position: {x,y}`、`facing`、`hp`（1–3）、`bulletInFlight`，以及上述三个动作方法 |
| `game.opponent`              | 对方的 `id`、`slot`、`position`、`facing`、`hp`、`bulletInFlight`；对方存活时为对象，否则为 `null`    |
| `game.bullets`               | 在飞炮弹数组，按发射先后排列，每项含 `position`、`direction`、`ownerSlot`；每辆坦克最多一枚           |
| `game.board.width`, `height` | 固定 21、15                                                                                           |
| `game.board.cells`           | 长度 315 的地形数组，索引 `y * width + x`；0 空地、1 砖墙、2 钢墙                                     |
| `game.eliminated`            | 恒为空数组：任一方被击毁时比赛立即结束，不再产生观察                                                  |
| `game.events`                | 上一 tick 结算产生的公开事件，tick 0 为空数组                                                         |

炮弹只会停在空地上（进入砖墙、钢墙或对方坦克时立即消失；坦克可以走到炮弹所在格，炮弹下一子步照常飞走）。存活坦克总站在空地上，两辆坦克不会同格。内部 `rngState` 不属于玩家 API，且规则在初始化后不再使用随机数；策略随机数由玩家用可复现算法维护。

地图数组、坐标、事件及公开对象均冻结；修改它们会失败。保留旧 game 或角色引用不会更新为下一 tick 数据，调用旧引用的动作方法产生 `INVALID_ACTION`，不能向当前 tick 提交。易失缓存可以保存自己的计算结果，但每 tick 应从当前输入获取角色与视图。

## 公开事件

事件按转向移动、开火、命中、砖墙摧毁、炮弹对消、死亡的顺序排列；移动、开火、砖墙摧毁和死亡按席位，命中按发生顺序（先第一子步再第二子步，同一子步按发射先后）。坐标为整数格子，`brick-destroyed.cells` 使用地图下标并按升序排列。

| type                | 其他字段                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `move`              | `playerId`, `from`, `to`, `facing`；`from` 与 `to` 相同表示只转向或被阻挡                     |
| `fire`              | `playerId`, `position`（发射格）, `direction`                                                 |
| `hit`               | `playerId`（被击中者）, `attackerId`, `position`, `hp`（命中后剩余生命）                      |
| `brick-destroyed`   | `attackerId`, `cells`：本 tick 被该方炮弹摧毁的砖墙下标，每方每 tick 至多一条，无摧毁则不出现 |
| `bullets-cancelled` | `position`：两枚炮弹相遇的格子；互换格子时为先发射那枚炮弹进入的格子                          |
| `death`             | `playerId`, `position`（被击毁时所在格）                                                      |

例如：

```js
const hitsOnMe = game.events.filter((e) => e.type === "hit" && e.playerId === game.self.id);
```

事件对应上一世界结算，无论玩家自己的上一次执行是否成功，都不会缺失或积压。原始 JSON 观察包含 `tick`、`maxTicks`、`selfId`、`selfSlot`、`board`、存活坦克 `tanks`（含 `bulletInFlight`）、`bullets`、`eliminated` 和 `events`，供本地调试查看；运行时通过 game 访问，不另行传入 observation 或 sdk。

## Memory、预算与恢复

每场每位玩家独占常驻 V8 Isolate/Context，源码和可信 API 模块在环境创建时加载一次。全局变量、闭包、Map、TypedArray 可在成功 tick 间缓存，受同一个堆上限限制；任一失败后缓存丢失，仅恢复上次成功的 JSON Memory。Memory 每 tick 重新注入，通过增删改属性更新；根引用不能替换，不要保存含动作方法的 game 对象。比赛结束后不再调用入口。

首次及重建后的玩家模块编译/初始化、每 tick 入口、API 方法调用、日志格式化和命令/Memory 序列化计入玩家 CPU。可信 API 模块加载、当前视图构建与输入注入属于平台开销，墙钟看门狗继续生效。命令与 Memory 原子提交，具体预算以开发包 release.json 的 resolvedLimits 为准。

禁止异步函数、Promise、import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。本地 console 日志有界捕获，线上不收集。标准回放保存规范动作和错误，不保存源码、Memory 或可调用对象。
