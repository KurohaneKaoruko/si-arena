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
 * 用法：SI_ARENA_SERVER_URL=https://… pnpm publish:packages [--dry-run] [--otp <code>]
 */

const PUBLIC_PACKAGES = [
  { name: "@si-arena/protocol", directory: "packages/protocol" },
  { name: "@si-arena/sandbox", directory: "packages/sandbox" },
  { name: "@si-arena/engine", directory: "packages/engine" },
  { name: "@si-arena/player", directory: "packages/player" },
  { name: "@si-arena/game-paper", directory: "games/paper" },
  { name: "@si-arena/cli", directory: "packages/cli" },
] as const;

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const otpIndex = args.indexOf("--otp");
const otp = otpIndex >= 0 ? args[otpIndex + 1] : process.env.NPM_CONFIG_OTP;

const serverUrl = process.env.SI_ARENA_SERVER_URL;
if (!serverUrl)
  throw new Error("Set SI_ARENA_SERVER_URL (the public API origin) before publishing");
const parsedUrl = new URL(serverUrl);
const isLoopback = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
if (parsedUrl.protocol !== "https:" && !isLoopback)
  throw new Error("SI_ARENA_SERVER_URL must use https (loopback allowed for dry runs)");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 26) throw new Error("Publishing requires Node.js 26 or newer");

const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error("Run this script with pnpm publish:packages");
const pnpmIsScript = /\.[cm]?js$/.test(pnpmPath);
const runPnpm = (pnpmArgs: string[], options: { timeoutMs: number; env?: NodeJS.ProcessEnv }) =>
  spawnSync(
    pnpmIsScript ? process.execPath : pnpmPath,
    pnpmIsScript ? [pnpmPath, ...pnpmArgs] : pnpmArgs,
    { cwd: root, env: options.env, stdio: "inherit", timeout: options.timeoutMs },
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

  // 带公开地址构建；publish 阶段的 prepack 重建也沿用同一 env。
  const buildEnv = { ...process.env, SI_ARENA_SERVER_URL: serverUrl };
  runPnpm(["build"], { timeoutMs: 10 * 60_000, env: buildEnv });

  for (const pkg of PUBLIC_PACKAGES) {
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
      { timeoutMs: 10 * 60_000, env: buildEnv },
    );
    if (result.status !== 0) throw new Error(`Publishing ${pkg.name} failed`);
  }

  console.log("\n发布完成：");
  for (const pkg of PUBLIC_PACKAGES) console.log(`  ${pkg.name}@${version}`);
  if (dryRun) console.log("（dry run：未真正发布）");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
