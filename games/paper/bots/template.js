/** @param {import('@si-arena/game-paper/sdk').PaperTickInput} input */
export default function tick({ observation, Memory, sdk }) {
  Memory.ticks = typeof Memory.ticks === "number" ? Memory.ticks + 1 : 1;
  const route = sdk.homePath(observation);
  if (route?.length) return { type: "move", direction: route[0] };
  return { type: "idle" };
}
