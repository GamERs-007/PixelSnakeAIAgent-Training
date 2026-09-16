const fs=require('node:fs');
const {SnakeGame}=require('./js/game.js');
const {BrowserDQNAgent,DenseQNetwork}=require('./js/dqn-agent.js');
const {AssistedAgent}=require(process.argv[2] || './js/safety.js');
(async()=>{
  const {models}=await (await fetch('http://127.0.0.1:8765/api/models')).json();
  const model=models.find(m=>m.name.endsWith('/2300_fill50_model.pt'));
  if(!model)throw Error('Missing fill50 variant');
  const response=await fetch('http://127.0.0.1:8765/api/dqn/model',{method:'POST',headers:{'Content-Type':'application/json','X-Snake-Client':'1'},body:JSON.stringify({model:model.name})});
  if(!response.ok) throw Error(`HTTP ${response.status}`);
  const payload=await response.json();
  for(const seed of (process.argv.slice(3).length ? process.argv.slice(3).map(Number) : [42])) {
    const game=new SnakeGame({seed}),raw=new BrowserDQNAgent({model:()=> 'variant'});
    raw.network=new DenseQNetwork(payload);raw.loadedModel='variant';
    const agent=new AssistedAgent(raw);let progress=0,peakStall=0;
    for(let i=0;i<100000&&!game.isGameOver();i++){
      const before=game.getState(),action=agent.chooseAction(before);
      game.step(action);const after=game.getState();
      if(after.score!==before.score) progress=after.steps;
      peakStall=Math.max(peakStall,after.steps-progress);
      if(after.steps-progress>(Number(process.env.SNAKE_STALL_LIMIT)||1200)) {
        fs.writeFileSync(`stalled-seed-${seed}.json`,JSON.stringify(after));break;
      }
    }
    const s=game.getState();
    console.log(JSON.stringify({seed,steps:s.steps,length:s.snake.length,won:s.won,death:s.causeOfDeath,peakStall}));
  }
})().catch(e=>{console.error(e);process.exitCode=1});
