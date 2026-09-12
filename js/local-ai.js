// Local Python bridge; asynchronous model inference never advances the game by itself.
(function(root) {
  'use strict';
  async function request(path, data, signal) {
    const response = await fetch(path, {method:data===undefined?'GET':'POST', signal,
      headers:{'Content-Type':'application/json','X-Snake-Client':'1'},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Local service unavailable');
    return value;
  }
  class RemoteAgent {
    constructor({type,model=()=>'',onStatus=()=>{},requestFn=request}={}) {
      this.type=type; this.model=model; this.onStatus=onStatus; this.request=requestFn; this.generation=0;
      this.reset();
    }
    reset() {
      this.controller?.abort(); this.generation++; this.pending=false; this.ready=null;
      this.retryAt=0; this.lastFoodStep=0; this.foodCount=0;
    }
    cancel() {
      const foodCount=this.foodCount, lastFoodStep=this.lastFoodStep;
      this.reset(); this.foodCount=foodCount; this.lastFoodStep=lastFoodStep;
    }
    chooseAction(state) {
      if (!state.alive) return undefined;
      if (this.foodCount!==state.foodCollected) {this.foodCount=state.foodCollected; this.lastFoodStep=state.steps;}
      if (this.ready) {const action=this.ready; this.ready=null; return action;}
      if (this.pending || Date.now()<this.retryAt) return null;
      this.pending=true;
      const generation=this.generation;
      this.controller=new AbortController();
      this.onStatus({state:'thinking',type:this.type});
      this.request('/api/action',{agent:this.type,model:this.model(),state:{...state,stepsSinceFood:state.steps-this.lastFoodStep}},this.controller.signal)
        .then(value=>{
          if (generation!==this.generation) return;
          const vectors={UP:[0,-1],DOWN:[0,1],LEFT:[-1,0],RIGHT:[1,0]}, v=vectors[value.action];
          if (!v || (v[0]===-state.direction.x && v[1]===-state.direction.y)) throw Error('Invalid action from local service');
          this.ready=value.action; this.onStatus({state:'ready',...value});
        }).catch(error=>{
          if (generation!==this.generation) return;
          this.retryAt=Date.now()+2000;
          this.onStatus({state:'error',error:error.message});
        }).finally(()=>{if(generation===this.generation) this.pending=false;});
      return null; // EpisodeRunner waits; undefined retains its normal "straight" meaning.
    }
  }
  const api={RemoteAgent,request};
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.SnakeLocalAI=api;
})(globalThis);
