# 数据模型与 API

## 数据模型

| 实体 | 主要字段与约束 |
| --- | --- |
| `users` | 用户 ID、唯一规范用户名（即展示名）、密码摘要与参数、官方标记；官方标记不可由普通用户修改 |
| `sessions` | 会话 token 的 SHA-256 摘要、用户 ID、创建时间与到期时间 |
| `auth_rate_limits` | 认证限流作用域、主体摘要、窗口开始时间与计数，窗口内原子递增 |
| `game_entries` | `(game_id, user_id)` 唯一；最新源码、源码字节数、代码协议版本、更新时间、排位分、比赛数、胜平负计数 |
| `matches` | 比赛 ID、游戏及冻结发行、发起者、幂等标识、状态、resolvedLimits、实际配置、种子、租约、执行标识、结果、回放引用、时间戳、失败原因 |
| `match_participants` | `(match_id, user_id)` 唯一；固定席位、创建时用户名与官方标记快照、局内成绩、结算前后排位 |

首版游戏目录、规则说明和发行清单来自可信游戏包，不必额外建一套数据库 CMS。任务状态放在 `matches`，无需再建一张重复的任务业务表。

`game_entries` 是按游戏独立的参赛身份：同一用户不同游戏的代码与分数不共享。源码仅在这里保存当前值，不建立 `code_versions` 或历史编译产物表。

Memory 是比赛内临时执行数据，不写回 `game_entries`。比赛结束后释放。回放保存到文件存储，数据库保存引用、格式/发行信息、文件大小和校验摘要，不将每 tick 动作拆成海量关系行。

## 上传

1. 验证身份和游戏 ID。
2. 按该游戏当前发行的 `resolvedLimits.codeBytes` 在读取请求时限制字节数，验证 UTF-8、自包含单文件格式与语法。
3. 静态检查默认导出等可检查部分；不能靠执行顶层代码完成检查。
4. 事务内确认当前游戏发行与检查时一致，插入或覆盖最新源码、实际字节数和该发行的 `botProtocolVersion`，保留排位与历史比赛统计。发行已切换时返回 409，要求刷新游戏信息后重新提交。
5. 返回成功，不创建比赛、不调用游戏试跑。

静态 AST 检查禁止导入、导出转发和顶层 await，同版 QuickJS 仅做 compileOnly 语法校验，不执行用户代码。它不能证明程序必定正常返回函数、动作合法或执行不超限；剩余错误由每 tick 执行协议处理。上传被拒绝时保留原代码。

并发上传按最后成功提交覆盖。worker 开始比赛时用一个一致性快照读取双方最新源码、字节数和代码协议版本，使用该比赛创建时已经冻结的游戏发行、配置及 resolvedLimits。之后上传不替换本场代码。短事务只负责读取和检查，不能在整场执行时锁住源码行。

匹配前排除代码协议版本与当前发行不一致或源码超过当前发行限制的选手。代码、SDK 兼容升级不要求重新上传；不兼容升级通过 `botProtocolVersion` 递增识别。旧选手保留排位与历史比赛，页面显示需要重新上传，在完成上传前不能主动匹配或成为对手。

已排队比赛不会自动改为新发行。开局时再次检查最新代码能否用于其冻结发行；代码被新协议或更大源码替换时，本场进入 `failed`，原因 `ENTRY_CHANGED_BEFORE_START`，不执行、不计分，提示重新主动匹配。不能找回旧源码，也不能将新代码放到旧协议里强行执行。

## 主动匹配与领取

匹配 API 在事务中处理幂等请求标识，验证代码的协议与大小、限制未完成主动请求、选择合格对手、冻结游戏发行与完整限额，写入参与者及 `pending` 比赛。不同游戏可以同时存在各自的主动请求。

幂等标识必须与发起用户和请求内容绑定。相同请求重试返回已有比赛，不因请求超时再创建一场；相同标识配不同参数应拒绝。

除幂等键外，数据库建立 `(initiator_id, game_id)` 的部分唯一索引，条件为 `status IN ('pending', 'running')`，阻止不同幂等键并发绕过“一场未完成主动请求”的限制。先查询幂等命中；新请求违反该约束时返回 409 和已有比赛 ID，不创建第二场。不能只靠事务内先查询再插入。[PostgreSQL 部分唯一索引](https://www.postgresql.org/docs/18/indexes-partial.html)

worker 用短事务锁定本机支持且有资源容量的任务，设置 `running`、租约到期时间和唯一执行标识，随后释放数据库锁再执行。领取使用 `SKIP LOCKED`，不得有两个 worker 同时拥有有效执行权。租约为 30 秒，每 5 秒续租；续租失败时停止分派新 tick，禁止提交结果。worker 只领取本机注册表内 `gameId` 与 `release` 都精确匹配的冻结发行，未安装的发行保持等待，不用当前规则替代执行。

租约过期处理需要比较执行标识，旧 worker 不能在失去租约后覆盖终态。已开始且失去主运行器状态的比赛标为 `failed`，不重新读最新源码冒充恢复。

该扫描只处理已经存在的比赛，不扫描用户生成新比赛。

比赛级 `failureReason` 为受控枚举：`ENTRY_CHANGED_BEFORE_START`（开局复查时代码与冻结发行不兼容）、`WORKER_LOST`（执行租约过期、主 worker 失联）、`EXECUTION_FAILED`（可信侧系统失败，如规则崩溃、平台输入超预算或回放无法保存）。玩家代码的 tick 级错误不属于比赛失败，正常计分。

## 幂等结算

1. worker 生成并可靠保存最终回放与结果，以比赛 ID 形成稳定引用。
2. 开启数据库事务，锁定比赛行，确认仍为 running、执行标识一致、租约有效且尚未结算；否则拒绝提交。
3. 按稳定顺序锁定参与者的 `game_entries` 排位行。
4. 用双方当前排位和本场结果计算变化，更新排位、统计以及参与者结算摘要。
5. 同一事务中将比赛标记 `completed`，写入回放引用与最终结果。
6. 提交后释放任务和临时代码。

若已经完成，重试直接返回原结果，不能再次更新分数。若事务失败且仍持有有效租约，整次排位更新回滚后可重试。文件保存失败时不能提前结算。最终文件先保存为包含比赛 ID 和执行标识的不可覆盖候选路径，仅以数据库 completed 行引用的文件作为公开回放；失去执行权的旧 worker 不能覆盖另一个候选或公开文件。失败或无引用候选由清理任务删除，清理任务不创建新比赛。

回放文件存储在 `REPLAYS_DIR`（默认 `data/replays`）下：终稿名为 `<matchId>.json.gz`，候选写入 `candidates/<matchId>-<executionId>.json.gz`。结算事务在确认执行权后将候选硬链接为终稿（已存在即回滚，绝不覆盖），数据库行的 `replay_file` 记录终稿文件名、格式版本、压缩后字节数与 SHA-256。清理任务由 worker 周期执行：删除超过 1 小时的候选与超过 24 小时且未被任何 completed 比赛引用的终稿。

禁止在客户端计算排位，禁止客户端提交可信胜负。游戏包只提供比赛结果，平台评分实现决定排位变化。官方 bot 也使用这条路径。

## 注册、登录与会话

用户通过用户名和密码注册登录，不接入 GitHub、邮箱验证码或其他外部身份服务。用户名为 2–24 个 Unicode 码点（仅校验长度，不允许空字节），按小写规范化后作为唯一身份与展示名；`official` 为保留用户名，官方账号由部署初始化创建，不接受普通登录。密码为 6–24 个 Unicode 码点（仅校验长度，不允许空字节），按原输入处理，不 trim 或静默截断。

采用 Node.js 异步 `crypto.scrypt`，参数为 `N=131072`、`r=8`、`p=1`、`maxmem=256MiB`，每个密码使用独立 16 字节随机盐，派生 64 字节摘要；参数与摘要以 `scrypt$N=…$r=…$p=…$<salt>$<digest>` 自描述字符串一起保存。比较解出摘要后使用定长的 timing-safe 比较，数据库不保存明文密码。参数采用 [OWASP 的 scrypt 配置](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，接口使用 [Node.js crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)。API 每进程最多并行 2 个密码哈希任务，超出的认证请求返回 429，不进入无界等待队列。

登录成功创建 32 字节密码学随机会话 token，注册同时创建会话。token 以 `Authorization: Bearer <token>` 请求头传递并由客户端自行保存，数据库仅存 token 的 SHA-256 摘要。会话绝对有效期为 7 天，不自动滑动续期。登出删除当前会话行，立即失效；修改密码要求旧密码并撤销该用户全部旧会话。认证响应和自己的源码响应设置 `Cache-Control: no-store`，不启用 CORS，不开放跨源凭证访问。

密码验证在事务外异步执行，创建会话前在短事务内锁定用户行并确认密码摘要仍与验证时一致，避免并发改密后旧凭证重新生成会话。不存在的用户与无密码的官方账号也执行一次同参数的固定伪摘要校验，避免通过明显的哈希耗时差异探测账号。登录失败统一返回凭证错误，不区分用户不存在与密码错误。注册和登录请求 JSON 上限 4KiB。按 IP 对登录限流为每 5 分钟 10 次、注册为每小时 3 次，返回 429 时附带 Retry-After。计数保存在 PostgreSQL，API 多进程共享；相应 `auth_rate_limits` 记录使用作用域（`login`、`register`）、主体摘要（IP 的 SHA-256）、时间窗口与计数作为键值，定期清理过期窗口。

首版提供注册、登录、登出和知道旧密码时的密码修改，不提供邮箱找回密码功能。

### 认证 API 契约

成功响应：`POST /auth/register` 返回 201、`POST /auth/login` 返回 200，响应体为 `{ "user": { "id", "username", "official" }, "token" }`；`GET /auth/me` 返回 200，响应体为 `{ "user": … }`；`POST /auth/logout` 与 `PUT /auth/password` 返回 204。请求体：注册与登录为 `{ "username", "password" }`，密码修改为 `{ "oldPassword", "newPassword" }`；`username` 指输入原样，服务端规范化后返回 `user.username`。

错误体统一为 `{ "code", "message" }`：`VALIDATION_ERROR`（400，凭证长度不合法或请求格式不正确）、`INVALID_CREDENTIALS`（401，登录失败或旧密码错误）、`UNAUTHORIZED`（401，无有效会话）、`USERNAME_TAKEN`（409，规范化用户名冲突）、`RATE_LIMITED`（429，限流或哈希饱和，附 Retry-After）、`BODY_TOO_LARGE`（413，请求体超过 4KiB）。

官方账号在 server 启动时幂等初始化：upsert `official` 用户（无密码、带官方标记），并为每个已注册游戏读取其官方 bot 源码，写入或更新 `game_entries` 的源码、字节数与协议版本；排位分与比赛统计不受初始化影响。官方 bot 源码超过当前发行 `codeBytes` 限制时启动失败并报告明确错误。

### 游戏参赛与匹配 API 契约

`GET /games/:gameId/me`（认证）返回 `{ "entry": { rating, matchesPlayed, wins, draws, losses }, "code": { source, sourceBytes, botProtocolVersion, updatedAt } | null, canMatch, cannotMatchReason }`；`cannotMatchReason` 取 `NO_CODE`、`PROTOCOL_MISMATCH`、`CODE_TOO_LARGE`，可为 null。

`PUT /games/:gameId/me/code`（认证）请求体为 `text/plain` 的源码文本，请求字节上限为当前发行 `resolvedLimits.codeBytes`。请求体必须是合法 UTF-8 文本，解码失败或空请求体返回 400 `VALIDATION_ERROR`。服务端运行沙箱静态校验（受限 AST 检查 + 同版 QuickJS compileOnly），同时校验数每进程最多 2，饱和返回 429。成功覆盖最新源码并返回 `{ sourceBytes, botProtocolVersion, updatedAt }`，排位分与比赛统计保持不变；校验失败返回 400 `CODE_INVALID`，原代码不变；超限返回 413。

`POST /games/:gameId/matches`（认证）必须携带 1–100 字符的 `Idempotency-Key` 请求头。相同用户与键的重复请求返回 200 和已有比赛；同键不同游戏返回 409 `IDEMPOTENCY_MISMATCH`。建局在单事务中选择对手、冻结游戏发行/配置/resolvedLimits/botProtocolVersion 与随机 uint32 种子，写入 `pending` 比赛与两名参与者（发起者 slot 0，用户名与官方标记快照）。对手选择：同游戏非本人、非官方、排位分差不超过 250 的选手中取绝对分差最小者（并列随机），存在其他候选时排除最近一场已完成比赛的对手；无普通候选时直接选官方账号（不受分差限制）。已有未完成主动比赛时返回 409 `MATCH_ALREADY_PENDING` 并携带 `matchId`；未上传代码、协议不兼容或超体积分别返回 409 `NO_CODE`、`PROTOCOL_MISMATCH`、`CODE_TOO_LARGE`。成功创建返回 201，响应为比赛详情。

`GET /games/:gameId/leaderboard`（公开）分页参数 `page`（默认 1，钳制到 1–1,000,000）与 `limit`（默认 50，钳制到 1–100）；缺省或空参数取默认值，非法数值视为默认，越界数值被钳制，不会因极端参数报错。返回 `{ total, page, limit, players: [{ rank, userId, username, official, rating, matchesPlayed, wins, draws, losses }] }`，名次用窗口函数按内部精确分计算，精确分相同并列，展示顺序按稳定用户 ID。

`GET /games/:gameId/me/matches`（认证）按创建时间倒序分页返回 `{ total, page, limit, matches }`（分页参数与钳制规则同排行榜），包含用户作为发起者或对手的比赛。`GET /matches/:matchId`（公开）返回 `{ id, gameId, status, createdAt, updatedAt, release, seed, initiatorId, participants, result?, failureReason? }`；`participants` 为创建时快照，`completed` 比赛附带 `result` 与结算后的 `rank`/`ratingBefore`/`ratingAfter`，`failed` 附带受控 `failureReason`；未知 ID 返回 404 `MATCH_NOT_FOUND`。

## API

统一前缀为 `/api`，以下省略。

| 方法与路径 | 行为 |
| --- | --- |
| `POST /auth/register` | 用户名和密码注册，并创建会话 |
| `POST /auth/login` | 登录并创建会话，返回当前用户与 token |
| `GET /auth/me` | 当前用户；无有效会话时返回 401 |
| `POST /auth/logout` | 撤销当前会话 |
| `PUT /auth/password` | 验证旧密码后修改，撤销全部会话并要求重新登录 |
| `GET /games` | 游戏目录和基本信息 |
| `GET /games/:gameId` | 当前发行、玩法、提示词、SDK 与资源限额 |
| `GET /games/:gameId/releases/:releaseId` | 指定不可变发行的元数据、代码协议版本、resolvedLimits、下载地址、压缩包字节数与 SHA-256 |
| `GET /games/:gameId/download` | 当前独立开发包 |
| `GET /games/:gameId/releases/:releaseId/download` | 指定发行的开发包 |
| `GET /games/:gameId/official-bot` | 当前官方 bot 源码 |
| `GET /games/:gameId/me` | 当前用户的参赛信息、最新代码、botProtocolVersion 与 canMatch/不能参赛原因 |
| `PUT /games/:gameId/me/code` | 覆盖最新代码，不运行比赛 |
| `POST /games/:gameId/matches` | 当前用户主动匹配，使用 Idempotency-Key 请求头 |
| `GET /games/:gameId/leaderboard` | 分页排行榜 |
| `GET /games/:gameId/me/matches` | 当前用户作为发起者或对手的比赛记录 |
| `GET /matches/:matchId` | 状态、参与者、结果、排位变化或系统失败原因 |
| `GET /matches/:matchId/replay` | completed 时返回 application/gzip 回放，其他状态返回 409；不设置 Content-Encoding，以便浏览器与 CLI 统一解压 |

匹配请求不能让客户端任意修改正式排位的 tick 限制、资源预算、出生位置或规则发行。玩家主动匹配自己的最新选手，对手由平台选择。

网页每 1 秒轮询进行中的比赛，完成或失败后停止；请求失败时按 2、4、8 秒退避并以 8 秒为上限，页面隐藏时暂停轮询，恢复可见立即查询。比赛完成后获取回放，不使用 WebSocket 或实时 tick 推流。

## 访问边界

- 上传、主动匹配、读取自己的代码要求认证，主体从会话获得，不能信任 body 中的 user ID。
- 游戏规则、官方示例、下载包、排行榜可公开。
- 首版已完成比赛的结果和回放可公开，用于观赏；包含对局双方公开身份与动作，不含普通用户源码、Memory 或玩家 console 日志。
- 失败任务的内部堆栈和基础设施信息不直接公开，用户看到受控错误摘要。
- 本地调试服务默认仅监听 loopback，不成为平台远程调试 API。

## 必要索引

- `game_entries(game_id, user_id)` 唯一。
- `game_entries(game_id, rating DESC, user_id)` 用于匹配和排行榜，rating 为 `numeric(12,6)`，默认 1000。
- `users(normalized_username)` 唯一；`sessions(token_hash)` 唯一，`sessions(user_id)` 和 `sessions(expires_at)` 用于撤销与清理。
- `matches(initiator_id, idempotency_key)` 唯一，幂等标识不允许为空绕过。
- `matches(initiator_id, game_id)` 在 `status IN ('pending', 'running')` 时唯一，约束未完成主动请求。
- `matches(status, created_at)` 用于任务领取；运行租约索引用于过期处理。
- `match_participants(user_id, match_id)` 用于用户比赛记录。

匹配参与者必须至少两名且用户 ID 不重复，发起者必须在参与者中；匹配与官方回退均排除本人，禁止自对弈刷分。参与者在创建比赛时固定，最终结果的用户集合必须与之完全一致。

所有主键使用 UUID，时间使用 `timestamptz`，JSON 结果与配置使用 `jsonb`。比赛状态使用受约束文本枚举，状态、执行标识与结算字段在同一事务更新。`auth_rate_limits(scope, subject_hash, window_start)` 唯一；这些约束由 Drizzle 迁移创建，不依赖应用查询约定替代数据库约束。
