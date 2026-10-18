# Monorepo 与游戏模块

## 目录

仓库项目标识为 `si-arena`，产品名称为 SI Arena，SI 代表 Super Intelligence。对外发布的 npm 包统一使用 `@si-arena` 组织：公共包按职责命名为 `@si-arena/protocol`、`@si-arena/engine`、`@si-arena/sandbox`、`@si-arena/player` 和 `@si-arena/cli`，游戏包采用 `@si-arena/game-<gameId>`，圈地为 `@si-arena/game-paper`。平台 web、server 和 worker 是私有 workspace 应用，不作为玩家开发包发布。

```text
apps/
  web/                   Vue 平台网站
  server/                Fastify API 与主动匹配
  worker/                比赛任务、回放保存、排位结算
packages/
  protocol/              游戏契约、JSON 类型、回放协议
  engine/                通用 tick 循环与执行编排
  sandbox/               玩家执行协议、父进程与子进程入口、WASM 绑定
  player/                Vue 回放播放器与通用控件
  cli/                   本地运行命令与调试服务
games/
  paper/
    src/
      manifest.ts        游戏信息、人数与限制配置
      rules/             纯规则逻辑
      sdk/               类型、辅助函数、提示词
      renderer/          Vue 面板、Canvas 绘制与动画
    bots/official.js     官方源码
    README.md            游戏使用说明
```

一个游戏目录可作为一个 workspace 包，通过不同 export 入口导出规则、SDK、renderer 和官方代码资源。无需给每个子目录再拆 npm 包。Node 运行器不能因导入规则入口而加载 Vue/DOM，网页也不能因导入 renderer 而打入子进程代码。

## 依赖方向

- `protocol` 不依赖其他业务包，不包含运行器和数据库。
- `sandbox` 依赖协议，不依赖账号、排位、游戏画面或数据库。
- `engine` 依赖协议，通过执行适配器调用沙箱，不依赖某个具体游戏。
- 游戏规则和 SDK 依赖协议及必要纯函数，不依赖平台业务。
- `player` 依赖协议和 Vue，不执行 bot，不导入服务端模块。
- `worker` 组装引擎、沙箱、游戏与持久化适配器。
- `cli` 对应 npm 包 `@si-arena/cli`，提供 `arena` 可执行入口，组装同样的引擎、沙箱和游戏，使用本地文件代替数据库；`init` 按游戏下载对应开发包。
- `web` 组装通用播放器与已注册游戏 renderer。

依赖环、从游戏规则导入业务数据库、从本地工具调用平台私有 API 均应作为结构错误处理。

## 游戏模块接口

游戏规则实现以下契约；JSON 和结果类型由 protocol 包导出：

```ts
interface GameRules<State, Observation, Action, Event> {
  init(input: InitInput): State
  observe(state: DeepReadonly<State>, playerId: string): Observation | null
  parseAction(raw: JsonValue): ActionParseResult<Action>
  defaultAction(state: DeepReadonly<State>, playerId: string): Action
  step(
    state: DeepReadonly<State>,
    actions: DeepReadonly<Record<string, Action>>
  ): {
    nextState: State
    events: Event[]
    result?: GameResult
  }
}
```

- `init` 接收固定玩家席位、游戏配置、种子，生成完整初始世界和随机数状态。
- `observe` 返回玩家可见数据；已淘汰或本 tick 不行动时可返回 `null`。
- `parseAction` 验证不可信输入，生成规范动作；格式失败交由运行器记录诊断。
- `defaultAction` 由游戏定义，不允许平台一律假设“向前移动”。
- `step` 一次接收本 tick 所有有效动作与默认动作，生成确定性的下一世界和事件。
- `result` 包括结束原因、结束 tick、各玩家得分与名次；相同名次表示平局。

`DeepReadonly` 由 protocol 导出，对 JSON 对象和数组递归只读。规则不得修改输入世界、动作及其任何嵌套数据，返回新状态或只共享不再修改的结构；开发验收对输入深冻结并检查。类型约束不等同于沙箱，发送玩家观察时仍需复制或序列化；渲染器也不能原地修改回放状态或缓存。

`step` 不获取现实时间、不使用外部网络、不调用玩家代码，不读取平台账号和排位。随机数由状态携带，数组遍历与冲突处理顺序明确规定。

## 模块配置与注册

manifest 包含稳定游戏 ID、展示信息、人数范围、规则发行标识、默认配置、tick 上限和资源限制。圈地固定 2 人、40×30 地图、600 tick，资源数值遵守 [资源限额](resource-limits.md)。游戏在 `limits` 中按字段覆盖平台默认资源预算，未指定的字段继承默认值；发布时生成完整的 `resolvedLimits`，网站、上传 API、沙箱与本地工具读取同一发行配置。游戏模块提供固定、可信的参数 schema。

manifest 的 `botProtocolVersion` 是从 1 开始的整数，标识玩家代码接口兼容性；圈地初始值为 1。观察、动作、SDK、Memory 协议或受支持 JS 语法发生不向后兼容的改变时递增。规则平衡、画面与保持旧调用有效的接口扩展不递增。发行标识与协议版本不能互相替代。

代码上传时记录当时的协议版本。新发行只接纳协议版本相同且源码体积合规的选手；不兼容时要求重新上传，兼容升级继续使用原代码，排位均保留。游戏发布先安装不可变规则与开发包，并准备符合新协议的官方 bot，再切换当前发行，保证回退对手可用。不同发行不能共享可变配置对象。

注册采用仓库内显式列表：构建时分别生成后端规则入口与前端 renderer 入口。新增游戏时添加游戏包并更新注册列表即可，不修改引擎循环、账号或排位实现。

首版不支持用户上传游戏模块，不提供远程热加载。游戏包的插件机制服务开发扩展，不给予玩家代码同等权限。

## 玩家 JS 入口

玩家代码采用单文件 ESM，同步导出默认函数：

```js
export default function tick({ observation, Memory, sdk }) {
  Memory.turns = (Memory.turns ?? 0) + 1
  return { type: 'move', direction: 'right' }
}
```

`observation` 是当 tick 数据，`Memory` 是本场上一成功 tick 的 JSON 数据，`sdk` 是游戏公开辅助接口。函数返回动作，包装器在同一资源预算中序列化动作和 Memory。

普通全局变量不跨 tick 保留。Memory 初始为 `{}`，每场独立，不能读取其他场次或其他用户的 Memory。上下文根对象只读，Memory 根引用不可替换；玩家通过增删改其属性更新记忆。普通局部变量重新赋值不会替换已注入的 Memory。

Memory 根必须是普通对象或无原型对象，其可枚举数据由有限数字、字符串、布尔值、null、稠密数组和普通对象组成。拒绝循环、undefined、BigInt、函数、Symbol、非有限数字、访问器和 Date/Map 等实例，不允许 JSON.stringify 的静默丢弃或转换替代协议校验。相同对象被多处引用可按 JSON 值展开，展开后的实际字节数受限。

入口同步返回动作；返回 Promise 为 `ENTRYPOINT_ERROR`。禁止静态 import、导出转发、动态 import 与顶层 await，模块加载器也拒绝导入。运行器不执行玩家排队的 Promise job，不提供定时器或网络。JS 语法先做 AST 约束检查，再用同版 QuickJS 的 compileOnly 模式校验，编译不执行顶层代码。[上游 compileOnly 接口](https://github.com/justjake/quickjs-emscripten/blob/main/packages/quickjs-emscripten-core/src/types.ts)

SDK 由类型定义和纯函数组成。运行时 SDK 在沙箱内部初始化，不把宿主对象、引擎引用或业务服务方法直接交给玩家。首版上传文件需要自包含，除默认入口外不开放任意模块导入；用户可在本地打包自己的辅助代码。

游戏状态和观察使用同一组严格 JSON 值类型，必须通过游戏 schema。规则引擎检查初始 tick 为 0、每次 step 只推进 1 tick、终局参与者完整且名次与分数合法。每个游戏必须在自己的 maxTicks 内返回 result，越界或违反状态协议视为系统错误，不由平台猜测胜负。

## 说明与 SDK 的一致性

游戏包内维护规则说明、字段类型、限制配置和官方 bot。参赛提示词组合这些内容产生，避免在网站数据库和源码中维护两套规则。

网站显示当前游戏发行信息。所有示例必须能在分发包内运行，官方 bot 与普通代码走同一个入口和资源限制。

## 渲染器接口

renderer 接收当前世界、前一世界、当 tick 事件及动画进度，负责画面和游戏专属面板。播放器提供时间轴、播放速度、玩家列表、错误与本地日志展示。

插值只改变屏幕表现，不反向修改世界。DOM、Canvas、浏览器时间不能进入规则判定。没有动画时也能正常批量运行游戏。
