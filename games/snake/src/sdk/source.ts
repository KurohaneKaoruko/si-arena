/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const SNAKE_SDK_SOURCE = String.raw`
const freeze = Object.freeze;
const find = Function.prototype.call.bind(Array.prototype.find);
const filter = Function.prototype.call.bind(Array.prototype.filter);
export default function createGame(observation, {submit, reject}) {
  const snake = find(observation.snakes, (s) => s.id === observation.selfId);
  submit({type:'move', direction: snake.heading});
  const self = freeze({
    id: snake.id, slot: snake.slot, body: snake.body, head: snake.head, length: snake.length,
    health: snake.health, heading: snake.heading,
    move(direction) {
      if (direction !== 'up' && direction !== 'right' && direction !== 'down' && direction !== 'left') {
        reject('Direction must be up, right, down or left');
      }
      submit({type:'move', direction});
    }
  });
  return freeze({
    tick: observation.tick, maxTicks: observation.maxTicks,
    board: observation.board, self,
    opponents: freeze(filter(observation.snakes, (s) => s.id !== observation.selfId)),
    eliminated: observation.eliminated, food: observation.food, events: observation.events
  });
}
`;
