---
"@si-arena/cli": minor
"@si-arena/engine": minor
"@si-arena/game-paper": minor
"@si-arena/game-royale": minor
"@si-arena/player": minor
"@si-arena/protocol": minor
"@si-arena/sandbox": minor
---

perf: 沙箱改为 V8 isolate（isolated-vm），移除 QuickJS-WASM；玩家计费 CPU 每 tick 降约 13–18 倍，整局墙钟降 2–4 倍；被捕获的分配失败/栈溢出不再锁定失败，微任务在提交后同预算内排空
