import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import { paperGame } from "@si-arena/game-paper/game";
import GameDevelopment from "../src/components/GameDevelopment.vue";

enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());
const docs = {
  prompt: "统一提示词",
  sdk: "SDK 文档",
  officialBot: "<img src=x onerror=alert(1)>",
  template: 'export default ()=>({type:"idle"})',
};
const metadata = {
  formatVersion: 1,
  game: paperGame.manifest,
  engineCompatibility: "arena-engine-v1",
  components: { "@si-arena/cli": "0.0.0" },
  runtime: { node: ">=26", pnpm: ">=12", nodeVersion: "26.11.1", packageManager: "pnpm@12.14.0" },
  sourceLockSha256: "a".repeat(64),
  manifestSha256: "b".repeat(64),
  archive: { url: "javascript:alert(1)", bytes: 100, sha256: "c".repeat(64) },
};
test("copies materials with feedback, escapes code and links only to the pinned same-site download", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          new Response(JSON.stringify(path.endsWith("/development") ? docs : metadata)),
        ),
      ),
  );
  const wrapper = mount(GameDevelopment, { props: { game: paperGame.manifest } });
  await flushPromises();
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "复制提示词")!;
  await button.trigger("click");
  await flushPromises();
  expect(writeText).toHaveBeenCalledWith(docs.prompt);
  expect(wrapper.get("[role=status]").text()).toContain("已复制");
  expect(wrapper.find("img").exists()).toBe(false);
  expect(wrapper.text()).toContain(docs.officialBot);
  const download = wrapper.findAll("a").find((link) => link.text() === "下载开发包 ZIP")!;
  expect(download.attributes("href")).toBe("/api/games/paper/releases/paper%400.1.0/download");
});
test("materials remain usable when the archive is unavailable and clipboard failures explain manual copying", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/development")
          ? new Response(JSON.stringify(docs))
          : new Response(JSON.stringify({ code: "RELEASE_NOT_FOUND", message: "未生成" }), {
              status: 404,
            }),
      ),
    ),
  );
  const wrapper = mount(GameDevelopment, { props: { game: paperGame.manifest } });
  await flushPromises();
  expect(wrapper.text()).toContain("下载包暂不可用");
  expect(wrapper.get("textarea").element.value).toBe(docs.prompt);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "复制提示词")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("请手动选择并复制");
});
