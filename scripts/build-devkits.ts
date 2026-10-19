import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { ENGINE_COMPATIBILITY } from "@si-arena/engine";
import {
  DEVKIT_MAX_ARCHIVE_BYTES,
  DEVKIT_MAX_EXTRACTED_BYTES,
  parseDevkitManifest,
  parseGameReleaseMetadata,
  type DevkitDescriptor,
  type GameReleaseMetadata,
} from "@si-arena/protocol";
import { devkitGames } from "../configs/devkits";

interface Package {
  name: string;
  version: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
}
const root = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run with pnpm build:devkits");
function runPnpm(args: string[], cwd = root) {
  const script = /\.[cm]?js$/.test(pnpm!);
  return execFileSync(script ? process.execPath : pnpm!, script ? [pnpm!, ...args] : args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
}
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Package;
if (!rootPackage.packageManager?.startsWith("pnpm@12."))
  throw new Error("Development packages require pinned pnpm 12");
runPnpm(["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"]);
const sourceLock = await readFile(join(root, "pnpm-lock.yaml"));
const workspaceSettings = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
const destination = resolve(root, process.env.DEVKITS_DIR ?? "data/releases");
const temporary = await mkdtemp(join(tmpdir(), "si-arena-devkits-"));
try {
  const viewer = join(temporary, "viewer");
  runPnpm([
    "--filter",
    "@si-arena/web",
    "exec",
    "vite",
    "build",
    "--config",
    "vite.devkit.config.ts",
    "--outDir",
    viewer,
  ]);
  await rename(join(viewer, "devkit.html"), join(viewer, "index.html"));
  for (const registration of devkitGames) {
    const { game, packageName } = registration;
    const stage = join(temporary, game.manifest.id);
    await mkdir(stage);
    const write = async (name: string, value: string | Uint8Array) => {
      const path = join(stage, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value);
    };
    const components: Record<string, string> = {};
    const dependencies: Record<string, string> = {};
    const packageDirectories = [
      "packages/protocol",
      "packages/engine",
      "packages/sandbox",
      "packages/player",
      "packages/cli",
      registration.directory,
    ];
    const vendor = join(stage, "vendor");
    await mkdir(vendor);
    for (const directory of packageDirectories) {
      const pkg = JSON.parse(
        await readFile(join(root, directory, "package.json"), "utf8"),
      ) as Package;
      components[pkg.name] = pkg.version;
      runPnpm(["--dir", join(root, directory), "pack", "--pack-destination", vendor]);
      dependencies[pkg.name] =
        `file:vendor/${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;
    }
    // Preserve known resolutions, then let pnpm produce the standalone lockfile.
    await write("pnpm-lock.yaml", sourceLock);
    await write(
      "package.json",
      json({
        name: `si-arena-${game.manifest.id}-bot`,
        version: "1.0.0",
        private: true,
        type: "module",
        packageManager: rootPackage.packageManager,
        engines: { node: ">=26", pnpm: ">=12" },
        scripts: { arena: "node ./arena.mjs" },
        dependencies,
      }),
    );
    // Keep the build's catalog and supply-chain policies while resolving all own packages locally.
    await write(
      "pnpm-workspace.yaml",
      workspaceSettings + "\noverrides: " + JSON.stringify(dependencies) + "\n",
    );
    runPnpm(["install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"], stage);
    const development = {
      prompt: await readFile(registration.developmentFiles.prompt, "utf8"),
      sdk: await readFile(registration.developmentFiles.sdk, "utf8"),
      template: await readFile(registration.developmentFiles.template, "utf8"),
    };
    await write("PROMPT.md", development.prompt);
    await write("SDK.md", development.sdk);
    await write("bot.js", development.template);
    await write("bots/official.js", await readFile(registration.officialBotUrl));
    await cp(viewer, join(stage, "dist/viewer"), { recursive: true });
    // Resolve types through the game's public export rather than assuming its internal layout.
    await write("sdk/index.d.ts", `export type * from '${packageName}/sdk';\n`);
    await write("sdk/runtime.js", registration.sdkSource);
    await write(
      "arena.mjs",
      `import { defineLocalGame, runCli } from '@si-arena/cli';
import * as gameModule from '${packageName}/game';
import { fileURLToPath } from 'node:url';
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('SI Arena requires Node.js 26 or newer');
  await runCli(process.argv.slice(2), { games: [defineLocalGame({ game: gameModule[${JSON.stringify(registration.gameExport)}], sdkSource: gameModule[${JSON.stringify(registration.sdkSourceExport)}], officialBotUrl: gameModule.officialBotUrl })], viewerDirectory: fileURLToPath(new URL('./dist/viewer/', import.meta.url)), signal: cancellation.signal });
} catch (error) {
  if (!cancellation.signal.aborted) console.error(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Local operation failed' }));
  process.exitCode = cancellation.signal.aborted ? 130 : 1;
} finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
`,
    );
    await write(
      "README.md",
      `# ${game.manifest.name} 开发包\n\n发行：${game.manifest.release}；玩家接口：${game.manifest.botProtocolVersion}。\n\n要求 Node.js 26+ 与 pnpm 12。\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm arena run --bot ./bot.js --seed 42\npnpm arena run --bot ./bot.js --opponent ./bots/official.js --matches 20 --seed 42\npnpm arena replay ./replays/实际文件名.json.gz\npnpm arena replay ./replays/实际文件名.json.gz --verify --logs\n\`\`\`\n\n可视化回放命令输出本地 URL，在浏览器打开，Ctrl+C 停止服务。修改 bot.js 后重新运行比赛。PROMPT.md 提供统一参赛提示词，SDK.md 说明接口，sdk/ 提供类型与运行源码。bots/official.js 为官方示例，使用相同沙箱与预算。\n\n运行依赖安装完成后，对战与回放均不访问平台，不需要账号或数据库。CLI 只在 QuickJS 中执行玩家代码，回放不执行 bot。资源配置固定在 release.json，上传仍使用平台当前发行的预算。\n\nrelease.json 校验下载时的发行文件；开始编辑 bot.js 后不要求源码保持原始摘要。vendor/ 包含固定的内部包归档，第三方依赖由 pnpm-lock.yaml 锁定。原生 QuickJS 加载器与 WASM 位于沙箱归档的 runtime/ 中，无需本机编译。\n`,
    );
    await write(".gitignore", "node_modules/\nreplays/\n");
    await cp(
      join(root, "packages/sandbox/runtime/LICENSE"),
      join(stage, "LICENSES/quickjs-loader.txt"),
      { recursive: true },
    );
    await cp(
      join(root, "packages/sandbox/runtime/QUICKJS-LICENSE"),
      join(stage, "LICENSES/quickjs.txt"),
    );
    const licensed = new Set<string>();
    async function collectLicenses(name: string, from: string) {
      if (name.startsWith("@si-arena/") || licensed.has(name)) return;
      const require = createRequire(join(from, "package.json"));
      let directory: string;
      try {
        directory = dirname(require.resolve(`${name}/package.json`));
      } catch {
        directory = dirname(require.resolve(name));
        while (true) {
          const pkg = await readFile(join(directory, "package.json"), "utf8")
            .then((text) => JSON.parse(text) as Package)
            .catch(() => null);
          if (pkg?.name === name) break;
          const parent = dirname(directory);
          if (parent === directory) throw new Error(`Cannot find license for ${name}`);
          directory = parent;
        }
      }
      licensed.add(name);
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as Package;
      components[pkg.name] = pkg.version;
      for (const entry of await readdir(directory, { withFileTypes: true }))
        if (entry.isFile() && /^(license|copying|notice)(\.|$)/i.test(entry.name))
          await write(
            `LICENSES/${name.replace("@", "").replaceAll("/", "-")}-${entry.name}`,
            await readFile(join(directory, entry.name)),
          );
      for (const child of Object.keys(pkg.dependencies ?? {}))
        await collectLicenses(child, directory);
    }
    for (const directory of packageDirectories) {
      const pkg = JSON.parse(
        await readFile(join(root, directory, "package.json"), "utf8"),
      ) as Package;
      for (const name of Object.keys(pkg.dependencies ?? {}))
        await collectLicenses(name, join(root, directory));
    }
    await collectLicenses("vue", join(root, "apps/web"));
    const descriptor: DevkitDescriptor = {
      formatVersion: 1,
      game: game.manifest,
      engineCompatibility: ENGINE_COMPATIBILITY,
      components,
      runtime: {
        node: ">=26",
        pnpm: ">=12",
        nodeVersion: process.versions.node,
        packageManager: rootPackage.packageManager,
      },
      sourceLockSha256: sha(sourceLock),
    };
    const contents: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
    async function collect(directory: string, prefix = "") {
      for (const entry of (await readdir(directory, { withFileTypes: true })).toSorted((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const path = join(directory, entry.name);
        const name = prefix + entry.name;
        if (entry.isDirectory()) await collect(path, name + "/");
        else if (entry.isFile()) contents[name] = await readFile(path);
        else throw new Error("Development packages contain only regular files");
      }
    }
    await collect(stage);
    const files = Object.fromEntries(
      Object.entries(contents).map(([name, bytes]) => [
        name,
        { bytes: bytes.length, sha256: sha(bytes) },
      ]),
    );
    const manifest = parseDevkitManifest({ ...descriptor, files });
    const manifestBytes = Buffer.from(json(manifest));
    contents["release.json"] = manifestBytes;
    if (
      Object.values(contents).reduce((total, bytes) => total + bytes.length, 0) >
      DEVKIT_MAX_EXTRACTED_BYTES
    )
      throw new Error("Development package exceeds uncompressed limit");
    const zip = zipSync(contents, { level: 6, mtime: new Date("1980-01-01T00:00:00Z") });
    if (zip.length > DEVKIT_MAX_ARCHIVE_BYTES)
      throw new Error("Development package exceeds ZIP limit");
    const metadata: GameReleaseMetadata = parseGameReleaseMetadata({
      ...descriptor,
      manifestSha256: sha(manifestBytes),
      archive: {
        url: `/api/games/${game.manifest.id}/releases/${encodeURIComponent(game.manifest.release)}/download`,
        bytes: zip.length,
        sha256: sha(zip),
      },
    });
    const parent = join(destination, game.manifest.id);
    await mkdir(parent, { recursive: true });
    const published = join(parent, game.manifest.release);
    const existing = await readFile(join(published, "metadata.json"), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (existing) {
      if (parseGameReleaseMetadata(JSON.parse(existing)).archive.sha256 !== metadata.archive.sha256)
        throw new Error(
          `Release ${game.manifest.release} already exists with different contents; increment the game release before publishing`,
        );
    } else {
      const candidate = await mkdtemp(join(parent, ".publish-"));
      try {
        await writeFile(join(candidate, "devkit.zip"), zip);
        await writeFile(join(candidate, "metadata.json"), json(metadata));
        await rename(candidate, published);
      } finally {
        await rm(candidate, { recursive: true, force: true });
      }
    }
    console.log(
      JSON.stringify({
        gameId: game.manifest.id,
        release: game.manifest.release,
        file: join(published, "devkit.zip"),
        bytes: zip.length,
        sha256: metadata.archive.sha256,
      }),
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
