# SI Arena 回放播放器

通用回放会话、Vue 播放调度与浏览器文件读取。包不执行 bot，不导入 Node 文件系统、沙箱或具体游戏。地图绘制由可信游戏 renderer 提供。

## 使用网页播放器

在仓库根目录运行 `pnpm dev:web`，访问 [回放页](http://127.0.0.1:5173/replays)，选择 `pnpm arena run` 生成的 `.json.gz` 文件。完整校验通过后才能播放。文件在浏览器内解压和重演，不上传，不需要 API 或数据库在线。

播放器支持暂停、0.5/1/2/4/8 倍速、时间轴、前后单步、数值跳转、前后错误跳转。默认暂停；切换到后台标签页时暂停，卸载时取消动画和文件读取。聚焦地图后，空格切换播放，左右方向键逐步查看，Home/End 跳转首尾。

侧栏展示玩家、当前得分、存活状态、规范动作、输入 tick 的错误、记录的 CPU 用量及重建的执行前观察。日志可按玩家与级别筛选，日志截断有明确提示。Memory 不存在于回放，保存的回放不显示 Memory 面板。界面不把日志或错误作为 HTML 渲染。

## tick 与重演

完成 0 tick 展示初始世界 S0，无执行记录。完成 N tick 展示 SN，诊断来自输入 tick N−1，观察来自 SN−1。错误跳转到对应执行后的世界，例如执行 tick 0 出错时跳到 S1。

`createReplaySession(raw, game, options)` 接收可信 `GameDefinition`，先调用引擎检查整个回放：格式、发行、配置、限额、动作、终局和最终 SHA-256。失败不会产生可播放会话。输入数据独立复制，保存的回放和返回世界不可变；跳转仅执行规则，不再次执行玩家代码，也不根据错误重写动作。

会话的 `frame(completedTicks)` 返回当前世界、前一世界、重建事件和执行记录；`observation(completedTicks, playerId)` 提供该次执行前的观察。`errorTicks` 使用输入 tick 编号。

S0 与跳转重演的每步结果都通过引擎公开的 `parseGameState` 解析、复制、冻结并检查 tick。解析上下文使用回放中冻结的配置和按席位排序的参赛者，与完整回放校验一致；游戏解析器的字段补全或状态归一化同样应用于播放和检查点重演。

每 50 tick 缓存一次世界。缓存始终保留 S0，另最多保留 15 个检查点，按最近使用顺序淘汰；序列化字节预算默认 32MiB。缓存之外仅持有当前帧与前一世界，不保留所有逐 tick 世界。跳转从最近的早期检查点或当前世界向前运行；缓存仅在内存中存在，不写入回放。

`SessionOptions` 可传入取消信号、检查进度回调、让出事件循环的异步函数，以及本地缓存字节预算。网页每检查 50 tick 让出事件循环，允许更新加载提示与取消；只有完整终局校验成功才展示诊断。

## Vue 调度

`usePlayback(source, clock, options)` 提供 tick、播放状态、速度、动画进度、跳转与错误导航。`clock` 注入 request/cancel 函数，网页使用 requestAnimationFrame。基准速度为每秒 10 tick；调度仅改变显示位置，不改变规则。慢帧最多累计 250ms 的推进量，避免恢复标签页时跳过整场。

`progress` 是当前 tick 动画窗口的完成度（0–1，1 为稳态），随播放速度缩放。只有播放中的自然前进跨界会开启新动画窗口；跳转、单步、错误跳转、更换回放与播到终点都直接进入稳态，不重放被跳过的瞬态动画。暂停冻结当前进度，恢复后继续同一窗口。`options.onFrame` 在播放中的每个时钟回调末尾触发一次，宿主用它连续重绘画布。

## 浏览器入口

`@si-arena/player/browser` 导出：

- `readBrowserReplay(file, signal)`：gzip/严格 UTF-8/JSON 读取，压缩文件最多 32MiB，解压 JSON 最多 64MiB；取消或失败关闭读取流。
- `defineReplayGame({ game, aspectRatio, scoreUnit, draw, summarize })`：将一个可信规则发行与画面、玩家摘要结合，保留泛型到闭包中。draw 收到完整回放帧（当前世界、前一世界、当 tick 事件与执行记录）和 `ReplayDrawOptions { progress, reducedMotion }`；宿主负责检测系统的减少动态效果偏好并传入 `reducedMotion`，renderer 据此把瞬态动画退化为静态标记。
- `loadRegisteredReplay(raw, registrations, options)`：按游戏 ID 与完整发行标识查找唯一可信注册，再调用完整校验；不读取回放指定的模块位置，不下载或执行代码。

浏览器入口需要支持 DecompressionStream 的现代浏览器与安全上下文中的 Web Crypto。Canvas 绘制函数只在已有 Canvas 上执行；服务端导入元数据或纯规则不会触及 DOM。

通用入口 `@si-arena/player` 导出会话和 Vue composable，可在无 DOM 环境使用注入时钟验证。网页的通用控件位于 `apps/web/src/components/ReplayViewer.vue`，可信游戏注册位于 `apps/web/src/games/replays.ts`。圈地包的 renderer 绘制领地、尾迹与带 P1/P2 编号的棋子，按事件绘制移动插值、圈地、切断、淘汰的瞬态动画并为当 tick 出错的玩家显示头部徽标，不依赖平台账号或数据库。

## 验证

```sh
pnpm test --project player --project player-browser --project web
pnpm check
pnpm test:artifacts
```

调度、重演和 gzip 文件读取使用 Node 测试，Vue 交互使用 web 的 jsdom 项目。播放器测试的 DOM 类型仅配置在自身 `tsconfig.test.json`，不改变纯规则的 Node 测试环境。打包验证从仓库外导入公开入口并检查真实回放跳转。

独立开发包包含相同的播放器静态资源。包内 `pnpm arena replay <file>` 启动只监听 127.0.0.1 的静态服务，提供固定资源和指定回放，输出 URL 后在浏览器打开；不依赖平台 API，也不重新执行 bot。`--verify` 继续用于终端校验；`pnpm arena dev --bot ./bot.js` 启动实时调试页，复用同一播放器组件，并通过页面注入的 Memory 数据源额外展示提交前后对比。
