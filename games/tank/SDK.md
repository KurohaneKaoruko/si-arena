# 坦克对决玩家 API

玩家接口 v1。游戏发行、接口版本和资源限制分别见 `release.json` 的 `game.release`、`game.botProtocolVersion` 和 `game.resolvedLimits`。完整玩法与研究流程见 PROMPT.md。

## 最小入口

将所有代码写在一个 UTF-8 JavaScript 文件中，用 ESM 默认导出同步函数。每 tick 调用一次。下面演示入口、Memory 和动作方法，不是完整的对战策略：

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

入口返回 `undefined`，通过动作方法选择本 tick 的动作。可以直接结束函数或 `return;`，也可以 `return game.self.fire()`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                        | 含义                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `game.self.move(direction)` | 登记转向并前进一格；方向为 `"up"`、`"right"`、`"down"`、`"left"`。目标格被挡住时只转向不移动 |
| `game.self.fire()`          | 登记沿当前朝向开火；`bulletInFlight` 为 true 时该动作在结算中无效，坦克停在原地且不转向      |
| `game.self.idle()`          | 登记停留                                                                                     |

未调用动作方法时默认停留。同 tick 多次调用采用最后一次，move、fire 与 idle 相互覆盖。这些方法返回 `undefined`，不立即修改位置、朝向或地图；双方执行结束后统一结算。方向参数正确时，撞墙、撞到对方或在已有炮弹时开火，都按游戏规则处理，不算接口错误。

例如先 `move("up")` 再 `fire()`，最终只有 fire，既不转向也不移动，仍沿输入视图里的 facing 开火。想转向后开火需要两个 tick。旧炮弹本 tick 稍后消失也不会让此前无效的 fire 补发。

方向参数错误会产生 `INVALID_ACTION`，即使用 catch 捕获后再调用合法动作，本 tick 仍执行失败。执行异常、超时或资源超限时，也会丢弃本 tick 的动作和 Memory 修改，改用 idle，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponent 仅供读取。API 不提供寻路、射线检测、威胁判断或躲避策略；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的数据

`game.tick = t` 表示已完成 t 次结算，本次动作参与第 t + 1 次结算。`game.events` 是上次结算的事件，tick 0 时为空。比赛结束后不再调用入口，最终结果从 CLI 输出或回放查看。

`game` 是本 tick 的只读数据。坐标原点左上，向右 x 增大、向下 y 增大。

| 字段                         | 含义                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `game.tick`                  | 已完成的结算次数，从 0 开始                                                                           |
| `game.maxTicks`              | 本局回合上限，固定 600                                                                                |
| `game.self`                  | 自己的 `id`、`slot`、`position: {x,y}`、`facing`、`hp`（1–3）、`bulletInFlight`，以及上述三个动作方法 |
| `game.opponent`              | 对方的 `id`、`slot`、`position`、`facing`、`hp`、`bulletInFlight`；对方存活时为对象，否则为 `null`    |
| `game.bullets`               | 在飞炮弹数组，按发射先后排列，每项含 `position`、`direction`、`ownerSlot`；每辆坦克最多一枚           |
| `game.board.width`, `height` | 固定 21、15                                                                                           |
| `game.board.cells`           | 长度 315 的地形数组，索引 `y * width + x`；0 空地、1 砖墙、2 钢墙                                     |
| `game.eliminated`            | 恒为空数组：任一方被击毁时比赛立即结束，不再产生观察                                                  |
| `game.events`                | 上一 tick 结算产生的公开事件，tick 0 为空数组                                                         |

炮弹只会停在空地上（进入砖墙、钢墙或对方坦克时立即消失；坦克可以走到炮弹所在格，炮弹下一子步照常飞走）。存活坦克总站在空地上，两辆坦克不会同格。内部 `rngState` 不属于玩家 API，且规则在初始化后不再使用随机数；策略随机数由玩家用可复现算法维护。

game 中的数据均已冻结，不能修改。保存旧 game 或角色引用不会获得下一 tick 的数据；调用旧引用上的动作方法会产生 `INVALID_ACTION`。可以缓存自己的计算结果，但每 tick 都要读取当前传入的 game。

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

事件列表只包含上一 tick 的事件，不受玩家上次执行是否成功的影响。本地调试中的原始观察数据（JSON）包含 `tick`、`maxTicks`、`selfId`、`selfSlot`、`board`、存活坦克 `tanks`（含 `bulletInFlight`）、`bullets`、`eliminated` 和 `events`，供本地调试查看；代码中通过 game 访问，不会另行收到 observation 或 sdk 参数。

## Memory 与资源限制

每场比赛为每位玩家创建独立的 V8 isolate。成功执行后保留环境，因此全局变量、闭包、Map 和 TypedArray 可以跨 tick 使用，但都占用堆内存。任一 tick 失败后环境会重建，这些缓存随之丢失，只恢复上次成功的 JSON Memory。

Memory 初始为空对象，每 tick 重新传入。通过增删改属性更新它，给局部变量重新赋值不会替换 Memory。只保存 JSON 对象、数组、字符串、有限数字、布尔值和 null，不能直接保存 Map、Set、TypedArray、函数或 game。每 tick 使用本次传入的 Memory。比赛结束后不再调用入口。

玩家模块编译和初始化（首次调用及失败后重建时）、入口执行、API 调用、日志格式化、动作和 Memory 序列化都计入玩家 CPU。平台提供的 API 模块加载、game 数据构建和输入传递不计入玩家 CPU；平台另设实际耗时上限，防止调用长时间不结束。

只有本 tick 执行成功，动作和 Memory 修改才会一起生效。资源限制见 `release.json` 的 `game.resolvedLimits`。

Memory 中自增的计数只在执行成功时保留，不能代替当前 game.tick 计算比赛时限。

禁止异步函数、Promise、import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。console 日志仅在本地按限额记录，线上不收集。回放保存实际采用的动作和错误，不保存源码、Memory 或函数。
