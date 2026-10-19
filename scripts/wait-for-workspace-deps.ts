import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 开发启动闸门：确认当前 app 依赖的 workspace 包已经产出可导入的入口文件。
 *
 * `pnpm dev` 会并行启动所有 workspace，包的 watch 构建与 app 同时起跑。包的
 * watch 模式已不再清空 dist，但首次构建仍未完成时 app 依然 import 不到产物；
 * ESM 解析失败不会自愈，node --watch 只在源码变化时重启，进程会直接退出。
 * 这个脚本把"等产物就绪"变成显式的一步。
 *
 * 用法：在 app 的 dev 脚本中先跑本脚本，再启动 app。脚本从当前工作目录读取
 * app 的 package.json，只关心 `@si-arena/` 前缀的 workspace 依赖。
 */

const SCOPE = "@si-arena/";
const POLL_INTERVAL_MS = 50;
const TIMEOUT_MS = 120_000;

interface PackageManifest {
  readonly name?: string;
  readonly main?: string;
  readonly exports?: string | Record<string, string | Record<string, string>>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface Target {
  readonly packageName: string;
  readonly file: string;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

/** 解析包声明的入口文件，覆盖根导出与全部子路径导出。 */
function declaredEntries(manifest: PackageManifest, packageDir: string): string[] {
  const entries: string[] = [];
  const exportsField = manifest.exports;
  if (typeof exportsField === "string") {
    entries.push(exportsField);
  } else if (exportsField && typeof exportsField === "object") {
    for (const value of Object.values(exportsField)) {
      if (typeof value === "string") {
        entries.push(value);
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const picked = value.import ?? value.default ?? value.node ?? value.require;
      if (picked) entries.push(picked);
    }
  }
  if (entries.length === 0 && manifest.main) entries.push(manifest.main);
  return [...new Set(entries.map((entry) => resolve(packageDir, entry)))];
}

/** pnpm 把 workspace 包链接进 app 的 node_modules，realpath 还原真实目录。 */
function linkedPackageDir(appDir: string, packageName: string): string | undefined {
  const link = join(appDir, "node_modules", ...packageName.split("/"));
  if (!existsSync(link)) return undefined;
  return realpathSync(link);
}

function collectTargets(appDir: string): Target[] {
  const manifest = readManifest(join(appDir, "package.json"));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const targets: Target[] = [];
  for (const packageName of Object.keys(dependencies)) {
    if (!packageName.startsWith(SCOPE)) continue;
    const packageDir = linkedPackageDir(appDir, packageName);
    if (!packageDir) continue;
    const dependency = readManifest(join(packageDir, "package.json"));
    for (const file of declaredEntries(dependency, packageDir)) targets.push({ packageName, file });
  }
  return targets;
}

function packageNames(targets: readonly Target[]): string[] {
  return [...new Set(targets.map((target) => target.packageName))];
}

async function main(): Promise<void> {
  const targets = collectTargets(process.cwd());
  if (targets.length === 0) return;

  const deadline = Date.now() + TIMEOUT_MS;
  let announced = false;
  for (;;) {
    const missing = targets.filter((target) => !existsSync(target.file));
    if (missing.length === 0) return;
    if (!announced) {
      announced = true;
      console.log(`[dev] 等待依赖包产物就绪：${packageNames(missing).join(", ")}`);
    }
    if (Date.now() >= deadline) {
      console.error(
        `[dev] 等待 ${packageNames(missing).join(", ")} 的构建产物超过 ${TIMEOUT_MS / 1000}s。` +
          "请在仓库根目录运行 pnpm build:packages 后重试。",
      );
      process.exit(1);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

await main();
