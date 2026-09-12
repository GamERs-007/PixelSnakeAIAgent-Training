// No browser, clock, storage, or rendering dependencies. Also loadable with require().
(function (root) {
  'use strict';
  const Actions = Object.freeze({UP:'UP', DOWN:'DOWN', LEFT:'LEFT', RIGHT:'RIGHT'});
  const directions = Object.freeze({
    UP:Object.freeze({x:0,y:-1}), DOWN:Object.freeze({x:0,y:1}),
    LEFT:Object.freeze({x:-1,y:0}), RIGHT:Object.freeze({x:1,y:0})
  });
  const size = 20, initialSpeed = 4, maxSpeed = 10;
  const speed = state => Math.min(maxSpeed * 10, initialSpeed * 10 + Math.max(0, state.snake.length - 3)) / 10;
  const copy = state => ({...state, snake:state.snake.map(part => ({...part})),
    direction:{...state.direction}, food:state.food ? {...state.food} : null});

  function directionFor(state, action) {
    if (action !== undefined && !Object.hasOwn(directions, action)) {
      throw new TypeError('Unknown action: ' + String(action));
    }
    const next = directions[action];
    return next && !(next.x === -state.direction.x && next.y === -state.direction.y) ? next : state.direction;
  }
  function getLegalActions(state) {
    if (!state.alive) return [];
    return Object.keys(directions).filter(action => {
      const next = directions[action];
      return !(next.x === -state.direction.x && next.y === -state.direction.y);
    });
  }
  function collisionAt(state, head) {
    if (head.x < 0 || head.x >= state.size || head.y < 0 || head.y >= state.size) return 'wall';
    const eating = state.food && head.x === state.food.x && head.y === state.food.y;
    const body = eating ? state.snake : state.snake.slice(0, -1);
    return body.some(part => part.x === head.x && part.y === head.y) ? 'self' : null;
  }
  // Agents and the engine share the same one-step collision rules, including the tail.
  function getCollisionCause(state, action) {
    const direction = directionFor(state, action);
    return collisionAt(state, {x:state.snake[0].x + direction.x, y:state.snake[0].y + direction.y});
  }

  function randomGenerator(seed) {
    if (seed === undefined) return Math.random;
    if (typeof seed !== 'string' && !(typeof seed === 'number' && Number.isFinite(seed))) {
      throw new TypeError('Seed must be a finite number or a string.');
    }
    // FNV-1a seed hashing followed by Mulberry32; each engine owns its stream.
    let value = 2166136261;
    for (const character of typeof seed + ':' + seed) {
      value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
    }
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let n = Math.imul(value ^ (value >>> 15), 1 | value);
      n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  class SnakeGame {
    #state;
    #seed;
    #random;

    constructor({seed} = {}) { this.reset(seed); }

    // Omitted seed replays the configured seed; reset(undefined) restores unseeded play.
    reset(seed) {
      if (arguments.length === 0) seed = this.#seed;
      const random = randomGenerator(seed);
      this.#seed = seed;
      this.#random = random;
      this.#state = {size, snake:[{x:9,y:10},{x:8,y:10},{x:7,y:10}],
        direction:{...directions.RIGHT}, food:null, score:0, alive:true, won:false,
        steps:0, stepsSurvived:0, foodCollected:0, causeOfDeath:null};
      this.#state.food = this.#spawnFood();
      return this.getState();
    }

    #spawnFood() {
      const occupied = new Set(this.#state.snake.map(part => part.y * size + part.x));
      const empty = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!occupied.has(y * size + x)) empty.push({x,y});
      }
      return empty.length ? empty[Math.floor(this.#random() * empty.length)] : null;
    }

    // One call is exactly one grid tick. No action means continue straight.
    // A reversal is ignored; unknown actions are programming errors.
    step(action) {
      const state = this.#state;
      const next = directionFor(state, action);
      if (!state.alive) return this.getState();
      state.steps++;
      state.direction = {...next};
      const head = {x:state.snake[0].x + state.direction.x, y:state.snake[0].y + state.direction.y};
      const eating = state.food && head.x === state.food.x && head.y === state.food.y;
      const cause = collisionAt(state, head);
      if (cause) {
        state.alive = false;
        state.causeOfDeath = cause;
        return this.getState();
      }
      state.snake.unshift(head);
      state.stepsSurvived++;
      if (eating) {
        state.score += 10;
        state.foodCollected++;
        state.food = this.#spawnFood();
        if (!state.food) { state.alive = false; state.won = true; }
      } else state.snake.pop();
      return this.getState();
    }

    getState() { return copy(this.#state); }
    isGameOver() { return !this.#state.alive; }
  }

  const api = Object.freeze({SnakeGame, Actions, directions, size, initialSpeed, maxSpeed, speed,
    getLegalActions, getCollisionCause, randomGenerator});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnakeEngine = api;
})(globalThis);
