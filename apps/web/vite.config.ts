import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const target = `http://${env.API_HOST === "0.0.0.0" ? "127.0.0.1" : (env.API_HOST ?? "127.0.0.1")}:${env.API_PORT ?? "3000"}`;
  return {
    plugins: [vue(), tailwindcss()],
    server: {
      host: env.API_HOST === "0.0.0.0" ? true : "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api": target, "/health": target },
    },
  };
});
