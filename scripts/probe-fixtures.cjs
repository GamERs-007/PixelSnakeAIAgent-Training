const fs=require('node:fs'),path=require('node:path');
const {directions,getCollisionCause,getLegalActions}=require('../js/game.js');
const {SafetyGuard,cycleSpan}=require('../js/safety.js');
const folder=path.resolve('results/full_recheck_2026_09_15/fixtures');
for(const file of fs.readdirSync(folder)){
 const s=JSON.parse(fs.readFileSync(path.join(folder,file))),guard=new SafetyGuard({denseBoardSweep:true});let ate=false,locked=false;
 for(let t=0;t<1600;t++){
  const action=guard.choose(s,'RIGHT');
  if(!getLegalActions(s).includes(action)||getCollisionCause(s,action))throw Error(file+' collision');
  locked ||= guard.lastReason==='fill';
  const d=directions[action],p={x:s.snake[0].x+d.x,y:s.snake[0].y+d.y};
  s.snake.unshift(p);s.direction=d;s.steps++;
  if(p.x===s.food.x&&p.y===s.food.y){ate=t+1;break;}s.snake.pop();
 }
 console.log(file,JSON.stringify({ate,locked,span:cycleSpan(s)}));
}
