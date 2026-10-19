# 网格圈地 SDK

玩家提交 UTF-8 JavaScript ESM，默认导出一个同步函数，每个 tick 调用一次：

```js
export default function tick({ observation, Memory, sdk }) {
  Memory.turns = (Memory.turns ?? 0) + 1;
  const route = sdk.homePath(observation);
  return route?.length ? { type: "move", direction: route[0] } : { type: "idle" };
}
```

动作是 `{ type: "idle" }` 或 `{ type: "move", direction: "up" | "right" | "down" | "left" }`，不接受额外字段。坐标原点在左上角，向右 x 增大，向下 y 增大。每 tick 同时结算双方动作。

## 观察

`observation` 包含整个地图和双方公开信息，每 tick 都是独立快照：

| 字段                          | 含义                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `tick`                        | 当前输入 tick，从 0 开始                                         |
| `width`, `height`, `maxTicks` | 地图宽高和回合上限                                               |
| `selfId`, `selfSlot`          | 当前玩家身份与席位（0 或 1）                                     |
| `territory`                   | 按 `y * width + x` 索引的领地数组；-1 为无主，0/1 为所属席位     |
| `trails`                      | 同样索引的尾迹数组；-1 为无尾迹，0/1 为所属席位                  |
| `players`                     | 按席位排序的双方玩家：`id`, `slot`, `alive`, `position: { x, y } | null` |
| `rngState`                    | 当前规则 PRNG 状态，用于确定性重演                               |

## 辅助函数

| 函数                              | 返回值                                                            |
| --------------------------------- | ----------------------------------------------------------------- |
| `sdk.directions`                  | 固定方向数组 `up, right, down, left`                              |
| `sdk.homePath(observation)`       | 避开自身尾迹的最短回城方向序列；已在领地内为空数组，不可达为 null |
| `sdk.threatDistance(observation)` | 对手到己方尾迹的最短合法距离；没有可达目标时为 null               |
| `sdk.safeMoves(observation)`      | 不越界、不撞自身尾迹或对手当前头部的方向；不保证避开对手下一步    |
| `sdk.expansion(observation)`      | 从领地内起步的矩形扩张路线；无可用路线时为空数组                  |

SDK 是沙箱内的可信辅助代码，直接通过参数提供，不需要也不允许 import。开发包 `sdk/` 包含 SDK 的类型和运行源码，安装后的 `@si-arena/game-paper/sdk` 提供 `PaperTickInput` 等类型，JSDoc 的类型引用不会在执行时加载模块。

## 执行与错误

每 tick 重建 JS Runtime/Context，全局变量不能跨 tick 保存，只有显式 JSON 对象 `Memory` 延续。直接修改 `Memory`，返回值只包含动作。禁止异步函数、Promise、import、动态 import、require、网络、文件和宿主 API；不依赖现实时间或随机 API。所有随机策略应使用自己的可复现算法并把状态放入 Memory。

当运行异常、CPU/堆/栈、Memory 或动作超限时，丢弃本 tick 的动作和候选 Memory，使用 idle 并保留上次成功的 Memory，下一 tick 再执行。CPU 统计包含本 tick 的 SDK 和序列化；具体预算以游戏页面及开发包 release.json 的 `resolvedLimits` 为准。

本地 `console.log/info/warn/error/debug` 会在预算内捕获，并关联 tick 保存到回放；线上不收集玩家日志。回放支持查看有效动作、执行错误和资源消耗，不保存玩家源码或 Memory。
