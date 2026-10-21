import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { x as extract } from "tar";

/**
 * 发布执行器：只负责把已定版的公开包按拓扑序发上 npm。版本决策由 pnpm 原生
 * versioning.fixed 承担（`pnpm change` → `pnpm version -r`），本脚本不修改版本。
 *
 * 用法：pnpm publish:packages [--dry-run] [--otp <code>]
 *
 * 支持断点续传：已在 registry 上的同名同版本包直接跳过，浏览器逐个授权
 * 中途断掉后重跑本脚本即可发完剩余的包。
 */

const PUBLIC_PACKAGES = [
  { name: "@si-arena/protocol", directory: "packages/protocol" },
  { name: "@si-arena/sandbox", directory: "packages/sandbox" },
  { name: "@si-arena/engine", directory: "packages/engine" },
  { name: "@si-arena/player", directory: "packages/player" },
  { name: "@si-arena/game-paper", directory: "games/paper" },
  { name: "@si-arena/game-royale", directory: "games/royale" },
  { name: "@si-arena/cli", directory: "packages/cli" },
] as const;

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const otpIndex = args.indexOf("--otp");
const otp = otpIndex >= 0 ? args[otpIndex + 1] : process.env.NPM_CONFIG_OTP;

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 26) throw new Error("Publishing requires Node.js 26 or newer");

const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error("Run this script with pnpm publish:packages");
const pnpmIsScript = /\.[cm]?js$/.test(pnpmPath);
const runPnpm = (pnpmArgs: string[], options: { timeoutMs: number; silent?: boolean }) =>
  spawnSync(
    pnpmIsScript ? process.execPath : pnpmPath,
    pnpmIsScript ? [pnpmPath, ...pnpmArgs] : pnpmArgs,
    // 不传 env：子进程继承当前环境，SI_ARENA_SERVER_URL 等变量自然透传给构建。
    { cwd: root, stdio: options.silent ? "pipe" : "inherit", timeout: options.timeoutMs },
  );

// lockstep 防线：publish 前所有公开包版本必须一致（正常由 versioning.fixed 保证）。
const versions = new Map<string, string>();
for (const pkg of PUBLIC_PACKAGES) {
  const manifest = JSON.parse(
    await readFile(join(root, pkg.directory, "package.json"), "utf8"),
  ) as { version: string };
  versions.set(pkg.name, manifest.version);
}
const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size !== 1)
  throw new Error(
    `Public package versions diverged: ${JSON.stringify(Object.fromEntries(versions))}`,
  );
const version = versions.values().next().value as string;

// 工作区必须干净：publish 的 prepack 会重建 dist，混入未提交改动无法追溯。
const gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (gitStatus.trim() !== "") throw new Error("Commit or stash your changes before publishing");

const temporary = await mkdtemp(join(tmpdir(), "si-arena-publish-"));
try {
  // 抽查 CLI tarball：workspace 依赖必须已被替换为当前版本（形态允许 ^x.y.z / x.y.z）。
  runPnpm(["--filter", "@si-arena/cli", "pack", "--pack-destination", temporary], {
    timeoutMs: 10 * 60_000,
  });
  const [archive] = (await readdir(temporary)).filter((file) => file.endsWith(".tgz"));
  if (!archive) throw new Error("Packing @si-arena/cli produced no tarball");
  await extract({ file: join(temporary, archive), cwd: temporary, strict: true });
  const packedManifest = JSON.parse(
    await readFile(join(temporary, "package", "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const internalRanges: Record<string, string> = {};
  for (const [name, range] of Object.entries(packedManifest.dependencies ?? {})) {
    if (!name.startsWith("@si-arena/")) continue;
    assert.ok(!range.startsWith("workspace:"), `${name} retained a workspace link in the tarball`);
    const base = range.replace(/^[\^~]/, "");
    assert.ok(
      base === version,
      `${name} resolved to "${range}", expected the lockstep version ${version}`,
    );
    internalRanges[name] = range;
  }
  assert.ok(
    Object.keys(internalRanges).length > 0,
    "CLI tarball declared no @si-arena dependencies; the check is miswired",
  );
  console.log(`workspace 依赖替换形态（版本 ${version}）：`, internalRanges);

  // 环境原样透传给构建与 prepack：自托管者可设置 SI_ARENA_SERVER_URL 烧入
  // 自己的默认地址，官方发布不设置，npm 包默认连接 loopback。
  runPnpm(["build"], { timeoutMs: 10 * 60_000 });

  for (const pkg of PUBLIC_PACKAGES) {
    // 断点续传：registry 上已存在同名同版本（view 退出码非 0 即未发布）则跳过，
    // 浏览器逐个授权中途断掉后重跑不会撞已发布版本。
    const onRegistry = runPnpm(["view", `${pkg.name}@${version}`, "version"], {
      timeoutMs: 60_000,
      silent: true,
    });
    if (onRegistry.status === 0) {
      console.log(`>>> ${pkg.name}@${version} 已在 registry 上，跳过`);
      continue;
    }
    console.log(`\n>>> publishing ${pkg.name}@${version}${dryRun ? " (dry run)" : ""}`);
    const result = runPnpm(
      [
        "--filter",
        pkg.name,
        "publish",
        "--access",
        "public",
        "--no-git-checks",
        ...(dryRun ? ["--dry-run"] : []),
        ...(otp ? ["--otp", otp] : []),
      ],
      { timeoutMs: 10 * 60_000 },
    );
    if (result.status !== 0) throw new Error(`Publishing ${pkg.name} failed`);
  }

  console.log("\n发布完成：");
  for (const pkg of PUBLIC_PACKAGES) console.log(`  ${pkg.name}@${version}`);
  if (dryRun) console.log("（dry run：未真正发布）");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
