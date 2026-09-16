const test=require('node:test');
const assert=require('node:assert/strict');
const {SnakeGame,directions,getLegalActions,getCollisionCause}=require('../js/game.js');
const {SafetyGuard,AssistedAgent,fillAction,cycleSpan}=require('../js/safety.js');

// Independent reference for the user's drawing: rows, then up the left column.
function route(size) {
  const cells=[{x:0,y:0}];
  for(let y=0;y<size;y++) for(let i=1;i<size;i++) cells.push({x:y%2 ? size-i : i,y});
  for(let y=size-1;y>0;y--) cells.push({x:0,y});
  return cells;
}
function snapshot(length,head=250,reversed=false) {
  const cells=route(20), sign=reversed ? 1 : -1;
  const snake=Array.from({length},(_,i)=>({...cells[(head+sign*i+800)%400]}));
  return {size:20,snake,direction:{x:snake[0].x-snake[1].x,y:snake[0].y-snake[1].y},
    alive:true,food:cells[(head-sign+400)%400],foodCollected:length-3,score:(length-3)*10,steps:500};
}

test('sweep matches the drawing and visits every cell exactly once before closing',()=>{
  for(const size of [6,20]) {
    const cells=route(size);
    assert.equal(new Set(cells.map(p=>`${p.x},${p.y}`)).size,size*size);
    for(let i=0;i<cells.length;i++) {
      const d=directions[fillAction({size,snake:[cells[i]]})];
      assert.deepEqual({x:cells[i].x+d.x,y:cells[i].y+d.y},cells[(i+1)%cells.length]);
    }
  }
});

test('below 60%, nearby food uses the shortest safe path instead of a cycle detour',()=>{
  const guard=new SafetyGuard({denseBoardSweep:true});
  const state={...new SnakeGame().getState(),food:{x:9,y:9}};
  // Row 10's eventual sweep goes RIGHT, but the food is one safe step UP.
  assert.equal(fillAction(state),'RIGHT');
  assert.equal(guard.choose(state,'RIGHT'),'UP');
  assert.equal(guard.filling,false);
  assert.equal(guard.lastReason,'food_path');
});

test('exactly 60% still follows a safe food plan without enforcing cyclic order',()=>{
  const state=snapshot(240,250,true),guard=new SafetyGuard({denseBoardSweep:true});
  const plan=require('../js/safety.js').safeFoodPath(state);
  assert.ok(plan?.length);
  assert.equal(guard.choose(state,fillAction(state)),plan[0].action);
  assert.equal(guard.filling,false);
});

test('strictly more than 60% triggers the sweep, regardless of score stagnation',()=>{
  const guard=new SafetyGuard({denseBoardSweep:true});
  for(const length of [239,240,241]) {
    const state=snapshot(length);
    guard.choose(state,'UP');
    assert.equal(guard.filling,length>240);
    if(length>240) assert.equal(guard.lastReason,'fill');
  }
  guard.reset();
  assert.equal(guard.filling,false);
  guard.choose(snapshot(3),'RIGHT');
  assert.equal(guard.filling,false);
});

test('an aligned dense snake follows the cycle through growth to a full board',()=>{
  const guard=new SafetyGuard({denseBoardSweep:true}),state=snapshot(241,397),cells=route(20);
  let head=397;
  while(state.snake.length<400) {
    state.food=cells[(head+1)%400];
    const action=guard.choose(state,'UP');
    assert.equal(action,fillAction(state));
    assert.ok(getLegalActions(state).includes(action));
    assert.equal(getCollisionCause(state,action),null);
    const d=directions[action];
    state.snake.unshift({x:state.snake[0].x+d.x,y:state.snake[0].y+d.y});
    state.direction=d;state.steps++;state.score+=10;state.foodCollected++;head=(head+1)%400;
  }
  assert.equal(new Set(state.snake.map(p=>`${p.x},${p.y}`)).size,400);
});

test('joining never forces reversal or an immediate collision into the existing body',()=>{
  const guard=new SafetyGuard({denseBoardSweep:true}),state=snapshot(241,250,true);
  assert.ok(!getLegalActions(state).includes(fillAction(state)));
  const action=guard.choose(state,fillAction(state));
  assert.equal(guard.filling,true);
  assert.equal(guard.lastReason,'fill_join');
  assert.ok(getLegalActions(state).includes(action));
  assert.equal(getCollisionCause(state,action),null);
});

test('disabled assistance and pending inference keep their existing contracts',()=>{
  const state=snapshot(241),agent=new AssistedAgent({chooseAction:()=> 'UP'},()=>false);
  assert.equal(agent.chooseAction(state),'UP');
  assert.equal(agent.guard.filling,false);
  const guard=new SafetyGuard({denseBoardSweep:true});
  assert.equal(guard.choose(state,null),null);
  assert.equal(guard.choose(state,undefined),undefined);
});

test('recorded dense-board stalls unwind and reach their previously inaccessible food',()=>{
  for(const seed of [7,19]) {
    const state=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,`fixtures/fill-stall-${seed}.json`),'utf8'));
    const guard=new SafetyGuard({denseBoardSweep:true});
    assert.ok(cycleSpan(state)>=400,'fixture must contain a disordered body');
    let ate=false;
    for(let i=0;i<400;i++) {
      const preferred=Object.keys(directions).find(a=>directions[a].x===state.direction.x&&directions[a].y===state.direction.y);
      const action=guard.choose(state,preferred);
      assert.ok(getLegalActions(state).includes(action));
      assert.equal(getCollisionCause(state,action),null);
      const d=directions[action],head={x:state.snake[0].x+d.x,y:state.snake[0].y+d.y};
      state.snake.unshift(head);state.direction=d;state.steps++;
      if(head.x===state.food.x&&head.y===state.food.y){ate=true;break;}
      state.snake.pop();
    }
    assert.equal(ate,true,`seed ${seed} must escape its recorded loop`);
  }
});
