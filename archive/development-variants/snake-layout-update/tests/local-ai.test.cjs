const test=require('node:test');
const assert=require('node:assert/strict');
const {SnakeGame,getCollisionCause}=require('../js/game.js');
const {EpisodeRunner}=require('../js/episode.js');
const {RemoteAgent}=require('../js/local-ai.js');
const {SafetyGuard,AssistedAgent,assess}=require('../js/safety.js');
const {HeuristicAgent}=require('../js/agents.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('inference waits without stepping, then executes exactly one returned action',async()=>{
 let resolve,calls=0;
 const agent=new RemoteAgent({type:'dqn',requestFn:()=>{calls++;return new Promise(r=>resolve=r);}});
 const runner=new EpisodeRunner({agent});runner.reset();
 runner.step();runner.step();assert.equal(runner.game.getState().steps,0);assert.equal(calls,1);
 resolve({action:'UP',latency_ms:1});await flush();runner.step();
 assert.equal(runner.game.getState().steps,1);assert.equal(runner.game.getState().direction.y,-1);
 runner.step();assert.equal(runner.game.getState().steps,1);assert.equal(calls,2);
 agent.reset();
});
test('reset rejects a stale response and invalid reverse action cannot move snake',async()=>{
 const pending=[],status=[];
 const agent=new RemoteAgent({type:'qwen',onStatus:m=>status.push(m),requestFn:()=>new Promise(r=>pending.push(r))});
 const game=new SnakeGame();agent.chooseAction(game.getState());agent.reset();
 pending[0]({action:'UP'});await flush();assert.equal(agent.ready,null);
 agent.chooseAction(game.getState());pending[1]({action:'LEFT'});await flush();
 assert.equal(agent.ready,null);assert.equal(status.at(-1).state,'error');assert.equal(game.getState().steps,0);
});
test('synchronous batch runner fails clearly rather than spinning on a pending agent',()=>{
 const runner=new EpisodeRunner({agent:{chooseAction:()=>null}});runner.reset();
 assert.throws(()=>runner.run(10),/asynchronous/);
});
test('safety avoids immediate danger, respects vacating tail and can be disabled',()=>{
 const state={...new SnakeGame().getState(),snake:[{x:19,y:10},{x:18,y:10},{x:17,y:10}],direction:{x:1,y:0}};
 const guard=new SafetyGuard();const action=guard.choose(state,'RIGHT');
 assert.notEqual(action,'RIGHT');assert.equal(getCollisionCause(state,action),null);
 assert.equal(new AssistedAgent({chooseAction:()=> 'RIGHT'},()=>false).chooseAction(state),'RIGHT');
 const tail={...state,snake:[{x:1,y:1},{x:1,y:2},{x:2,y:2},{x:2,y:1}],direction:{x:0,y:-1},food:{x:4,y:4}};
 assert.equal(assess(tail,'RIGHT').safe,true);
});
test('safety breaks repeated four-turn loops',()=>{
 const game=new SnakeGame({seed:7}),guard=new SafetyGuard(),visited=new Set();
 for(let i=0;i<30;i++){
  const state=game.getState(),heads=['UP','RIGHT','DOWN','LEFT'];
  const direction=heads.findIndex(a=>require('../js/game.js').directions[a].x===state.direction.x&&require('../js/game.js').directions[a].y===state.direction.y);
  game.step(guard.choose(state,heads[(direction+1)%4]));visited.add(JSON.stringify(game.getState().snake[0]));
 }
 assert.ok(visited.size>4);assert.ok(guard.overrides>0);assert.equal(game.isGameOver(),false);
});
test('space assistance reduces collisions on fixed seeded heuristic episodes',()=>{
 let deathsRaw=0,deathsHelped=0;
 for(let seed=0;seed<4;seed++) for(const helped of [false,true]){
  const game=new SnakeGame({seed:'safety-'+seed}),raw=new HeuristicAgent(),agent=helped?new AssistedAgent(raw):raw;
  for(let step=0;step<1500&&!game.isGameOver();step++)game.step(agent.chooseAction(game.getState()));
  if(game.isGameOver()){if(helped)deathsHelped++;else deathsRaw++;}
 }
 assert.ok(deathsHelped<deathsRaw);
});


test('assistance commits to a safe shortest food path instead of repeated turns',()=>{
 const {safeFoodPath}=require('../js/safety.js');
 const state={...new SnakeGame().getState(),food:{x:13,y:10}};
 const plan=safeFoodPath(state);assert.deepEqual(plan.map(p=>p.action),['RIGHT','RIGHT','RIGHT','RIGHT']);
 const guard=new SafetyGuard();assert.equal(guard.choose(state,'UP'),'RIGHT');
 assert.equal(guard.lastReason,'food_path');
});
test('food planner rejects an edible pocket with no exit after growth',()=>{
 const {safeFoodPath}=require('../js/safety.js');
 const state={...new SnakeGame().getState(),size:6,direction:{x:0,y:-1},food:{x:1,y:2},
  snake:[[2,2],[2,3],[1,3],[0,3],[0,2],[0,1],[1,1],[2,1],[3,1],[3,2],[3,3],[3,4]].map(([x,y])=>({x,y}))};
 assert.equal(getCollisionCause(state,'LEFT'),null);
 assert.equal(safeFoodPath(state),null);
});
