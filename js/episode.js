// Shared synchronous orchestration for browser play and headless evaluation.
(function (root) {
  'use strict';
  const commonJS = typeof module === 'object' && module.exports;
  const {SnakeGame} = commonJS ? require('./game.js') : root.SnakeEngine;

  function validateAgent(agent) {
    if (!agent || typeof agent.chooseAction !== 'function') throw new TypeError('Agent must implement chooseAction(state).');
  }
  function positiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(name + ' must be a positive safe integer.');
  }

  class EpisodeRunner {
    constructor({game = new SnakeGame(), agent} = {}) {
      validateAgent(agent);
      this.game = game;
      this.agent = agent;
      this.episodeNumber = 0;
    }
    setAgent(agent) { validateAgent(agent); this.agent = agent; }
    reset(options = {}) {
      const state = Object.hasOwn(options, 'seed') ? this.game.reset(options.seed) : this.game.reset();
      this.agent.reset?.();
      if (options.countEpisode !== false) this.episodeNumber++;
      return state;
    }
    step() {
      if (this.game.isGameOver()) return this.game.getState();
      const action = this.agent.chooseAction(this.game.getState());
      return action === null ? this.game.getState() : this.game.step(action);
    }
    getStatistics() {
      const state = this.game.getState();
      return {episodeNumber:this.episodeNumber, score:state.score, steps:state.steps,
        stepsSurvived:state.stepsSurvived, foodCollected:state.foodCollected,
        causeOfDeath:state.causeOfDeath, terminated:!state.alive, won:state.won};
    }
    run(maxSteps = 10000) {
      positiveInteger(maxSteps, 'maxSteps');
      while (!this.game.isGameOver() && this.game.getState().steps < maxSteps) {
        const before = this.game.getState().steps;
        this.step();
        if (this.game.getState().steps === before) throw new Error('Synchronous run cannot wait for an asynchronous agent');
      }
      return {...this.getStatistics(), truncated:!this.game.isGameOver()};
    }
  }

  function runEpisodes({agentFactory, episodes = 100, maxSteps = 10000, seed = 0} = {}) {
    if (typeof agentFactory !== 'function') throw new TypeError('Provide an agentFactory(context).');
    positiveInteger(episodes, 'episodes'); positiveInteger(maxSteps, 'maxSteps');
    // Validate the base seed using the engine's own contract.
    const game = new SnakeGame({seed});
    const results = [];
    for (let episodeNumber = 1; episodeNumber <= episodes; episodeNumber++) {
      const episodeSeed = seed === undefined ? undefined : `${typeof seed}:${seed}:episode:${episodeNumber}`;
      const agentSeed = episodeSeed === undefined ? undefined : episodeSeed + ':agent';
      const runner = new EpisodeRunner({game, agent:agentFactory({episodeNumber, seed:agentSeed})});
      runner.episodeNumber = episodeNumber - 1;
      runner.reset({seed:episodeSeed});
      results.push(runner.run(maxSteps));
    }
    return results;
  }

  const api = Object.freeze({EpisodeRunner, runEpisodes});
  if (commonJS) module.exports = api;
  else root.SnakeEpisodes = api;
})(globalThis);
