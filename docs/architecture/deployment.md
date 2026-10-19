# 部署与发布

本文定义生产部署形态、上线步骤与 npm 发布流程。本地开发环境见 [README](../../README.md)；本文只关心把已验证的构建产物放到公网。

## 部署形态

单机 Linux 部署，全部组件由 `deploy/compose.prod.yaml` 编排：

| 组件    | 形态                                                                 |
| ------- | -------------------------------------------------------------------- |
| `db`    | postgres:18 容器，数据在命名卷，不暴露宿主端口                       |
| server  | `app` 镜像，一次性 `migrate` 服务完成后启动                           |
| worker  | 同 `app` 镜像，与 server 共享 `replays_data` 卷（回放终稿硬链接发布） |
| web     | `web` 镜像：Caddy 托管 SPA 静态文件，反代 `/api` 与 `/health`         |
| Caddy   | 按 `CADDY_DOMAIN` 自动申请并续期 TLS；未设置域名时只监听 80           |

镜像由 `deploy/Dockerfile` 的两个 target 构建（构建上下文仍是仓库根）：

- `app`：`node:26-slim` + pnpm 12.14.0，包含完整 workspace 构建产物与依赖。保留仓库目录布局，使启动脚本、drizzle 迁移、`packages/sandbox/runtime/` 的 WASM 与 `games/paper` 的官方 bot 等按相对路径解析的资源全部成立。server 与 worker 共用该镜像，仅启动命令不同。
- `web`：`caddy:2-alpine` + `apps/web/dist` 静态文件 + `deploy/Caddyfile`。

凭据统一放 `.env.prod`（参照 `.env.prod.example`，已被 git 忽略）。`POSTGRES_PASSWORD` 必填；`CADDY_DOMAIN` 决定是否启用自动 HTTPS。所有 compose 命令都显式携带 `--env-file .env.prod`，避免误读开发用 `.env`。

## 前置条件

1. 一台 Linux 服务器（amd64/arm64 皆可）与已安装的 Docker Engine、compose 插件。
2. 域名 DNS A/AAAA 记录指向服务器；防火墙放行 80/443。
3. npm 上拥有 `@si-arena` 组织且本机 `pnpm whoami` 具有发布权限（仅发布 CLI 时需要）。
4. 代码托管在 GitHub（CI 生效的前提；仓库当前未配置远端时先添加并推送）。

## 首次上线

在服务器上的仓库目录内执行：

```sh
cp .env.prod.example .env.prod   # 填写 POSTGRES_PASSWORD 与 CADDY_DOMAIN

# 1. 构建镜像并启动数据库与迁移（server/worker 会等迁移完成后自启）
docker compose --env-file .env.prod -f deploy/compose.prod.yaml up -d --build

# 2. 生成开发包发行并注入共享卷（本机生成后随仓库目录部署到服务器）
pnpm build:devkits
docker compose --env-file .env.prod -f deploy/compose.prod.yaml --profile tools run --rm seed-releases
```

`seed-releases` 把宿主 `./data/releases` 拷入 `releases_data` 卷，供 server 的发行下载路由读取。发行目录不可变：更新开发包内容时先删 `data/releases/paper` 重建（保持 `paper@0.1.0` 不递增，见 [分发设计](distribution-and-development.md)），再重跑上面的 seed 命令。

日常更新：`git pull && docker compose --env-file .env.prod -f deploy/compose.prod.yaml up -d --build`，迁移服务会在启动前自动应用新的数据库变更。

## 冒烟清单

上线或重大变更后逐项验证：

1. `https://<域名>/health` 返回 ok；`/api/games` 列出圈地。
2. 注册新账号、登录、上传一份代码、对官方 bot 发起匹配，比赛完成并出现排位分变化。
3. 比赛详情可播放在线回放；`/api/matches/:id/replay` 可下载 gzip。
4. 在另一台机器执行 `npx @si-arena/cli@latest init paper ./paper-bot --server https://<域名>` 能完成校验与下载，devkit 内 `pnpm arena run` 可跑完比赛。
5. 游戏详情页的提示词、SDK 与官方 bot 下载链接可用。

## 版本与 npm 发布

公开包采用统一版本（lockstep）：`pnpm-workspace.yaml` 的 `versioning.fixed` 把 6 个公开包（protocol、sandbox、engine、player、game-paper、cli）声明为一个固定组，private 包在 `versioning.ignore` 中排除。发版流程：

```sh
# 1. 记录变更意图（哪些包受影响、bump 级别、changelog 摘要）
pnpm change <包名...> --bump <patch|minor|major> --summary "…"

# 2. 应用发布计划：固定组统一升版，private 包不动；递归模式不产生 git 提交
pnpm version -r
git add -A && git commit -m "chore: release <版本>"

# 3. 发布（构建时把公开服务地址烧入 CLI 默认值）
SI_ARENA_SERVER_URL=https://<域名> pnpm publish:packages [--otp <验证码>]
```

`scripts/publish.ts` 只做执行器：校验工作区干净、公开包版本一致、抽查 CLI tarball 中 `workspace:*` 已替换为当前版本，然后按依赖拓扑序（protocol → sandbox → engine → player → game-paper → cli）以 `--access public` 发布。`--dry-run` 走全链但不真正发布，用于演练。npm 账号开启 2FA 时用 `--otp` 或 `NPM_CONFIG_OTP` 传入验证码。

发布后注意：

- 开发包发行与 npm 版本是两条线：devkit 内部包走 vendor 本地归档，不要求已发布 npm；但正式对外建议发版后重建 devkit，使 `release.json` 的 components 记录真实发布版本。
- CI（`.github/workflows/ci.yml`）在 push/PR 时运行 `pnpm check`、`pnpm test:artifacts` 与两个镜像的 docker build，不自动发布。

## 数据与备份

- `postgres_data` 卷：用 `docker compose --env-file .env.prod -f deploy/compose.prod.yaml exec db pg_dump -U si_arena si_arena` 定期导出。
- `replays_data` 卷：回放终稿为不可覆盖资产，随卷一起备份。
- `releases_data` 卷内容可随时从仓库 `data/releases` 重新 seed，无需单独备份。
- `caddy_data` 卷保存 TLS 证书，丢失后自动重新申请。

## 沙箱隔离加固（可选）

容器内 worker 默认 `WORKER_ISOLATION=local`：QuickJS 的 CPU、堆、栈与墙钟限制全部生效，但子进程 RSS 无 cgroup 上限。需要内核级内存硬限时，改用 `WORKER_ISOLATION=cgroup-v2` 并通过 `WORKER_CGROUP_ROOT` 指向宿主已委托（systemd `Delegate=`）的 cgroup v2 目录，将该目录挂载进 worker 容器。此时每个执行器获得独立资源组（`memory.max` 按发行 `resolvedLimits.processMemoryBytes`、`memory.swap.max=0`、`pids.max=16`、OOM 组杀）；隔离设施建立失败时拒绝执行，不回退。网络命名空间、只读根文件系统等容器层加固属部署侧责任，按需在 compose 或宿主配置。见 [沙箱](sandbox.md) 与 [资源限额](resource-limits.md)。
