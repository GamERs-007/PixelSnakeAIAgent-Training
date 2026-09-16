const test = require('node:test');
const assert = require('node:assert/strict');
const {SnakeGame, Actions, directions, getLegalActions, getCollisionCause} = require('../js/game.js');
const {HumanAgent, RandomAgent, HeuristicAgent} = require('../js/agents.js');
const {EpisodeRunner, runEpisodes} = require('../js/episode.js');

const snapshot = patch => ({...new SnakeGame({seed:0}).getState(), ...patch});

test('HumanAgent keeps two buffered turns, prevents reversals, and continues forward without input', () => {
  const agent = new HumanAgent(), game = new SnakeGame({seed:1});
  let state = game.getState();
  agent.queueAction(Actions.LEFT, state);
  assert.equal(agent.chooseAction(state), Actions.RIGHT);
  agent.queueAction(Actions.UP, state);
  agent.queueAction(Actions.LEFT, state);
  agent.queueAction(Actions.DOWN, state);
  assert.equal(agent.turns.length, 2);
  state = game.step(agent.chooseAction(state));
  assert.deepEqual(state.snake[0], {x:9,y:9});
  state = game.step(agent.chooseAction(state));
  assert.deepEqual(state.snake[0], {x:8,y:9});
  assert.equal(agent.chooseAction(state), Actions.LEFT);
  agent.queueAction(Actions.DOWN, state); agent.reset();
  assert.equal(agent.turns.length, 0);
});

test('RandomAgent samples only non-reversing actions and repeats its own seeded stream', () => {
  const a = new RandomAgent({seed:42}), b = new RandomAgent({seed:42});
  const state = snapshot({}), before = structuredClone(state);
  const actions = Array.from({length:200}, () => a.chooseAction(state));
  assert.equal(new Set(actions).size, 3);
  assert.ok(actions.every(action => getLegalActions(state).includes(action)));
  assert.deepEqual(actions, Array.from({length:200}, () => b.chooseAction(state)));
  a.reset();
  assert.deepEqual(actions, Array.from({length:200}, () => a.chooseAction(state)));
  assert.deepEqual(state, before);
  assert.throws(() => new RandomAgent({seed:NaN}), TypeError);
});

test('HeuristicAgent moves toward food, picks safe detours, and shares tail collision rules', () => {
  const agent = new HeuristicAgent();
  const state = snapshot({food:{x:9,y:6}});
  const before = structuredClone(state);
  assert.equal(agent.chooseAction(state), Actions.UP);
  assert.deepEqual(state, before);
  for (const patch of [
    {snake:[{x:19,y:10},{x:18,y:10},{x:17,y:10}], food:{x:19,y:0}},
    {snake:[{x:9,y:10},{x:9,y:9},{x:10,y:9},{x:10,y:10},{x:10,y:11}], food:{x:11,y:10}}
  ]) {
    const blocked = snapshot(patch);
    const action = agent.chooseAction(blocked);
    assert.equal(getCollisionCause(blocked, action), null);
  }
  const tail = snapshot({snake:[{x:9,y:10},{x:9,y:11},{x:10,y:11},{x:10,y:10}], food:{x:15,y:10}});
  assert.equal(agent.chooseAction(tail), Actions.RIGHT);
  assert.equal(getCollisionCause(tail, Actions.RIGHT), null);
  tail.food = {x:10,y:10};
  assert.equal(getCollisionCause(tail, Actions.RIGHT), 'self', 'tail stays occupied on an eating step');
});

test('agents handle terminal and trapped states without inventing an action', () => {
  const trapped = snapshot({snake:[{x:19,y:0},{x:18,y:0},{x:18,y:1},{x:19,y:1},{x:19,y:2}]});
  const agent = new HeuristicAgent();
  assert.ok(getLegalActions(trapped).includes(agent.chooseAction(trapped)));
  assert.notEqual(getCollisionCause(trapped, agent.chooseAction(trapped)), null);
  for (const agent of [new HumanAgent(), new RandomAgent(), new HeuristicAgent()]) {
    assert.equal(agent.chooseAction(snapshot({alive:false})), undefined);
  }
});

test('every agent is invoked through the same runner -> game.step(action) path', () => {
  for (const agent of [new HumanAgent(), new RandomAgent({seed:7}), new HeuristicAgent()]) {
    const game = new SnakeGame({seed:5}), runner = new EpisodeRunner({game, agent});
    let calls = 0;
    const step = game.step.bind(game);
    game.step = action => { calls++; assert.ok(Object.hasOwn(directions, action)); return step(action); };
    runner.reset(); runner.step();
    assert.equal(calls, 1);
    assert.equal(runner.getStatistics().steps, 1);
  }
});

test('episode statistics distinguish successful moves, fatal ticks, food, resets, and termination', () => {
  const runner = new EpisodeRunner({game:new SnakeGame({seed:42}), agent:new HumanAgent()});
  assert.equal(runner.getStatistics().episodeNumber, 0);
  runner.reset();
  for (let i = 0; i < 11; i++) runner.step();
  assert.deepEqual(runner.getStatistics(), {episodeNumber:1,score:0,steps:11,stepsSurvived:10,
    foodCollected:0,causeOfDeath:'wall',terminated:true,won:false});
  const before = runner.getStatistics(); runner.step();
  assert.deepEqual(runner.getStatistics(), before);
  runner.reset(); assert.equal(runner.getStatistics().episodeNumber, 2);
  assert.equal(runner.getStatistics().causeOfDeath, null);
  runner.reset({countEpisode:false}); assert.equal(runner.getStatistics().episodeNumber, 2);
  runner.setAgent(new HeuristicAgent());
  for (let i = 0; i < 50 && runner.getStatistics().foodCollected === 0; i++) runner.step();
  assert.equal(runner.getStatistics().foodCollected, 1);
  assert.equal(runner.getStatistics().score, 10);
});

test('self collision is reported by the actual engine', () => {
  const game = new SnakeGame({seed:42});
  const agent = new HeuristicAgent();
  for (let i = 0; i < 2000 && game.getState().snake.length < 5 && !game.isGameOver(); i++) game.step(agent.chooseAction(game.getState()));
  assert.equal(game.getState().snake.length, 5);
  const direction = game.getState().direction;
  const turn = Object.keys(directions).find(a => directions[a].x === -direction.y && directions[a].y === direction.x);
  const reverse = Object.keys(directions).find(a => directions[a].x === -direction.x && directions[a].y === -direction.y);
  const next = Object.keys(directions).find(a => directions[a].x === direction.y && directions[a].y === -direction.x);
  for (const action of [turn, reverse, next]) game.step(action);
  assert.equal(game.getState().causeOfDeath, 'self');
  assert.equal(game.getState().alive, false);
  assert.equal(game.getState().steps, game.getState().stepsSurvived + 1);
});

test('headless episode batches are repeatable and step limits are truncations, not deaths', () => {
  const options = {episodes:30,maxSteps:500,seed:42,agentFactory:({seed}) => new RandomAgent({seed})};
  const results = runEpisodes(options);
  assert.deepEqual(runEpisodes(options), results);
  assert.deepEqual(results.map(r => r.episodeNumber), Array.from({length:30}, (_,i) => i + 1));
  assert.ok(new Set(results.map(r => r.steps)).size > 1, 'episodes have different derived seeds');
  assert.ok(results.every(r => r.steps <= 500));
  const [limited] = runEpisodes({episodes:1,maxSteps:1,seed:1,agentFactory:() => new HeuristicAgent()});
  assert.equal(limited.truncated, true);
  assert.equal(limited.terminated, false);
  assert.equal(limited.causeOfDeath, null);
  assert.equal(limited.stepsSurvived, 1);
});

test('runner validates agent contracts and finite run bounds; observations are detached', () => {
  assert.throws(() => new EpisodeRunner({agent:{}}), TypeError);
  const runner = new EpisodeRunner({agent:{chooseAction(state) { state.score = 999; return Actions.UP; }}});
  runner.reset(); runner.step();
  assert.equal(runner.getStatistics().score, 0);
  for (const value of [0,-1,NaN,Infinity,1.5]) {
    assert.throws(() => runner.run(value), TypeError);
    assert.throws(() => runEpisodes({episodes:value,agentFactory:() => new HumanAgent()}), TypeError);
  }
});
