/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const PAPER_SDK_SOURCE = String.raw`
const freeze = Object.freeze;
export default function createGame(observation, {submit, reject}) {
  const player = observation.players[observation.selfSlot];
  submit({type:'idle'});
  const self = freeze({
    id: player.id, slot: player.slot, position: player.position, spawn: player.spawn,
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
    board: observation.board, self,
    opponent: observation.players[1-observation.selfSlot], events: observation.events
  });
}
`;
