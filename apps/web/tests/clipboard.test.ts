import { afterEach, expect, test, vi } from "vitest";
import { copyText } from "../src/utils/clipboard";

// jsdom 未实现剪贴板，按用例注入 navigator.clipboard 与 document.execCommand。
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function stubExecCommand(result: boolean) {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => result),
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

test("安全上下文优先使用 Async Clipboard API，不触碰 execCommand", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard(writeText);
  stubExecCommand(true);
  await expect(copyText("npx @si-arena/cli init paper")).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith("npx @si-arena/cli init paper");
  expect(document.execCommand).not.toHaveBeenCalled();
});

test("navigator.clipboard 不可用（纯 HTTP 非安全上下文）时降级 execCommand", async () => {
  stubExecCommand(true);
  await expect(copyText("PROMPT")).resolves.toBe(true);
  expect(document.execCommand).toHaveBeenCalledWith("copy");
});

test("Async Clipboard 被拒绝时同样降级", async () => {
  stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
  stubExecCommand(true);
  await expect(copyText("official.js")).resolves.toBe(true);
});

test("execCommand 失败时报告失败，由调用方提示手动复制", async () => {
  stubExecCommand(false);
  await expect(copyText("bot.js")).resolves.toBe(false);
});
