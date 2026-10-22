/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const TANK_SDK_SOURCE = String.raw`
const freeze = Object.freeze;
const find = Function.prototype.call.bind(Array.prototype.find);
export default function createGame(observation, {submit, reject}) {
  const me = find(observation.tanks, (t) => t.id === observation.selfId);
  const other = find(observation.tanks, (t) => t.id !== observation.selfId);
  submit({type:'idle'});
  const self = freeze({
    id: me.id, slot: me.slot, position: me.position, facing: me.facing, hp: me.hp,
    bulletInFlight: me.bulletInFlight,
    move(direction) {
      if (direction !== 'up' && direction !== 'right' && direction !== 'down' && direction !== 'left') {
        reject('Direction must be up, right, down or left');
      }
      submit({type:'move', direction});
    },
    fire() { submit({type:'fire'}); },
    idle() { submit({type:'idle'}); }
  });
  return freeze({
    tick: observation.tick, maxTicks: observation.maxTicks,
    board: observation.board, bullets: observation.bullets, self,
    opponent: other === undefined ? null : other,
    eliminated: observation.eliminated, events: observation.events
  });
}
`;
