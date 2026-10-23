import { expect, test } from "vitest";
import { runCli } from "../src";

test.each([
  ["run"],
  ["update", "extra"],
  ["init", "paper", "target", "--release", "paper@1"],
  ["init", "paper", "target", "--revision", "a".repeat(64)],
  ["run", "--bot", "x", "extra"],
  ["dev"],
  ["replay", "x"],
  ["replay", "x", "extra", "--verify"],
  ["run", "--bot", "x", "--logs"],
  ["replay", "x", "--verify", "--bot", "x"],
  ["run", "--bot", "x", "--matches", "0"],
  ["run", "--bot", "x", "--matches", "1001"],
  ["run", "--bot", "x", "--matches", "1.5"],
  ["run", "--bot", "x", "--seed", "-1"],
  ["run", "--bot", "x", "--seed", "4294967296"],
  ["run", "--bot", "x", "--seed", "1e2"],
  ["run", "--bot", "x", "--bot", "y"],
  ["run", "--bot", "x", "--unknown"],
])("rejects invalid arguments before loading any game: %j", async (...args) => {
  const output: string[] = [];
  await expect(
    runCli(args, {
      write: (line) => {
        output.push(line);
      },
    }),
  ).rejects.toThrow();
  expect(output).toHaveLength(0);
});

test("help and version do not load the supplied registry", async () => {
  const output: string[] = [];
  const context = {
    write: (line: string) => {
      output.push(line);
    },
  };
  await runCli(["--registry", "does-not-exist.mjs", "--help"], context);
  await runCli(["--registry", "does-not-exist.mjs", "--version"], context);
  expect(output[0]).toContain("SI Arena CLI");
  expect(output[1]).toMatch(/^@si-arena\/cli /);
});

test("execution requires explicit trusted game registration", async () => {
  await expect(runCli(["run", "--bot", "x"])).rejects.toThrow(/No games registered/);
});
