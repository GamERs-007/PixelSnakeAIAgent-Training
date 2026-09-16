// Real production engine/policies; separate browser protocol from Gymnasium.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {SnakeGame,directions}=require('../js/game.js');
const {RandomAgent,HeuristicAgent}=require('../js/agents.js');
const {BrowserDQNAgent,DenseQNetwork}=require('../js/dqn-agent.js');
const safety=require(process.env.SNAKE_SAFETY_SOURCE ? path.resolve(process.env.SNAKE_SAFETY_SOURCE) : '../js/safety.js');
const {SafetyGuard,cycleSpan}=safety;
const out=path.resolve(process.argv[2]||'results/full_recheck_2026_09_15');
const mode=process.argv[3]||'safety',tag=process.argv[4]||'current';
const protocol=JSON.parse(fs.readFileSync(path.join(out,'protocol.json'),'utf8'));
function makePolicy(name,seed){
  if(name==='Random')return new RandomAgent({seed});
  if(name==='Heuristic')return new HeuristicAgent();
  const payload=JSON.parse(fs.readFileSync(path.join(out,name.toLowerCase()+'_weights.json'),'utf8'));
  const policy=new BrowserDQNAgent({model:()=>name});
  policy.network=new DenseQNetwork(payload);policy.loadedModel=name;return policy;
}
function index(p,n=20){return p.x===0 ? (p.y===0?0:n*n-p.y) : 1+p.y*(n-1)+(p.y%2?n-1-p.x:p.x-1);}
function run(name,seed,assistance,limit,actionSeed){
  const game=new SnakeGame({seed}),policy=makePolicy(name,actionSeed),guard=new SafetyGuard({denseBoardSweep:name==='Ultimate'});
  let transition=null,maxDecisionMs=0;
  let turns=0,lastFoodStep=0,requested=null,locked=null,orderedSteps=0,joinSteps=0,repeats=0,maxCycle=0,orderedRepeats=0,unexpected=0,progressErrors=0,maxLength=3;
  const seen=new Map(),trace=[];let reason=null,firstRepeated=null;
  const started=performance.now();
  while(!game.isGameOver()&&game.getState().steps<limit){
    const s=game.getState(),foodKey=s.food?`${s.food.x},${s.food.y}`:'none';
    const signature=JSON.stringify([s.snake,s.direction,foodKey]);
    const repeated=seen.has(signature);
    if(repeated){
      repeats++;maxCycle=Math.max(maxCycle,s.steps-seen.get(signature));
      if(!firstRepeated&&s.snake.length>200){firstRepeated={...s};}
    }
    seen.set(signature,s.steps);
    if(name==='Ultimate'&&s.snake.length>200&&!transition)transition=s;
    const decisionStarted=performance.now();
    const proposed=policy.chooseAction(s),action=assistance?guard.choose(s,proposed):proposed;
    maxDecisionMs=Math.max(maxDecisionMs,performance.now()-decisionStarted);
    const dense=assistance&&name==='Ultimate'&&s.snake.length>200;
    const isOrdered=dense&&(guard.telemetry ? guard.telemetry.mode==='ordered' : guard.lastReason==='fill');
    if(dense&&requested===null)requested=s.steps;
    if(isOrdered&&locked===null)locked=s.steps;
    if(dense){if(isOrdered)orderedSteps++;else joinSteps++;}
    if(isOrdered&&repeated)orderedRepeats++;
    if(guard.telemetry?.unexpected_fallback)unexpected++;
    const direction=directions[action];
    if(direction.x!==s.direction.x||direction.y!==s.direction.y)turns++;
    const next=game.step(action),advance=(index(next.snake[0])-index(s.snake[0])+400)%400;
    if(isOrdered&&next.alive&&advance!==1)progressErrors++;
    maxLength=Math.max(maxLength,next.snake.length);
    if(next.foodCollected!==s.foodCollected){lastFoodStep=next.steps;seen.clear();}
    if(name==='Ultimate'&&(next.steps%100===0||next.foodCollected!==s.foodCollected||dense&&(requested===s.steps||locked===s.steps))){
      trace.push({step:next.steps,score:next.score,length:next.snake.length,occupancy:next.snake.length/4,mode:isOrdered?'ordered':dense?'recovery':'food',index:index(s.snake[0]),advance,span:cycleSpan(s)});
    }
    if(isOrdered&&next.alive&&next.steps-Math.max(lastFoodStep,locked)>=protocol.ultimate.locked_no_food_bug_threshold){reason='ordered_no_progress_bug';break;}
    if(name==='Ultimate'&&next.alive&&next.steps-lastFoodStep>=protocol.ultimate.no_food_limit){reason='no_food_limit';break;}
  }
  const s=game.getState(),elapsed=(performance.now()-started)/1000;
  const record={policy:name,seed,assistance,score:s.score,food_collected:s.foodCollected,steps:s.steps,steps_survived:s.stepsSurvived,turn_ratio:turns/Math.max(1,s.steps),terminated:!s.alive,truncated:s.alive,won:s.won,end_reason:s.won?'board_full':s.causeOfDeath||reason||'evaluation_step_limit',max_length:maxLength,max_occupancy_percent:maxLength/4,reached_half:maxLength>200,ordered_requested_step:requested,ordered_locked_step:locked,ordered_steps:orderedSteps,recovery_steps:joinSteps,repeated_states:repeats,max_repeated_cycle_length:maxCycle,repeated_ordered_states:orderedRepeats,unexpected_ordered_fallbacks:unexpected,ordered_progress_errors:progressErrors,collision_after_requested:Boolean(s.causeOfDeath&&requested!==null),collision_after_locked:Boolean(s.causeOfDeath&&locked!==null),no_food_after_requested:reason==='no_food_limit'&&requested!==null,steps_half_to_win:s.won&&requested!==null?s.steps-requested:null,elapsed_seconds:elapsed,overrides:guard.overrides};
  record.max_decision_ms=maxDecisionMs;
  return {record,trace,firstRepeated,transition};
}
const destination=path.join(out,`${mode}_${tag}.json`);
if(fs.existsSync(destination))throw Error('Refusing to overwrite '+destination);
const records=[],traces={};
const conditions=mode==='ultimate'?['Ultimate']:protocol.safety.policies;
for(const name of conditions)for(const assistance of mode==='ultimate'?[true]:[false,true]){
  const seeds=mode==='ultimate'?protocol.ultimate.seeds:protocol.safety.seeds;
  for(let i=0;i<seeds.length;i++){
    const result=run(name,seeds[i],assistance,mode==='ultimate'?protocol.ultimate.max_steps:protocol.safety.max_steps,protocol.safety.action_seeds[i]);
    records.push(result.record);
    if(mode==='ultimate')traces[String(seeds[i])]=result.trace;
    if(tag==='before'&&result.firstRepeated){const file=path.join(out,'fixtures',`repeat-seed-${seeds[i]}.json`);if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(result.firstRepeated,null,2));}
    if(tag==='before_checked'&&result.transition){const file=path.join(out,'fixtures',`transition-seed-${seeds[i]}.json`);if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(result.transition,null,2));}
    fs.writeFileSync(destination,JSON.stringify({mode,tag,complete:false,records,traces},null,2));
    console.log(JSON.stringify(result.record));
  }
}
fs.writeFileSync(destination,JSON.stringify({mode,tag,complete:true,records,traces},null,2));
