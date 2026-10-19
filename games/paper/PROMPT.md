# SI Arena：网格圈地参赛提示词

请编写一份可直接上传 SI Arena 网格圈地游戏的 UTF-8 JavaScript 文件。只输出最终完整代码，不输出 Markdown 围栏或解释。

你与另一名选手在 40×30 网格上对抗，最多 600 tick。出生时各有 3×3 领地；出生位置由种子决定。离开领地会留下尾迹，安全回到自己的领地时，将尾迹与闭合区域变为自己的领地。切断对手尾迹会淘汰对手，对方全部领地和尾迹会被清除。出界、撞到自身尾迹、双方头部冲突等会淘汰选手。双方每 tick 观察同一个世界，然后同时行动。单独存活立即获胜；双方都被淘汰则并列；满回合时按存活者领地面积排名。

闭合使用四邻接规则：把己方领地和尾迹作为边界，从地图边缘洪泛，未能到达的格子被圈入。旧尾迹被截断的判定先于回城闭合；同一 tick 双方占领集合重叠的地格保留原归属，原为中立则仍为中立。自己的尾迹会约束路线，追击与扩张必须评估安全回城的时间。

默认导出同步入口：

```js
export default function tick({ observation, Memory, sdk }) {
  return { type: "idle" };
}
```

每 tick 返回 `{ type: "idle" }` 或 `{ type: "move", direction: "up" | "right" | "down" | "left" }`。不要返回额外字段。地图左上为 (0,0)，右为 x+1，下为 y+1。

observation 是完整地图：tick、width、height、maxTicks、selfId、selfSlot、territory、trails、players、rngState。territory 和 trails 均为一维数组，索引为 y*width+x；-1 表示无主或无尾迹，0/1 表示所属席位。players 按席位排列，每项包含 id、slot、alive、position（{x,y}，淘汰后为 null）。selfSlot 指出自己是哪一方。不能修改观察来改变世界。

SDK 随参数直接提供：directions（方向数组），homePath(observation)（最短安全回城方向序列，领地内为空，找不到为 null），threatDistance(observation)（对手到我方尾迹的距离，找不到为 null），safeMoves(observation)（不越界、不撞自身尾迹或当前对手头部的方向），expansion(observation)（从领地起步的矩形扩张序列）。辅助函数不预测对手未来动作。可自行实现更好的算法。

每 tick 重建 JS 环境，只有 JSON 对象 Memory 跨 tick 保留；通过修改 Memory 保存路线和策略状态。默认资源预算为代码 256KiB、每 tick CPU 20ms、QuickJS 堆 32MiB、栈 256KiB、Memory 64KiB、动作 1KiB。以此次下载包 release.json 中的 resolvedLimits 为准确预算。运行错误、非法动作或超限会丢弃该 tick 动作和候选 Memory，使用 idle，下一 tick 继续。无效策略会一直消耗回合。

不能使用 import、require、异步函数、Promise、网络、文件、Node API；不依赖 Date、现实时间或 Math.random。SDK 无需导入。可以使用受限 console 日志进行本地调试；线上不收集日志。目标是在保证生存的同时扩张、截击对手，以更强的长期策略获得更高胜率。
