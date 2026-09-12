// Reproducible comparison of raw and assisted browser policies. No RL training.
const {SnakeGame}=require('../js/game.js');
const {RandomAgent,HeuristicAgent}=require('../js/agents.js');
const {AssistedAgent}=require('../js/safety.js');
const episodes=Number(process.argv[2]||20),maxSteps=Number(process.argv[3]||3000);
if(!Number.isSafeInteger(episodes)||episodes<1||!Number.isSafeInteger(maxSteps)||maxSteps<1)throw Error('Positive episode/step counts required');
const results=[];
for(const Policy of [RandomAgent,HeuristicAgent]) for(const assisted of [false,true]){
 const rows=[];
 for(let episode=0;episode<episodes;episode++){
  const seed='safety-'+episode,game=new SnakeGame({seed}),raw=new Policy({seed:'agent-'+episode});
  const agent=assisted?new AssistedAgent(raw):raw;
  for(let step=0;step<maxSteps&&!game.isGameOver();step++)game.step(agent.chooseAction(game.getState()));
  const state=game.getState();rows.push({episode:episode+1,seed,score:state.score,steps:state.steps,
    cause:state.causeOfDeath,step_limit:state.alive,overrides:agent.guard?.overrides||0});
 }
 results.push({policy:Policy.name,assisted,mean_score:rows.reduce((a,r)=>a+r.score,0)/episodes,
    mean_steps:rows.reduce((a,r)=>a+r.steps,0)/episodes,collisions:rows.filter(r=>r.cause).length,
    step_limits:rows.filter(r=>r.step_limit).length,episodes:rows});
}
console.log(JSON.stringify({episodes,max_steps:maxSteps,results},null,2));
