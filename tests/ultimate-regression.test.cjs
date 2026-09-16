const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {directions,getLegalActions,getCollisionCause}=require('../js/game.js');
const safety=require(process.env.SNAKE_SAFETY_SOURCE?path.resolve(process.env.SNAKE_SAFETY_SOURCE):'../js/safety.js');
const {SafetyGuard,cycleSpan,fillAction}=safety;
function route(n=20){const r=[{x:0,y:0}];for(let y=0;y<n;y++)for(let k=1;k<n;k++)r.push({x:y%2?n-k:k,y});for(let y=n-1;y>0;y--)r.push({x:0,y});return r;}
const cells=route(),index=new Map(cells.map((p,i)=>[`${p.x},${p.y}`,i]));
function snapshot(length,head,food){const snake=Array.from({length},(_,i)=>({...cells[(head-i+400)%400]}));return {size:20,snake,food:cells[food],direction:{x:snake[0].x-snake[1].x,y:snake[0].y-snake[1].y},alive:true,won:false,foodCollected:length-3,steps:0};}
function step(s,a){
 assert.ok(getLegalActions(s).includes(a));assert.equal(getCollisionCause(s,a),null);
 const d=directions[a],head={x:s.snake[0].x+d.x,y:s.snake[0].y+d.y};s.snake.unshift(head);s.direction=d;s.steps++;
 const ate=s.food&&head.x===s.food.x&&head.y===s.food.y;
 if(ate){s.foodCollected++;s.food=null;if(s.snake.length===400){s.alive=false;s.won=true;}}else s.snake.pop();
 return ate;
}
for(const length of [201,250,300,350,399])test(`ordered invariants at length ${length}: every free food cell and five head positions`,()=>{
 for(const head of [0,19,190,250,397])for(let gap=1;gap<=400-length;gap++){
  const s=snapshot(length,head,(head+gap)%400),g=new SafetyGuard({denseBoardSweep:true});let ate=false;const seen=new Set();
  for(let t=0;t<400;t++){
   const signature=JSON.stringify(s.snake);assert.ok(!seen.has(signature));seen.add(signature);
   const old=index.get(`${s.snake[0].x},${s.snake[0].y}`),a=g.choose(s,'UP');
   assert.equal(a,fillAction(s));assert.equal(g.telemetry.mode,'ordered');
   assert.equal(g.telemetry.repeated_ordered_state,false);assert.equal(g.telemetry.unexpected_fallback,false);
   ate=step(s,a);assert.equal(index.get(`${s.snake[0].x},${s.snake[0].y}`),(old+1)%400);assert.ok(cycleSpan(s)<400);
   if(ate)break;
  }
  assert.ok(ate);assert.equal(s.snake.length,length+1);
 }
});
test('twenty-five aligned dense starts complete with changing distant food, including wraparound',()=>{
 for(const length of [201,250,300,350,399])for(const head of [0,19,190,250,397]){
  const s=snapshot(length,head,(head+400-length)%400),g=new SafetyGuard({denseBoardSweep:true});
  while(s.alive){
   assert.equal(g.choose(s,'UP'),fillAction(s));
   if(step(s,fillAction(s))&&s.alive){const h=index.get(`${s.snake[0].x},${s.snake[0].y}`);s.food=cells[(h+400-s.snake.length)%400];}
   assert.ok(s.steps<50000);assert.ok(cycleSpan(s)<400);
  }
  assert.equal(s.won,true);assert.equal(new Set(s.snake.map(p=>`${p.x},${p.y}`)).size,400);
  g.choose(s,'RIGHT');assert.equal(g.telemetry.mode,'terminal');assert.equal(g.telemetry.board_full,true);
 }
});
test('departing tail is legal on a non-growing full cycle; growth into occupied tail is rejected',()=>{
 const s=snapshot(400,397,0);s.food=null;
 const a=fillAction(s);assert.equal(getCollisionCause(s,a),null);
 const g=new SafetyGuard({denseBoardSweep:true});assert.equal(g.choose(s,'RIGHT'),a);step(s,a);assert.ok(cycleSpan(s)<400);
 s.food=s.snake.at(-1);assert.equal(getCollisionCause(s,fillAction(s)),'self');
});
test('recorded seed 10 completes instead of repeating an unordered recovery cycle',()=>{
 const {SnakeGame}=require('../js/game.js'),{BrowserDQNAgent,DenseQNetwork}=require('../js/dqn-agent.js');
 const game=new SnakeGame({seed:10}),g=new SafetyGuard({denseBoardSweep:true}),p=new BrowserDQNAgent({model:()=>'Ultimate'});
 p.network=new DenseQNetwork(JSON.parse(fs.readFileSync(path.join(__dirname,'../results/full_recheck_2026_09_15/ultimate_weights.json'))));p.loadedModel='Ultimate';
 let lastFood=0,locked=false;
 while(!game.isGameOver()&&game.getState().steps<50000){
  const s=game.getState(),a=g.choose(s,p.chooseAction(s));
  if(g.lastReason==='fill'){locked=true;assert.ok(cycleSpan(s)<400);}
  const n=game.step(a);assert.equal(n.causeOfDeath,null);
  if(n.foodCollected!==s.foodCollected)lastFood=n.steps;
  if(n.steps-lastFood>=10000)break;
 }
 assert.equal(game.getState().won,true,'the original seed-10 recovery loop must be prevented');
 assert.ok(locked);
});
test('legacy near-full failures remain collision-free recovery, never a false lock',()=>{
 const s=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/ultimate-repeat-10.json'))),g=new SafetyGuard({denseBoardSweep:true});
 for(let t=0;t<800;t++){
  const a=g.choose(s,'RIGHT');
  if(cycleSpan(s)>=400)assert.equal(g.telemetry.mode,'recovery');
  if(step(s,a))break;
 }
});
test('reset and pending inference do not carry stale ordered or recovery telemetry',()=>{
 const s=snapshot(201,250,251),g=new SafetyGuard({denseBoardSweep:true});g.choose(s,'UP');g.reset();
 assert.equal(g.filling,false);assert.equal(g.recoverySeen.size,0);assert.equal(g.orderedSeen.size,0);
 const before=JSON.stringify(g.telemetry);assert.equal(g.choose(s,null),null);assert.equal(JSON.stringify(g.telemetry),before);
});
