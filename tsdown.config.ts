import { defineConfig } from "tsdown";

// Resolve paths from the calling workspace, preserving its public dist layout.
export default defineConfig((inline) => ({
  cwd: process.cwd(),
  entry: ["src/**/*.ts"],
  root: "src",
  outDir: "dist",
  format: "esm",
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  target: "es2023",
  unbundle: true,
  // Watch 模式不清理 dist。并行启动时 app 可能在包重建完成前 import 产物，
  // 清理会让 ESM 解析失败（ERR_MODULE_NOT_FOUND），且 node --watch 不会自愈。
  // 代价是 watch 下删除源文件会留下过期的 dist 产物，仅影响本地开发。
  clean: !inline.watch,
  sourcemap: true,
  dts: { sourcemap: true },
  define: {
    BUILD_DEFAULT_SERVER_URL: JSON.stringify(
      process.env.SI_ARENA_SERVER_URL ?? "http://127.0.0.1:3000",
    ),
  },
}));
