# Development

私有 workspace 工具包，供 server 和构建、部署脚本通过 exports 使用。不公开发布 npm，不参与统一升版，不进入玩家开发包运行依赖，也不参与比赛执行或回放。

- `readDevelopmentMaterials` 将游戏 PROMPT.md 的唯一研究标记替换为 RESEARCH.md；网页与 ZIP 使用相同完整文本。
- `publishDevkit` 先写完整的摘要命名 ZIP，再原子替换游戏 current.json 元数据。
- `readDevkit` 只读取指定游戏的当前包，不提供历史发行或修订选择。

资料变化重新构建并部署当前开发包即可，不改变游戏发行；规则、配置、限额或执行语义变化仍需更新 game.release。存储和下载协议见 [分发设计](../../docs/architecture/distribution-and-development.md)。
