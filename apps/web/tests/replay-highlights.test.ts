import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import ReplayHighlights from "../src/components/replay/ReplayHighlights.vue";

test("the feed shows moments up to the current tick, newest first, and seeks on click", async () => {
  const highlights = [
    { tick: 12, text: "B 出局：越界", tone: "danger" as const },
    { tick: 40, text: "安全区收缩到 30×30", tone: "neutral" as const },
    { tick: 90, text: "C 出局：撞头", tone: "danger" as const },
  ];
  const wrapper = mount(ReplayHighlights, { props: { highlights, tick: 40 } });
  const rows = wrapper.findAll("li");
  expect(rows.map((row) => row.text())).toStrictEqual([
    "t 40安全区收缩到 30×30",
    "t 12B 出局：越界",
  ]);
  await rows[1]!.get("button").trigger("click");
  expect(wrapper.emitted("seek")).toStrictEqual([[12]]);
  await wrapper.setProps({ tick: 5 });
  expect(wrapper.text()).toContain("还没有淘汰或缩圈");
});
