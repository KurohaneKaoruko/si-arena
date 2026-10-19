import { waitForWorkspaceDeps } from "./workspace-deps";

/**
 * 命令行入口：等待当前目录所属 app 的 workspace 依赖产物就绪。
 *
 * 用法：在 app 的 dev 脚本中先跑本脚本，再启动 app。
 */
try {
  await waitForWorkspaceDeps(process.cwd());
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
