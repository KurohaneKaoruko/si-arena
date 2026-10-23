import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { paperGame } from "@si-arena/game-paper/game";
import GameDevelopment from "../src/components/GameDevelopment.vue";
import ToastHost from "../src/components/ui/ToastHost.vue";
import { useToast } from "../src/composables/useToast";

enableAutoUnmount(afterEach);
beforeEach(() => useToast().dismiss());
afterEach(() => {
  useToast().dismiss();
  vi.unstubAllGlobals();
});
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
test("copies materials with feedback, escapes code and links only to the current same-site download", async () => {
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
  const toast = mount(ToastHost);
  await flushPromises();
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "复制提示词")!;
  await button.trigger("click");
  await flushPromises();
  expect(writeText).toHaveBeenCalledWith(docs.prompt);
  expect(toast.text()).toContain("已复制");
  const setup = wrapper
    .findAll("button")
    .find((candidate) => candidate.text() === "复制 AI 安装提示词")!;
  await setup.trigger("click");
  await flushPromises();
  const copied = writeText.mock.calls.at(-1)![0] as string;
  expect(copied).toContain("npx @si-arena/cli@latest init paper");
  expect(copied).toContain('--server "');
  expect(copied).toContain("PROMPT.md");
  expect(copied).toContain("pnpm arena run --bot ./bot.js");
  expect(wrapper.find("img").exists()).toBe(false);
  expect(wrapper.text()).toContain(docs.officialBot);
  const download = wrapper.findAll("a").find((link) => link.text() === "下载开发包 ZIP")!;
  expect(download.attributes("href")).toBe("/api/games/paper/download");
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
  const toast = mount(ToastHost);
  await flushPromises();
  expect(wrapper.text()).toContain("下载包暂不可用");
  expect(
    wrapper.findAll("button").find((button) => button.text() === "复制 AI 安装提示词"),
  ).toBeTruthy();
  expect(
    (wrapper.get('textarea[aria-label="统一参赛提示词"]').element as HTMLTextAreaElement).value,
  ).toBe(docs.prompt);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "复制提示词")!
    .trigger("click");
  await flushPromises();
  expect(toast.text()).toContain("请手动选择并复制");
});
test("a failing setup-prompt copy reveals only its own section", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
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
  const toast = mount(ToastHost);
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "复制 AI 安装提示词")!
    .trigger("click");
  await flushPromises();
  expect(toast.text()).toContain("请手动选择并复制");
  const open = wrapper
    .findAll("details")
    .filter((node) => (node.element as HTMLDetailsElement).open);
  expect(open).toHaveLength(1);
  expect(open[0]!.text()).toContain("AI 安装提示词");
});
