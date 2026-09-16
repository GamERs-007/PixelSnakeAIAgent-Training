const test = require('node:test');
const assert = require('node:assert/strict');
const {SnakeGame} = require('../js/game.js');
const {EpisodeRunner} = require('../js/episode.js');
const {BrowserDQNAgent, DenseQNetwork, observation} = require('../js/dqn-agent.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
function payload() {
  return {format:'snake-dqn-dense-v1', board_size:20, max_steps_without_food:400,
    layers:[{weights:[Array(10).fill(0)],bias:[0]}, {weights:[[0]],bias:[0]},
      {weights:[[0],[0],[0]],bias:[0,0,1]}]};
}

test('checkpoint rule follows the selected model and is cleared on switching', async () => {
  const {AssistedAgent}=require('../js/safety.js');
  let selected='fill.pt';
  const raw=new BrowserDQNAgent({model:()=>selected,requestFn:async()=>selected==='fill.pt'
    ? {...payload(),inference_rules:{dense_board_sweep_above_half:true}} : payload()});
  const assisted=new AssistedAgent(raw),state=new SnakeGame().getState();
  assisted.chooseAction(state);await flush();assisted.chooseAction(state);
  assert.equal(raw.denseBoardSweepEnabled,true);
  assert.equal(assisted.guard.denseBoardSweep,true);
  selected='original.pt';assisted.chooseAction(state);
  assert.equal(raw.denseBoardSweepEnabled,false);
  assert.equal(assisted.guard.denseBoardSweep,false);
  await flush();assisted.chooseAction(state);
  assert.equal(raw.denseBoardSweepEnabled,false);
});
test('loaded DQN executes many steps synchronously without per-step requests', async () => {
  let calls = 0;
  const agent = new BrowserDQNAgent({model:()=> 'one.pt',requestFn:async path=> {
    assert.equal(path,'/api/dqn/model'); calls++; return payload();
  }});
  const runner = new EpisodeRunner({game:new SnakeGame({seed:17}),agent});
  runner.reset(); runner.step(); assert.equal(runner.game.getState().steps,0);
  await flush();
  for (let i=0;i<100;i++) runner.step();
  assert.equal(runner.game.getState().steps,100); assert.equal(calls,1);
  agent.reset(); runner.reset(); runner.step();
  assert.equal(runner.game.getState().steps,1); assert.equal(calls,1);
});
test('model changes, invalidation and stale downloads cannot execute an old policy', async () => {
  let name='one.pt'; const pending=[];
  const agent=new BrowserDQNAgent({model:()=>name,requestFn:()=>new Promise(r=>pending.push(r))});
  const state=new SnakeGame().getState();
  agent.chooseAction(state); agent.reset(); name='two.pt'; agent.chooseAction(state);
  pending[0](payload()); await flush(); assert.equal(agent.network,null);
  pending[1](payload()); await flush(); assert.equal(agent.chooseAction(state),'DOWN');
  name='three.pt'; assert.equal(agent.chooseAction(state),null);
  agent.invalidate(); pending[2](payload()); await flush(); assert.equal(agent.network,null);
});
test('malformed weights wait with an error, rather than advancing the engine', async () => {
  const errors=[], bad=payload(); bad.layers[2].bias[0]=Infinity;
  const agent=new BrowserDQNAgent({requestFn:async()=>bad,onStatus:m=>errors.push(m)});
  const runner=new EpisodeRunner({agent}); runner.reset(); runner.step(); await flush(); runner.step();
  assert.equal(runner.game.getState().steps,0); assert.equal(errors.at(-1).state,'error');
  assert.throws(()=>new DenseQNetwork({...payload(),board_size:10}),/Unsupported/);
  const malformed=payload(); malformed.layers[0].weights[0].pop();
  assert.throws(()=>new DenseQNetwork(malformed),/Invalid/);
});
test('relative actions cannot reverse, no-food counter survives pause and resets after food', async () => {
  const agent=new BrowserDQNAgent({requestFn:async()=>payload()}), state=new SnakeGame().getState();
  agent.chooseAction(state); await flush();
  for(const direction of [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}]) {
    const s={...state,direction};
    assert.ok(require('../js/game.js').getLegalActions(s).includes(agent.chooseAction(s)));
  }
  agent.chooseAction({...state,steps:20,foodCollected:1});
  agent.cancel(); assert.equal(agent.lastFoodStep,20);
  let seen; agent.network.forward=o=>{seen=Array.from(o);return [1,0,0]};
  agent.chooseAction({...state,steps:30,foodCollected:1}); assert.equal(seen[9],Math.fround(10/400));
  agent.chooseAction({...state,steps:31,foodCollected:2}); assert.equal(seen[9],0);
  agent.reset(); assert.equal(agent.lastFoodStep,0);
  assert.equal(observation({...state,steps:500},500)[9],1);
});
test('Q network applies ReLU only to hidden layers and takes the first maximum', async () => {
  const p=payload(); p.layers[0].bias=[-5];p.layers[1].weights=[[1]];p.layers[1].bias=[2];
  p.layers[2]={weights:[[-1],[-2],[0]],bias:[0,0,-10]};
  assert.deepEqual(Array.from(new DenseQNetwork(p).forward(new Float32Array(10))),[-2,-4,-10]);
  p.layers[2]={weights:[[0],[0],[0]],bias:[2,2,2]};
  const agent=new BrowserDQNAgent({requestFn:async()=>p}), state=new SnakeGame().getState();
  agent.chooseAction(state);await flush();assert.equal(agent.chooseAction(state),'RIGHT');
});
