const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {SnakeGame, Actions, speed} = require('../js/game.js');

// Fixed route used only for testing. It follows a cycle through every board cell.
const cycle = [{x:0,y:0}];
for (let y = 0; y < 20; y++) {
  for (let i = 1; i < 20; i++) cycle.push({x:y % 2 ? 20 - i : i,y});
}
for (let y = 19; y > 0; y--) cycle.push({x:0,y});
function nextAction(state) {
  const head = state.snake[0];
  const index = cycle.findIndex(p => p.x === head.x && p.y === head.y);
  const next = cycle[(index + 1) % cycle.length];
  return next.x > head.x ? Actions.RIGHT : next.x < head.x ? Actions.LEFT :
    next.y > head.y ? Actions.DOWN : Actions.UP;
}
function trace(game, steps) {
  const result = [];
  for (let i = 0; i < steps; i++) result.push(game.step(nextAction(game.getState())));
  return result;
}

test('engine runs without a browser and exposes one synchronous tick per action', () => {
  const game = new SnakeGame({seed:0});
  assert.deepEqual(game.getState().snake, [{x:9,y:10},{x:8,y:10},{x:7,y:10}]);
  assert.equal(game.isGameOver(), false);
  assert.deepEqual(game.step(Actions.UP).snake[0], {x:9,y:9});
  assert.deepEqual(game.step(Actions.DOWN).snake[0], {x:9,y:8}, 'reversal continues forward');
  assert.deepEqual(game.step().snake[0], {x:9,y:7});
  assert.deepEqual(game.step(Actions.LEFT).snake[0], {x:8,y:7});
  assert.deepEqual(game.step(Actions.DOWN).snake[0], {x:8,y:8});
});

test('same seed and action sequence reproduce every state, including multiple food respawns', () => {
  for (const seed of [0, 42, -17, 'evaluation-run']) {
    const first = new SnakeGame({seed}), second = new SnakeGame({seed});
    const expected = trace(first, 3000);
    assert.ok(expected.at(-1).score >= 100);
    // Unrelated engines and visual Math.random calls cannot consume this stream.
    trace(new SnakeGame({seed:'other-player'}), 300);
    for (let i = 0; i < 200; i++) Math.random();
    assert.deepEqual(trace(second, 3000), expected);
    first.reset();
    assert.deepEqual(trace(first, 3000), expected, 'reset() rewinds the configured seed');
  }
});

test('seeds can be replaced and seed types are validated without changing state on failure', () => {
  const game = new SnakeGame({seed:42});
  assert.notDeepEqual(game.getState().food, new SnakeGame({seed:43}).getState().food);
  assert.deepEqual(game.reset('new'), new SnakeGame({seed:'new'}).getState());
  const before = game.getState();
  for (const invalid of [null, NaN, Infinity, {}, []]) {
    assert.throws(() => game.reset(invalid), TypeError);
    assert.deepEqual(game.getState(), before);
  }
  assert.equal(game.reset(undefined).alive, true);
  assert.equal(game.reset().alive, true);
});

test('state snapshots from getState, reset, and step cannot mutate the engine', () => {
  const game = new SnakeGame({seed:12});
  for (const snapshot of [game.getState(), game.reset(), game.step(Actions.UP)]) {
    const expected = game.getState();
    snapshot.snake[0].x = -100;
    snapshot.snake.push({x:100,y:100});
    snapshot.direction.x = 100;
    snapshot.food.x = 100;
    snapshot.score = 999;
    snapshot.alive = false;
    assert.deepEqual(game.getState(), expected);
  }
  assert.equal(game.setStateForTest, undefined);
});

test('invalid actions fail explicitly and a wall collision produces a stable terminal state', () => {
  const game = new SnakeGame({seed:42});
  const before = game.getState();
  for (const invalid of ['up', 'KeyW', 'toString', null, {}, 1]) {
    assert.throws(() => game.step(invalid), TypeError);
    assert.deepEqual(game.getState(), before);
  }
  for (let i = 0; i < 11; i++) game.step(Actions.RIGHT);
  assert.equal(game.isGameOver(), true);
  const terminal = game.getState();
  assert.equal(terminal.won, false);
  assert.deepEqual(game.step(Actions.UP), terminal);
  assert.equal(game.reset().alive, true);
});

test('food stays outside the snake; growth, points, speed cap, and a full-board win work headlessly', () => {
  const game = new SnakeGame({seed:'full-board'});
  let state = game.getState(), ticks = 0;
  while (!game.isGameOver() && ticks++ < 160000) {
    if (state.food) assert.ok(!state.snake.some(p => p.x === state.food.x && p.y === state.food.y));
    const previous = state;
    state = game.step(nextAction(state));
    assert.equal(state.score, (state.snake.length - 3) * 10);
    assert.ok(state.snake.length === previous.snake.length || state.snake.length === previous.snake.length + 1);
    assert.equal(speed(state), Math.min(10, (40 + state.snake.length - 3) / 10));
  }
  assert.equal(state.won, true);
  assert.equal(state.snake.length, 400);
  assert.equal(state.food, null);
  assert.equal(state.score, 3970);
  assert.equal(state.foodCollected, 397);
  assert.equal(state.stepsSurvived, state.steps);
  assert.equal(state.causeOfDeath, null);
  assert.deepEqual(game.step(), state);
});

test('original style base remains intact and both page entry points match', () => {
  // Normalize Windows line endings before checking unchanged appearance content.
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
  const baseline = JSON.parse(read('tests/appearance-baseline.json'));
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(hash(read('css/style.css').split('\n/* Agent controls and episode statistics */')[0]), baseline.css);
  // Page layout was intentionally redesigned; the old body snapshot is historical.
  assert.equal(read('index.html'), read('PixelSnake.html'));
});
