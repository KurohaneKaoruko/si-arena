# SI Arena：网格圈地参赛提示词

请编写一份可直接上传 SI Arena 网格圈地游戏的 UTF-8 JavaScript 文件。只输出最终完整代码，不输出 Markdown 围栏或解释。

你与另一名选手在 40×30 网格上对抗，一局固定打满 600 tick。出生时各有 3×3 领地；出生位置由种子决定。离开领地会留下尾迹，安全回到自己的领地时，将尾迹与闭合区域变为自己的领地。越界、两个目标落到同一格、两个移动者交换位置、移动进入自己结算前的尾迹，都让动脚的选手被重置；目标进入对手结算前的尾迹时，被重置的是尾迹的主人，踩上去的一方不受影响。被重置意味着尾迹全部清空、头部回到自己的初始出生点、领地全部保留，选手继续留在比赛里；这一 tick 它不移动、不闭合、不圈地，动作被消耗掉。重置落点与对手本 tick 的落点重合时，双方都按头部冲突重置；初始 3×3 已被对手围掉时，重置会在该格留下一格尾迹，下一 tick 仍可能被切断并再次重置。双方每 tick 观察同一个世界，然后同时行动。没有一方会被移出比赛；600 tick 打满后按最终领地面积排名，面积相同则并列第一。

闭合使用四邻接规则：把己方领地和尾迹作为边界，从地图边缘洪泛，未能到达的格子被圈入。旧尾迹被截断的判定先于回城闭合；同一 tick 双方占领集合重叠的地格保留原归属，原为中立则仍为中立。自己的尾迹会约束路线，追击与扩张必须评估安全回城的时间。

默认导出同步入口：

```js
export default function tick({ observation, Memory, sdk }) {
  return { type: "idle" };
}
```

每 tick 返回 `{ type: "idle" }` 或 `{ type: "move", direction: "up" | "right" | "down" | "left" }`。不要返回额外字段。地图左上为 (0,0)，右为 x+1，下为 y+1。

observation 是完整地图：tick、width、height、maxTicks、selfId、selfSlot、territory、trails、players、spawns、rngState。territory 和 trails 均为一维数组，索引为 y*width+x；-1 表示无主或无尾迹，0/1 表示所属席位。players 按席位排列，每项包含 id、slot、alive、position（{x,y}）；alive 恒为 true，含义是仍在比赛中，position 始终是当前头部所在格。spawns 是两个席位各自的初始出生点，即开局那块 3×3 领地的中心格，下标就是席位；重置把你送回自己的那一格。selfSlot 指出自己是哪一方。不能修改观察来改变世界。

SDK 随参数直接提供：directions（方向数组），homePath(observation)（最短安全回城方向序列，领地内为空，找不到为 null），threatDistance(observation)（对手到我方尾迹的距离，找不到为 null），safeMoves(observation)（不越界、不撞自身尾迹或当前对手头部的方向），expansion(observation)（从领地起步的矩形扩张序列）。辅助函数不预测对手未来动作。可自行实现更好的算法。

每 tick 重建 JS 环境，只有 JSON 对象 Memory 跨 tick 保留；通过修改 Memory 保存路线和策略状态。默认资源预算为代码 256KiB、每 tick CPU 20ms、QuickJS 堆 32MiB、栈 256KiB、Memory 64KiB、动作 1KiB。以此次下载包 release.json 中的 resolvedLimits 为准确预算。运行错误、非法动作或超限会丢弃该 tick 动作和候选 Memory，使用 idle，下一 tick 继续。无效策略会一直消耗回合。

不能使用 import、require、异步函数、Promise、网络、文件、Node API；不依赖 Date、现实时间或 Math.random。SDK 无需导入。可以使用受限 console 日志进行本地调试；线上不收集日志。目标是在守住已有领地的同时扩张、截击对手，以更强的长期策略获得更高胜率。
