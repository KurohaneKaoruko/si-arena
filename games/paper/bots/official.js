/** Same public observation, SDK, Memory and limits as every player. */
export default function tick({ observation, Memory, sdk }) {
  const home = sdk.homePath(observation);
  const outside = home === null || home.length > 0;
  const threat = outside ? sdk.threatDistance(observation) : null;
  if (!outside && Memory.outside) Memory.route = [];
  Memory.outside = outside;
  if (outside && home && threat !== null && threat <= home.length + 1) {
    Memory.route = [];
    return home.length ? { type: "move", direction: home[0] } : { type: "idle" };
  }
  if (!outside && (!Array.isArray(Memory.route) || Memory.route.length === 0)) {
    Memory.route = sdk.expansion(observation);
  }
  const safe = sdk.safeMoves(observation);
  const planned = Memory.route?.[0];
  if (planned && safe.includes(planned)) {
    Memory.route.shift();
    return { type: "move", direction: planned };
  }
  Memory.route = [];
  if (outside && home?.length && safe.includes(home[0])) {
    return { type: "move", direction: home[0] };
  }
  return { type: "idle" };
}
