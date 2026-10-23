# @si-arena/development

开发资料与开发包修订的 Node 工具，供 server 和构建脚本通过公开 exports 使用。不参与比赛执行或回放，不依赖游戏包、沙箱和数据库。

- 公共研究流程只编辑 [RESEARCH.md](RESEARCH.md)。各游戏 PROMPT.md 在 `<!-- SI_ARENA_RESEARCH -->` 处插入它，网页和 ZIP 共用 `readDevelopmentMaterials`。
- `publishDevkit` 以清单摘要为修订身份，先发布完整目录，再原子切换 current.json；`select: false` 只复制修订，供部署同步使用。
- `readDevkit` 解析当前选择器或固定修订，保留旧目录布局的读取能力。修订与路径身份不匹配时失败。

只改资料时运行 `pnpm build:devkits` 即可生成新修订，无需修改游戏 manifest、SDK 中的发行号、回放注册或测试夹具。规则、资源限额或执行语义改变仍需更新游戏发行。完整契约见[分发设计](../../docs/architecture/distribution-and-development.md)。
