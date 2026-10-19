/** Trusted self-contained guest ESM. No host functions are injected into QuickJS. */
export const PAPER_SDK_SOURCE = String.raw`
const directions = ['up','right','down','left'];
const deltas = [[0,-1],[1,0],[0,1],[-1,0]];
function index(x,y,o) { return y*o.width+x; }
function next(cell,d,o) {
  const x=cell%o.width+deltas[d][0], y=(cell/o.width|0)+deltas[d][1];
  return x<0||y<0||x>=o.width||y>=o.height ? -1 : index(x,y,o);
}
function self(o) { return o.players[o.selfSlot]; }
function homePath(o) {
  const p=self(o); if(!p.position)return null;
  const start=index(p.position.x,p.position.y,o);
  if(o.territory[start]===o.selfSlot)return [];
  const seen=new Uint8Array(o.width*o.height), parent=new Int32Array(seen.length), move=new Int8Array(seen.length);
  const queue=[start];seen[start]=1;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const cell=queue[cursor];
    for(let d=0;d<4;d++) {
      const target=next(cell,d,o);
      if(target<0||seen[target]||o.trails[target]===o.selfSlot)continue;
      seen[target]=1;parent[target]=cell;move[target]=d;
      if(o.territory[target]===o.selfSlot) {
        const path=[];let current=target;
        while(current!==start){path.push(directions[move[current]]);current=parent[current];}
        return path.reverse();
      }
      queue.push(target);
    }
  }
  return null;
}
function threatDistance(o) {
  const enemy=o.players[1-o.selfSlot];if(!enemy.alive||!enemy.position)return null;
  const start=index(enemy.position.x,enemy.position.y,o), distance=new Int32Array(o.width*o.height);distance.fill(-1);
  const queue=[start];distance[start]=0;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const cell=queue[cursor];
    if(o.trails[cell]===o.selfSlot)return distance[cell];
    for(let d=0;d<4;d++) {
      const target=next(cell,d,o);
      if(target<0||distance[target]>=0||o.trails[target]===enemy.slot)continue;
      distance[target]=distance[cell]+1;queue.push(target);
    }
  }
  return null;
}
function safeMoves(o) {
  const p=self(o);if(!p.position)return [];
  const start=index(p.position.x,p.position.y,o), enemy=o.players[1-o.selfSlot];
  const result=[];
  for(let d=0;d<4;d++) {
    const target=next(start,d,o);
    if(target<0||o.trails[target]===o.selfSlot)continue;
    if(enemy.alive&&enemy.position&&target===index(enemy.position.x,enemy.position.y,o))continue;
    result.push(directions[d]);
  }
  return result;
}
function expansion(o) {
  const p=self(o);if(!p.position)return [];
  const start=index(p.position.x,p.position.y,o);let best=[],bestScore=0;
  for(let direction=0;direction<4;direction++)for(const turn of [1,3])for(const width of [4,6])for(const height of [3,5]) {
    const route=[],cells=new Set();let cell=start,valid=true,score=0;
    const sides=[[direction,width],[(direction+turn)%4,height],[(direction+2)%4,width],[(direction+turn+2)%4,height]];
    for(const [d,length] of sides)for(let n=0;n<length;n++) {
      cell=next(cell,d,o);
      if(cell<0||(cells.has(cell)&&cell!==start)){valid=false;break;}
      cells.add(cell);route.push(directions[d]);
      if(o.territory[cell]!==o.selfSlot)score++;
    }
    if(valid&&cell===start&&score>bestScore){bestScore=score;best=route;}
  }
  return best;
}
export default Object.freeze({directions:Object.freeze(directions),homePath,threatDistance,safeMoves,expansion});
`;
