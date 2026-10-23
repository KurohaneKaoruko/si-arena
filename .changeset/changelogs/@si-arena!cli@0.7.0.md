## 0.7.0

### Minor Changes

- 新增炸弹人游戏包 `@si-arena/game-bomber`（发行 bomber@0.1.0，玩家协议 v1）：固定 15×13 四向镜像地图，2–4 人放置定时炸弹、连锁火焰、炸墙拾取火力与炸弹道具，第 300 tick 起外圈每 8 tick 坍塌一圈；提供可信游戏定义、SDK、规则、renderer、官方示例 bot、提示词与接口说明，并在服务器、worker、网站、本地 CLI 注册表与开发包构建中注册四席竞技场。

- 新增贪吃蛇大作战游戏包 snake@0.1.0：2–4 条蛇同场的四席竞技场，吃食物变长并恢复体力，撞墙、撞身、饿死或头对头更短的一方出局，最后存活者获胜；提供规则、SDK、renderer、官方 bot、参赛提示词与开发包注册，本地 CLI 注册表同时登记该游戏。

- 新增独立 1v1 游戏「坦克对决」（tank@0.1.0，玩家接口 v1）：21×15 中心对称砖墙迷宫，炮弹每 tick 飞两格、打穿砖墙、迎面对消，三点生命先清零者负；附规则、SDK、renderer、官方 bot 与完整测试，并在服务端、worker、网站、本地 CLI 与开发包中注册。

### Patch Changes

- Updated dependencies:
  - @si-arena/engine@0.7.0
  - @si-arena/protocol@0.7.0
  - @si-arena/runner@0.7.0
