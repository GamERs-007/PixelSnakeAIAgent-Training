// Optional browser safety assistance. Raw policies remain available for benchmarks.
(function(root) {
  'use strict';
  const engine = typeof module === 'object' && module.exports ? require('./game.js') : root.SnakeEngine;
  const {directions, getLegalActions, getCollisionCause} = engine;
  const key = p => p.y * 20 + p.x;
  // Row-by-row cycle, reserving the left column for the return to the top.
  function fillAction(state) {
    if (state.size < 2 || state.size % 2) return null;
    const {x,y}=state.snake[0], edge=state.size-1;
    if (x===0) return y===0 ? 'RIGHT' : 'UP';
    if (y===edge) return 'LEFT';
    if (y%2===0) return x===edge ? 'DOWN' : 'RIGHT';
    return x===1 ? 'DOWN' : 'LEFT';
  }
  function cycleIndex(point, size) {
    if (point.x===0) return point.y===0 ? 0 : size*size-point.y;
    return 1+point.y*(size-1)+(point.y%2 ? size-1-point.x : point.x-1);
  }
  // Tail -> head must advance less than one lap in total. Checking only the
  // head's next cell cannot detect a body that already winds across the cycle.
  function cycleSpan(state) {
    const cells=state.size*state.size;
    let span=0;
    for(let i=state.snake.length-1;i>0;i--)
      span+=(cycleIndex(state.snake[i-1],state.size)-cycleIndex(state.snake[i],state.size)+cells)%cells;
    return span;
  }
  function orderedCycleAction(state, preferred, filling) {
    const cells=state.size*state.size, head=cycleIndex(state.snake[0],state.size);
    const tailGap=(cycleIndex(state.snake.at(-1),state.size)-head+cells)%cells;
    const foodGap=state.food ? (cycleIndex(state.food,state.size)-head+cells)%cells : cells;
    const options=getLegalActions(state).filter(action=>!getCollisionCause(state,action)).map(action=>{
      const d=directions[action],next={x:state.snake[0].x+d.x,y:state.snake[0].y+d.y};
      return {action,advance:(cycleIndex(next,state.size)-head+cells)%cells,
        eating:state.food && key(next)===key(state.food)};
    }).filter(o=>o.advance>0 && (o.eating ? o.advance<tailGap : o.advance<=tailGap)
      && (filling ? o.action===fillAction(state) : o.advance<=foodGap));
    // The sweep starts only above 60%; shorter snakes use safeFoodPath.
    // Never overtake the tail; the active sweep does not take shortcuts.
    return (options.find(o=>o.action===preferred) || options.sort((a,b)=>b.advance-a.advance)[0])?.action;
  }
  function assess(state, action) {
    if (getCollisionCause(state, action)) return {action, safe:false, area:0, tail:false, foodDistance:Infinity};
    const d = directions[action], head = {x:state.snake[0].x+d.x, y:state.snake[0].y+d.y};
    const eating = state.food && key(head) === key(state.food);
    const snake = [head, ...state.snake];
    if (!eating) snake.pop();
    if (snake.length === state.size * state.size) return {action,head,safe:true,area:snake.length,tail:true,foodDistance:0};
    // Treat the new tail as passable: it vacates on the following non-eating move.
    const blocked = new Set(snake.slice(1,-1).map(key));
    const queue = [[head,0]], seen = new Set([key(head)]);
    let foodDistance = eating ? 0 : Infinity;
    for (let i=0; i<queue.length; i++) {
      const [point,distance] = queue[i];
      if (state.food && key(point) === key(state.food)) foodDistance = Math.min(foodDistance,distance);
      for (const vector of Object.values(directions)) {
        const next = {x:point.x+vector.x,y:point.y+vector.y}, k = key(next);
        if (next.x<0 || next.y<0 || next.x>=state.size || next.y>=state.size || blocked.has(k) || seen.has(k)) continue;
        seen.add(k); queue.push([next,distance+1]);
      }
    }
    return {action,head,safe:true,area:seen.size,tail:seen.has(key(snake.at(-1))),foodDistance};
  }
  function safeFoodPath(state) {
    if (!state.food) return null;
    const blocked=new Set(state.snake.slice(1,-1).map(key)), start=key(state.snake[0]);
    const queue=[{point:state.snake[0],heading:state.direction}], previous=new Map([[start,null]]);
    for (let i=0;i<queue.length && !previous.has(key(state.food));i++) {
      const {point,heading}=queue[i];
      // BFS finds a shortest path. Straight-first expansion breaks equivalent ties
      // without forcing an unnecessary alternating left/right staircase.
      const actions=Object.keys(directions).sort((a,b)=>
        Number(directions[b].x===heading.x&&directions[b].y===heading.y)-Number(directions[a].x===heading.x&&directions[a].y===heading.y));
      for(const action of actions) {
        const d=directions[action],next={x:point.x+d.x,y:point.y+d.y},k=key(next);
        if(next.x<0||next.y<0||next.x>=state.size||next.y>=state.size||blocked.has(k)||previous.has(k))continue;
        previous.set(k,{parent:key(point),action});queue.push({point:next,heading:d});
      }
    }
    if(!previous.has(key(state.food)))return null;
    const actions=[];let cursor=key(state.food);
    while(cursor!==start){const entry=previous.get(cursor);actions.push(entry.action);cursor=entry.parent;}
    actions.reverse();
    let virtual={...state,snake:state.snake.map(p=>({...p})),direction:{...state.direction}};
    const plan=[];
    for(const action of actions){
      if(!getLegalActions(virtual).includes(action)||getCollisionCause(virtual,action))return null;
      plan.push({signature:JSON.stringify(virtual.snake),action});
      const d=directions[action],head={x:virtual.snake[0].x+d.x,y:virtual.snake[0].y+d.y};
      virtual.snake=[head,...virtual.snake];virtual.direction=d;
      if(key(head)!==key(state.food))virtual.snake.pop();
    }
    if(virtual.snake.length===state.size*state.size)return plan;
    // Verify escape AFTER eating, rather than just the next empty cell.
    const occupied=new Set(virtual.snake.slice(1,-1).map(key)),seen=new Set([key(virtual.snake[0])]),todo=[virtual.snake[0]];
    for(let i=0;i<todo.length;i++)for(const d of Object.values(directions)){
      const next={x:todo[i].x+d.x,y:todo[i].y+d.y},k=key(next);
      if(next.x<0||next.y<0||next.x>=state.size||next.y>=state.size||occupied.has(k)||seen.has(k))continue;
      seen.add(k);todo.push(next);
    }
    return seen.has(key(virtual.snake.at(-1))) ? plan : null;
  }
  class SafetyGuard {
    constructor({denseBoardSweep=false}={}) { this.denseBoardSweep=denseBoardSweep; this.reset(); }
    reset() {
      this.history=[]; this.foodCount=-1; this.overrides=0; this.lastReason=''; this.plan=[]; this.planFood=null;
      this.filling=false;
    }
    choose(state, preferred) {
      if (preferred === null || preferred === undefined) return preferred;
      if (this.foodCount !== state.foodCollected) { this.history=[]; this.foodCount=state.foodCollected; }
      this.filling=this.denseBoardSweep && state.snake.length*10>state.size*state.size*6 && fillAction(state)!==null;
      const ordered=this.filling && cycleSpan(state)<state.size*state.size;
      if (ordered) {
        const action=orderedCycleAction(state,preferred,this.filling);
        if(action) {
          this.plan=[];
          this.lastReason=this.filling ? 'fill' : action===preferred ? '' : 'cycle_space';
          if(action!==preferred)this.overrides++;
          return action;
        }
      }
      const foodKey=state.food ? key(state.food) : null;
      if(this.planFood!==foodKey || this.plan[0]?.signature!==JSON.stringify(state.snake))this.plan=[];
      if(!this.plan.length){this.plan=safeFoodPath(state)||[];this.planFood=foodKey;}
      if(this.plan.length){
        const action=this.plan.shift().action;
        this.lastReason=this.filling ? 'fill_join' : action===preferred ? '' : 'food_path';
        if(action!==preferred)this.overrides++;
        return action;
      }
      this.history.push(key(state.snake[0]));
      if (this.history.length>state.size*4) this.history.shift();
      const options = getLegalActions(state).map(a=>assess(state,a)).filter(a=>a.safe);
      if (!options.length) return preferred;
      const quality = o => (o.tail ? 2 : 0) + (o.area>=state.snake.length+1 ? 1 : 0);
      const best = Math.max(...options.map(quality));
      const eligible = options.filter(o=>quality(o)===best);
      const visits = o => this.history.filter(k=>k===key(o.head)).length;
      const proposed = eligible.find(o=>o.action===preferred);
      if (this.filling) {
        // Unordered bodies must unwind first; never force the sweep merely
        // because its next cell is empty. Prefer reducing total cycle winding.
        const winding=o=>{
          const snake=[o.head,...state.snake];
          if(!state.food || key(o.head)!==key(state.food))snake.pop();
          return cycleSpan({...state,snake});
        };
        const chosen=eligible.sort((a,b)=>winding(a)-winding(b) || visits(a)-visits(b) ||
          b.area-a.area || Number(b.action===preferred)-Number(a.action===preferred))[0];
        this.lastReason='fill_join';
        if (chosen.action!==preferred) this.overrides++;
        return chosen.action;
      }
      let chosen = proposed;
      if (!chosen || visits(chosen)>=2) {
        chosen = eligible.sort((a,b)=>visits(a)-visits(b) ||
          (best<3 ? b.area-a.area : 0) || a.foodDistance-b.foodDistance ||
          Number(b.action===preferred)-Number(a.action===preferred))[0];
      }
      this.lastReason = chosen.action===preferred ? '' : proposed ? 'loop' : 'space';
      if (this.lastReason) this.overrides++;
      return chosen.action;
    }
  }
  class AssistedAgent {
    constructor(agent, enabled=()=>true) { this.agent=agent; this.enabled=enabled; this.guard=new SafetyGuard(); }
    reset() { this.agent.reset?.(); this.guard.reset(); }
    queueAction(...args) { this.agent.queueAction?.(...args); }
    chooseAction(state) {
      const action=this.agent.chooseAction(state);
      this.guard.denseBoardSweep=this.agent.denseBoardSweepEnabled===true;
      return this.enabled() ? this.guard.choose(state,action) : action;
    }
  }
  const api={SafetyGuard,AssistedAgent,assess,safeFoodPath,fillAction,cycleSpan};
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.SnakeSafety=api;
})(globalThis);
