// Agents observe snapshots and return actions. They never own or mutate a game.
(function (root) {
  'use strict';
  const engine = typeof module === 'object' && module.exports ? require('./game.js') : root.SnakeEngine;
  const {directions, getLegalActions, getCollisionCause, randomGenerator} = engine;
  const forward = state => Object.keys(directions).find(action =>
    directions[action].x === state.direction.x && directions[action].y === state.direction.y);

  class HumanAgent {
    constructor() { this.turns = []; }
    reset() { this.turns.length = 0; }
    queueAction(action, state) {
      if (!state.alive || !Object.hasOwn(directions, action) || this.turns.length >= 2) return;
      const previous = this.turns.length ? directions[this.turns[this.turns.length - 1]] : state.direction;
      const next = directions[action];
      if ((next.x === previous.x && next.y === previous.y) ||
          (next.x === -previous.x && next.y === -previous.y)) return;
      this.turns.push(action);
    }
    chooseAction(state) {
      if (!state.alive) return undefined;
      return this.turns.shift() || forward(state);
    }
  }

  class RandomAgent {
    #seed;
    #random;
    constructor({seed} = {}) { this.#seed = seed; this.reset(); }
    reset() { this.#random = randomGenerator(this.#seed); }
    chooseAction(state) {
      const legal = getLegalActions(state);
      if (!legal.length) return undefined;
      // Valid means non-reversing; this baseline may still choose a fatal move.
      return legal[Math.floor(this.#random() * legal.length)];
    }
  }

  class HeuristicAgent {
    chooseAction(state) {
      const legal = getLegalActions(state);
      if (!legal.length) return undefined;
      const safe = legal.filter(action => getCollisionCause(state, action) === null);
      if (!safe.length) return forward(state); // Trapped: no safe choice exists.
      const head = state.snake[0];
      const distance = action => state.food ?
        Math.abs(head.x + directions[action].x - state.food.x) +
        Math.abs(head.y + directions[action].y - state.food.y) : 0;
      // Prefer the nearest food distance, then straight ahead, then stable action order.
      return safe.sort((a, b) => distance(a) - distance(b) ||
        Number(b === forward(state)) - Number(a === forward(state)))[0];
    }
  }

  const api = Object.freeze({HumanAgent, RandomAgent, HeuristicAgent});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnakeAgents = api;
})(globalThis);
