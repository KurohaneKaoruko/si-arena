import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { waitForWorkspaceDeps } from "./workspace-deps";

/**
 * app 的开发入口：先等 workspace 产物就绪，再加载应用。
 *
 * `node --watch` 会重启入口，但重启失败后不会自愈——它只在下次文件变化时再试。
 * 外部执行 `pnpm build:packages`（`pnpm check` 会先跑它）会清空 dist 再重写，
 * 正在 watch 的 app 可能在空窗期重启，import 解析失败后就此停摆。
 *
 * 这里把加载放到闸门之后：每次重启都重新确认产物就绪，加载失败就地重试，
 * 进程不再带着缺失的依赖退出。
 */

const RETRY_DELAY_MS = 500;
const MAX_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const appEntry = resolve(process.cwd(), "src/main.ts");
if (!existsSync(appEntry)) {
  console.error(`[dev] 找不到应用入口：${appEntry}`);
  process.exit(1);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    await waitForWorkspaceDeps(process.cwd());
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    await sleep(RETRY_DELAY_MS);
    continue;
  }
  try {
    await import(pathToFileURL(appEntry).href);
    break;
  } catch (error) {
    console.error(`[dev] 应用加载失败（第 ${attempt} 次），稍后重试：`, error);
    await sleep(RETRY_DELAY_MS);
  }
}
