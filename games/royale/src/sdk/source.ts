/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const ROYALE_SDK_SOURCE = String.raw`
const freeze = Object.freeze;
const find = Function.prototype.call.bind(Array.prototype.find);
const filter = Function.prototype.call.bind(Array.prototype.filter);
export default function createGame(observation, {submit, reject}) {
  const player = find(observation.players, (p) => p.id === observation.selfId);
  submit({type:'idle'});
  const self = freeze({
    id: player.id, slot: player.slot, position: player.position, spawn: player.spawn, area: player.area,
    move(direction) {
      if (direction !== 'up' && direction !== 'right' && direction !== 'down' && direction !== 'left') {
        reject('Direction must be up, right, down or left');
      }
      submit({type:'move', direction});
    },
    idle() { submit({type:'idle'}); }
  });
  return freeze({
    tick: observation.tick, maxTicks: observation.maxTicks,
    board: observation.board, zone: observation.zone, self,
    opponents: freeze(filter(observation.players, (p) => p.id !== observation.selfId)),
    eliminated: observation.eliminated, events: observation.events
  });
}
`;
