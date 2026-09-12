// Inference only: the trained PyTorch Linear/ReLU network, evaluated locally.
(function(root) {
  'use strict';
  const commonJS = typeof module === 'object' && module.exports;
  const {directions, getCollisionCause} = commonJS ? require('./game.js') : root.SnakeEngine;
  const {request} = commonJS ? require('./local-ai.js') : root.SnakeLocalAI;
  const headings = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
  const turns = [0, -1, 1];
  function heading(state) {
    return headings.findIndex(action => directions[action].x === state.direction.x && directions[action].y === state.direction.y);
  }
  function observation(state, stepsSinceFood, noFoodLimit = 400) {
    const direction = heading(state), head = state.snake[0];
    return Float32Array.from([
      ...turns.map(turn => Number(getCollisionCause(state, headings[(direction + turn + 4) % 4]) !== null)),
      ...headings.map((_, index) => Number(direction === index)),
      state.food ? (state.food.x - head.x) / (state.size - 1) : 0,
      state.food ? (state.food.y - head.y) / (state.size - 1) : 0,
      Math.min(1, stepsSinceFood / noFoodLimit)
    ]);
  }
  class DenseQNetwork {
    constructor(payload) {
      if (payload?.format !== 'snake-dqn-dense-v1' || payload.board_size !== 20 ||
          payload.max_steps_without_food !== 400 || !Array.isArray(payload.layers) || payload.layers.length !== 3) {
        throw Error('Unsupported browser DQN model');
      }
      let inputs = 10, hidden;
      this.layers = payload.layers.map((layer, index) => {
        const outputs = layer?.bias?.length;
        if (!Number.isInteger(outputs) || outputs < 1 || outputs > 1024 ||
            (index === 1 && outputs !== hidden) || (index === 2 && outputs !== 3) ||
            !Array.isArray(layer.bias) || !layer.bias.every(Number.isFinite) ||
            !Array.isArray(layer.weights) || layer.weights.length !== outputs ||
            !layer.weights.every(row => Array.isArray(row) && row.length === inputs && row.every(Number.isFinite))) {
          throw Error('Invalid browser DQN weights');
        }
        if (index === 0) hidden = outputs;
        const result = {inputs, outputs, weights:Float32Array.from(layer.weights.flat()),
          bias:Float32Array.from(layer.bias), values:new Float32Array(outputs)};
        if (![...result.weights, ...result.bias].every(Number.isFinite)) throw Error('Non-finite float32 weights');
        inputs = outputs;
        return result;
      });
    }
    forward(observation) {
      if (observation.length !== 10 || !observation.every(Number.isFinite)) throw Error('Invalid DQN observation');
      let values = observation;
      for (let index = 0; index < this.layers.length; index++) {
        const layer = this.layers[index];
        for (let row = 0; row < layer.outputs; row++) {
          let sum = layer.bias[row];
          const offset = row * layer.inputs;
          for (let col = 0; col < layer.inputs; col++) sum += layer.weights[offset + col] * values[col];
          layer.values[row] = index < 2 ? Math.max(0, sum) : sum;
        }
        values = layer.values;
      }
      if (!values.every(Number.isFinite)) throw Error('Non-finite DQN output');
      return values;
    }
  }
  class BrowserDQNAgent {
    constructor({model=()=>'', onStatus=()=>{}, requestFn=request}={}) {
      this.model = model; this.onStatus = onStatus; this.request = requestFn;
      this.network = null; this.loadedModel = null; this.generation = 0;
      this.reset();
    }
    reset() {
      this.cancel(); this.lastFoodStep = 0; this.foodCount = 0;
    }
    cancel() {
      this.controller?.abort(); this.generation++; this.pending = false; this.retryAt = 0;
    }
    invalidate() { this.cancel(); this.network = null; this.loadedModel = null; }
    chooseAction(state) {
      if (!state.alive) return undefined;
      if (this.foodCount !== state.foodCollected) { this.foodCount = state.foodCollected; this.lastFoodStep = state.steps; }
      const name = this.model();
      if (this.network && this.loadedModel === name) {
        try {
          const q = this.network.forward(observation(state, state.steps - this.lastFoodStep));
          let best = 0;
          for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
          return headings[(heading(state) + turns[best] + 4) % 4];
        } catch (error) {
          this.network = null; this.retryAt = Date.now() + 2000;
          this.onStatus({state:'error', error:error.message});
          return null;
        }
      }
      if (this.pending || Date.now() < this.retryAt) return null;
      this.pending = true;
      const generation = this.generation;
      this.controller = new AbortController();
      this.onStatus({state:'loading', type:'dqn'});
      this.request('/api/dqn/model', {model:name}, this.controller.signal).then(payload => {
        if (generation !== this.generation || this.model() !== name) return;
        this.network = new DenseQNetwork(payload); this.loadedModel = name;
        this.onStatus({state:'local', type:'dqn'});
      }).catch(error => {
        if (generation !== this.generation) return;
        this.retryAt = Date.now() + 2000;
        this.onStatus({state:'error', error:error.message});
      }).finally(() => { if (generation === this.generation) this.pending = false; });
      return null;
    }
  }
  const api = {BrowserDQNAgent, DenseQNetwork, observation};
  if (commonJS) module.exports = api;
  else root.SnakeDQN = api;
})(globalThis);
