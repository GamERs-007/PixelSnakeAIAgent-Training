const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('index.html');
const css = read('css/style.css');
const source = read('js/main.js');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);

// Run the shipped scripts with a DOM/Canvas stub and a manual clock.
// Legacy scenarios use test-only state fixtures; production has no state mutation API.
function boot({ legacyFixtures = true, language = 'zh-CN', blockedStorage = false, missingCanvas = 0, audio = false, brokenAudio = false, reducedMotion = false, savedShop = null, savedBest = 0 } = {}) {
  const elements = [], ids = {}, events = {}, windowEvents = {}, storage = new Map([['pixel-snake-language', language]]);
  if (savedShop !== null) storage.set('pixel-snake-shop', typeof savedShop === 'string' ? savedShop : JSON.stringify(savedShop));
  storage.set('pixel-snake-best', String(savedBest));
  const draws = [0, 0];
  const canvasPaint = [[], []];
  const audioLog = {contexts:0,resumes:0,oscillators:[],gains:[]};
  class FakeAudioContext {
    constructor() {
      if (brokenAudio) throw Error('Audio unavailable');
      audioLog.contexts++; this.state = 'suspended'; this.currentTime = 1; this.destination = {};
    }
    resume() { audioLog.resumes++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() {
      const oscillator = {frequency:{setValueAtTime:value=>oscillator.pitch=value,exponentialRampToValueAtTime(){}},
        connect(){},disconnect(){this.disconnected=true;},start(time){this.started=time;},stop(time){this.stopped=time;}};
      audioLog.oscillators.push(oscillator); return oscillator;
    }
    createGain() {
      const gain = {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){this.disconnected=true;}};
      audioLog.gains.push(gain); return gain;
    }
  }
  let animation;
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const classes = new Set((attrs.class || '').split(' '));
    const element = {
      attrs, dataset: {}, textContent: '', style: {setProperty(key,value){this[key]=value;}}, handlers: {}, width: 480, height: 480,
      hidden: /\shidden(?:\s|>)/.test(tag[0]), disabled: /\sdisabled(?:\s|>)/.test(tag[0]),
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        toggle: (value, on) => on ? classes.add(value) : classes.delete(value), contains: value => classes.has(value)
      },
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.handlers[k] = fn; }, setPointerCapture() {},
      open: false, showModal(){this.open=true;}, close(){this.open=false;},
      getContext() {
        const number = Number(attrs.id?.split('-')[1]);
        if (number === missingCanvas) return null;
        let paint = {}, shape = null;
        const stack = [];
        return new Proxy({}, {
          get: (_, key) => {
            if (key in paint) return paint[key];
            return (...args) => {
              if (key === 'save') stack.push({...paint});
              if (key === 'restore') paint = stack.pop() || {};
              if (key === 'beginPath') shape = null;
              if (key === 'roundRect') shape = args;
              if (key === 'moveTo') shape = args;
              if (key === 'lineTo') shape = [...(shape || []), ...args];
              if (key === 'fillRect' || key === 'fill' || key === 'stroke') {
                draws[number - 1]++;
                canvasPaint[number - 1].push({kind:key,shape:key === 'fillRect' ? args : shape,...paint});
              }
            };
          },
          set: (_, key, value) => {paint[key] = value; return true;}
        });
      }
    };
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('data-')) element.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    elements.push(element);
    if (attrs.id) {
      assert.ok(!ids[attrs.id], 'HTML IDs must be unique');
      ids[attrs.id] = element;
    }
  }
  const document = {
    documentElement: {}, hidden: false, getElementById: id => ids[id],
    querySelectorAll: selector => elements.filter(e => Object.hasOwn(e.attrs, selector.slice(1, -1))),
    addEventListener: (key, fn) => events[key] = fn
  };
  const sandbox = {
    window: {addEventListener: (key, fn) => windowEvents[key] = fn, AudioContext:audio ? FakeAudioContext : undefined,
      matchMedia:()=>({matches:reducedMotion})},
    document, HTMLSelectElement: class {}, requestAnimationFrame: fn => { animation = fn; }, setTimeout: fn => fn(),
    localStorage: {
      getItem(key) { if (blockedStorage) throw Error('denied'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw Error('denied'); storage.set(key, value); }
    }
  };
  for (const file of scripts.filter(file => file !== 'js/main.js')) {
    let script = read(file);
    if (legacyFixtures && file === 'js/game.js') script = script.replace('    getState() {',
      '    setStateForTest(state) { this.#state = copy(state); }\n    getState() {');
    vm.runInNewContext(script, sandbox, {filename:file});
  }
  const instrumented = source.replace('  resetPlayers(); setLanguage(language);', `
    // Keep the old scenario syntax while all production callers use snapshots.
    if (${legacyFixtures}) for (const player of players) {
      for (const key of ['snake','food','score','direction','alive','won']) {
        Object.defineProperty(player, key, {get:() => player.model[key], set:value => { player.model[key] = value; }});
      }
      const engineStep = player.engine.step.bind(player.engine);
      player.engine.step = action => { player.engine.setStateForTest(player.model); return engineStep(action); };
    }
    globalThis.api = { players, draw, visibleSnake,
      speed:p => speed(p.model ? p : {model:p}), currentSpeed, updateBoost,
      delay:p => delay(p.model ? p : {model:p}), start, step,
      turn:(p, action) => turn(p, action.toUpperCase()),
      finish:(p, won = false) => { p.model.alive = false; p.model.won = won; p.engine.setStateForTest(p.model); finish(p, won); },
      setAgentType, setAISpeed, setHeadless, setMode, setLanguage, togglePause, translations, skins, buySkin, selectShopPlayer, openShop,
      get:() => ({state, mode, best, coins, ownedSkins:[...ownedSkins], equippedSkins:[...equippedSkins]})
    };
    resetPlayers(); setLanguage(language);`);
  vm.runInNewContext(instrumented, sandbox, {filename:'js/main.js'});
  const key = (key, code = key, extra = {}) => events.keydown({key, code, preventDefault() {}, ...extra});
  return { ...sandbox, ids, events, windowEvents, elements, storage, draws, canvasPaint, audioLog, key, frame: time => animation(time) };
}

test('split page starts, renders both boards and keeps single-player controls', () => {
  assert.match(html, /<link rel="stylesheet" href="css\/style.css">/);
  assert.deepEqual(scripts, ['js/game.js','js/agents.js','js/episode.js','js/safety.js','js/local-ai.js','js/dqn-agent.js','js/renderer.js','js/input.js','js/main.js']);
  assert.equal(read('PixelSnake.html'), html);
  assert.match(html, /<\/script>\s*<\/body>\s*<\/html>\s*$/);
  assert.doesNotMatch(html, /data-level|selectedLevel|activeLevel/);
  const app = boot();
  const { api, ids } = app;
  assert.ok(app.draws.every(count => count > 0));
  assert.equal(ids['player-2'].hidden, true);
  assert.equal(api.get().state, 'ready');
  ids.start.handlers.click();
  app.key('ArrowUp'); api.step(api.players[0]);
  assert.equal(api.players[0].snake[0].y, 9);
  app.key('a', 'KeyA'); api.step(api.players[0]);
  assert.equal(api.players[0].snake[0].x, 8);
  assert.equal(api.players[1].snake[0].x, 9);
});

test('two boards start together and route simultaneous WASD and arrow inputs independently', () => {
  const app = boot(), { api, ids } = app;
  app.elements.find(e => e.dataset.mode === 'dual').handlers.click();
  assert.equal(ids['player-2'].hidden, false);
  assert.equal(ids.cabinet.classList.contains('dual'), true);
  ids['play-2'].handlers.click();
  assert.equal(ids['overlay-1'].hidden, true);
  assert.equal(ids['overlay-2'].hidden, true);
  app.key('w', 'KeyW'); app.key('ArrowDown');
  app.frame(0); app.frame(180); app.frame(334);
  assert.equal(api.players[0].snake[0].y, 9);
  assert.equal(api.players[1].snake[0].y, 11);
  assert.notEqual(api.players[0].agent.turns, api.players[1].agent.turns);
  assert.notEqual(api.players[0].snake, api.players[1].snake);
});

test('snake interpolates every frame without changing grid positions and follows turn corners', () => {
  const app = boot(), {api} = app; api.start();
  const p = api.players[0]; p.food = {x:0,y:0};
  app.frame(0); app.frame(250);
  assert.equal(p.snake[0].x,10);
  assert.equal(api.visibleSnake(p)[0].x,9);
  const draws = app.draws[0]; app.frame(375);
  assert.equal(p.snake[0].x,10);
  assert.equal(api.visibleSnake(p)[0].x,9.5);
  assert.ok(app.draws[0] > draws, 'movement redraws without particles or a grid step');
  api.turn(p,'up'); app.frame(500);
  assert.equal(p.snake[0].x,10); assert.equal(p.snake[0].y,9);
  assert.equal(api.visibleSnake(p)[0].x,10); assert.equal(api.visibleSnake(p)[0].y,10);
  app.frame(625);
  const head = api.visibleSnake(p)[0], body = api.visibleSnake(p)[1];
  assert.equal(head.x,10); assert.equal(head.y,9.5);
  assert.equal(body.x,9.5); assert.equal(body.y,10);
  api.togglePause(); const frozen = JSON.stringify(api.visibleSnake(p));
  app.frame(1000); assert.equal(JSON.stringify(api.visibleSnake(p)),frozen);
  api.togglePause(); app.frame(1100); assert.equal(JSON.stringify(api.visibleSnake(p)),frozen);
  app.frame(1160); assert.ok(api.visibleSnake(p)[0].y < 9.5);
  api.start(); assert.equal(p.motionProgress,1); assert.equal(api.visibleSnake(p)[0].x,9);
});

test('boost and release preserve the displayed position and dual players interpolate independently', () => {
  const app = boot(), {api} = app; api.setMode('dual'); api.start();
  const [p1,p2] = api.players; p1.food = p2.food = {x:0,y:0};
  app.frame(0); app.frame(250); app.frame(350);
  let before = JSON.stringify(api.visibleSnake(p1));
  app.key('d','KeyD'); api.updateBoost(p1,500);
  assert.equal(JSON.stringify(api.visibleSnake(p1)),before);
  app.frame(450); app.frame(500);
  assert.notEqual(api.visibleSnake(p1)[0].x,api.visibleSnake(p2)[0].x);
  before = JSON.stringify(api.visibleSnake(p1));
  app.events.keyup({key:'d',code:'KeyD'});
  assert.equal(JSON.stringify(api.visibleSnake(p1)),before);
  api.setMode('single'); assert.ok(api.players.every(p => p.motionProgress === 1));
});

test('releasing boost keeps moving on every frame at the earned speed, without a stall', () => {
  for (const length of [3,10]) for (const offset of [0,30,90]) {
    const app = boot(), {api} = app; api.start(); const p = api.players[0];
    p.snake = Array.from({length},(_,i)=>({x:9-i,y:10})); p.food = {x:0,y:0};
    app.frame(0); app.key('d','KeyD'); api.updateBoost(p,500);
    app.frame(100); app.frame(100+offset);
    let previous = api.visibleSnake(p)[0].x;
    app.events.keyup({key:'d',code:'KeyD'});
    assert.equal(api.visibleSnake(p)[0].x,previous,'release must not jump');
    for (let time=125+offset;time<=500+offset;time+=25) {
      app.frame(time); const current = api.visibleSnake(p)[0].x;
      assert.ok(Math.abs(current-previous-api.speed(p)*.025)<1e-6,
        `length ${length}, release offset ${offset}, frame ${time}: movement ${current-previous}`);
      previous = current;
    }
  }
});

test('speed starts at 4 cells/s, adds exactly 0.1 per fruit, and caps at 10 after 60 fruits', () => {
  const { api } = boot();
  assert.equal(api.delay(api.players[0]), 1000 / 4);
  let previous = 1000 / 4;
  for (let length = 3; length <= 400; length++) {
    const current = api.delay({snake: {length}});
    assert.equal(api.speed({snake:{length}}), Math.min(100, 40 + length - 3) / 10);
    assert.ok(current <= previous && current >= 100);
    if (previous > 100 && length > 3) assert.ok(current < previous);
    previous = current;
  }
  assert.equal(api.delay({snake: {length: 63}}), 100);
  assert.equal(api.delay({snake: {length: 400}}), 100);
});

test('eating changes only that player’s score, length and speed; food stays outside its snake', () => {
  const { api } = boot();
  api.setMode('dual'); api.start();
  const [p1, p2] = api.players;
  p1.food = {x:10,y:10}; api.step(p1);
  assert.equal(p1.score, 10); assert.equal(p1.snake.length, 4); assert.equal(api.delay(p1), 1000 / 4.1);
  assert.equal(p2.score, 0); assert.equal(p2.snake.length, 3); assert.equal(api.delay(p2), 1000 / 4);
  assert.ok(!p1.snake.some(part => part.x === p1.food.x && part.y === p1.food.y));
});

test('different lengths run on independent clocks in the same animation loop', () => {
  const app = boot(), { api } = app;
  api.setMode('dual'); api.start();
  const [p1, p2] = api.players;
  while (p1.snake.length < 63) {
    const index = p1.snake.length - 3;
    p1.snake.push({x:index % 20, y:14 + Math.floor(index / 20)});
  }
  p1.food = p2.food = {x:0,y:0};
  app.frame(0); app.frame(100);
  assert.equal(p1.snake[0].x, 10); assert.equal(p2.snake[0].x, 9);
  app.frame(200);
  assert.equal(p1.snake[0].x, 11); assert.equal(p2.snake[0].x, 9);
  app.frame(334);
  assert.equal(p1.snake[0].x, 12); assert.equal(p2.snake[0].x, 10);
});

test('a collision ends only its own board; both finishing produces results and a shared restart', () => {
  const { api, ids } = boot({language:'en'});
  api.setMode('dual'); api.start();
  const [p1, p2] = api.players;
  p1.snake[0] = {x:19,y:10}; api.step(p1);
  assert.equal(p1.alive, false); assert.equal(p2.alive, true); assert.equal(api.get().state, 'running');
  assert.equal(ids['overlay-1'].hidden, false); assert.equal(ids['overlay-2'].hidden, true);
  assert.equal(ids['play-1'].hidden, true);
  assert.equal(ids['text-1'].textContent, 'Score: 0');
  assert.equal(ids['overlay-1'].classList.contains('result'), true);
  assert.equal(ids['overlay-2'].classList.contains('result'), false);
  p2.food = {x:10,y:10}; api.step(p2);
  assert.equal(p2.score, 10);
  p2.snake[0] = {x:19,y:10}; api.step(p2);
  assert.equal(api.get().state, 'over');
  assert.equal(ids['kicker-1'].textContent, 'Player 1');
  assert.equal(ids['kicker-2'].textContent, 'Player 2');
  assert.equal(ids['text-1'].textContent, 'Score: 0');
  assert.equal(ids['text-2'].textContent, 'Score: 10');
  api.setLanguage('zh-CN');
  assert.equal(ids['text-1'].textContent, '得分：0');
  assert.equal(ids['text-2'].textContent, '得分：10');
  ids.restart.handlers.click();
  assert.equal(ids['overlay-1'].classList.contains('result'), false);
  assert.equal(ids['overlay-2'].classList.contains('result'), false);
  for (const player of api.players) {
    assert.equal(player.alive, true); assert.equal(player.score, 0); assert.equal(api.delay(player), 1000 / 4);
  }
});

test('single results show only this score and celebrate strictly beating the starting record', () => {
  const {api, ids, storage} = boot({savedBest:10});
  const player = api.players[0];
  const eat = () => { player.food = {x:player.snake[0].x+1,y:10}; api.step(player); };
  for (const fruits of [0,1,2]) {
    api.start();
    assert.equal(ids['overlay-1'].classList.contains('new-record'), false);
    for (let i=0;i<fruits;i++) eat();
    api.finish(player);
    assert.equal(ids['text-1'].textContent, '得分：' + fruits*10);
    assert.equal(ids['overlay-1'].classList.contains('new-record'), fruits === 2);
    assert.equal(ids['kicker-1'].textContent, fruits === 2 ? '游戏结束' : '单人模式');
    assert.equal(ids['title-1'].textContent, fruits === 2 ? '新纪录！' : '游戏结束');
  }
  assert.equal(storage.get('pixel-snake-best'), '20');
  api.setLanguage('en');
  assert.equal(ids['title-1'].textContent, 'New record!');
  assert.equal(ids['kicker-1'].textContent, 'Game over');
  assert.equal(ids['text-1'].textContent, 'Score: 20');
  assert.equal(ids['overlay-1'].classList.contains('new-record'), true);
  api.start(); eat(); eat(); api.finish(player);
  assert.equal(ids['overlay-1'].classList.contains('new-record'), false);
  api.setMode('dual'); api.start(); eat(); eat(); eat(); api.finish(player);
  assert.equal(ids['overlay-1'].classList.contains('new-record'), false);
  assert.equal(ids['text-1'].textContent, 'Score: 30');
});

test('new record celebration works without local storage', () => {
  const {api, ids} = boot({blockedStorage:true});
  api.start(); const player = api.players[0];
  player.food = {x:10,y:10}; api.step(player); api.finish(player);
  assert.equal(ids['title-1'].textContent, '新纪录！');
  assert.equal(ids['kicker-1'].textContent, '游戏结束');
  assert.equal(ids['overlay-1'].classList.contains('new-record'), true);
});

test('body collisions, vacating the tail, reverse prevention and buffered turns remain correct', () => {
  const { api } = boot(); api.start(); const player = api.players[0];
  api.turn(player, 'left'); assert.equal(player.agent.turns.length, 0);
  api.turn(player, 'up'); api.turn(player, 'left'); api.turn(player, 'down');
  assert.equal(player.agent.turns.length, 2);
  api.step(player); api.step(player); assert.equal(player.direction.x, -1);
  api.start(); player.food = {x:0,y:0};
  player.snake = [{x:9,y:10},{x:9,y:11},{x:10,y:11},{x:10,y:10}];
  api.step(player); assert.equal(player.alive, true);
  api.start(); player.food = {x:0,y:0};
  player.snake = [{x:9,y:10},{x:9,y:11},{x:10,y:11},{x:10,y:10},{x:11,y:10}];
  api.step(player); assert.equal(player.alive, false);
});

test('pause freezes both clocks, Space resumes from button focus, and backgrounding pauses', () => {
  const app = boot(), { api } = app;
  api.setMode('dual'); api.start(); app.frame(0);
  app.key(' ', 'Space', {target:app.ids.restart});
  const positions = JSON.stringify(api.players.map(p => p.snake));
  app.frame(1000); assert.equal(JSON.stringify(api.players.map(p => p.snake)), positions);
  assert.equal(api.get().state, 'paused');
  app.key(' ', 'Space', {target:app.ids.restart});
  assert.equal(api.get().state, 'running');
  app.frame(1100); assert.equal(JSON.stringify(api.players.map(p => p.snake)), positions);
  app.document.hidden = true; app.events.visibilitychange(); assert.equal(api.get().state, 'paused');
});

test('mode changes reset both boards, hide the inactive board, and keep its controls inactive', () => {
  const app = boot(), { api } = app;
  api.setMode('dual'); api.start(); api.turn(api.players[1], 'down');
  api.setMode('single');
  assert.equal(api.get().state, 'ready'); assert.equal(app.ids['player-2'].hidden, true);
  assert.equal(api.players[1].agent.turns.length, 0);
  api.start(); api.turn(api.players[1], 'down'); api.step(api.players[1]);
  assert.equal(api.players[1].agent.turns.length, 0); assert.equal(api.players[1].snake[0].y, 10);
});

test('both touch controls and swipes route to their own board', () => {
  const app = boot(), { api } = app;
  api.setMode('dual'); api.start();
  app.elements.find(e => e.dataset.player === '2' && e.dataset.direction === 'down').handlers.click({detail:0});
  const screen = app.ids['screen-1'];
  screen.handlers.pointerdown({target:{closest:()=>null},clientX:50,clientY:50,pointerId:1});
  screen.handlers.pointerup({clientX:50,clientY:10,pointerId:1});
  api.players.forEach(api.step);
  assert.equal(api.players[0].direction.y, -1); assert.equal(api.players[1].direction.y, 1);
});

test('filling a board wins safely and equal scores remain on each player’s own board', () => {
  const { api, ids } = boot({language:'en'}); api.setMode('dual'); api.start();
  const player = api.players[0];
  player.snake = [{x:18,y:19}];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    if (y !== 19 || x < 18) player.snake.push({x,y});
  }
  player.food = {x:19,y:19}; api.step(player);
  assert.equal(player.snake.length, 400); assert.equal(player.food, null); assert.equal(player.won, true);
  assert.equal(ids['title-1'].textContent, 'YOU WIN, 100%');
  assert.equal(ids['overlay-1'].hidden, false);
  assert.equal(api.get().state, 'running');
  api.players[1].score = player.score; api.finish(api.players[1]);
  assert.equal(ids['kicker-1'].textContent, 'Player 1'); assert.equal(api.get().state, 'over');
  assert.equal(ids['text-1'].textContent, 'Score: 10');
  assert.equal(ids['text-2'].textContent, 'Score: 10');
});

test('full-board victory stays visible above a new record and AI auto-restart', () => {
  const app=boot(), {api,ids}=app;
  ids['agent-1'].handlers.change({target:{value:'heuristic'}});
  ids['auto-restart'].handlers.change({target:{checked:true}});
  api.start();
  const player=api.players[0];
  player.score=3970;
  api.finish(player,true);
  for(const language of ['zh-CN','en','fr']) {
    api.setLanguage(language);
    assert.equal(ids['title-1'].textContent,'YOU WIN, 100%');
    assert.equal(ids['kicker-1'].textContent,api.translations[language].newRecord);
    assert.equal(ids['overlay-1'].hidden,false);
  }
  const episode=player.runner.episodeNumber;
  app.frame(0); app.frame(250);
  assert.equal(api.get().state,'over');
  assert.equal(player.runner.episodeNumber,episode);
  assert.equal(ids['title-1'].textContent,'YOU WIN, 100%');
});

test('language, Consolas, saved preference and disabled storage survive the mode changes', () => {
  assert.match(css, /html:lang\(en\) \.cabinet \*\{font-family:Consolas/);
  for (const blockedStorage of [false, true]) {
    const app = boot({language:'en', blockedStorage}), { api, ids } = app;
    assert.deepEqual(Object.keys(api.translations.en).sort(), Object.keys(api.translations['zh-CN']).sort());
    api.setMode('dual'); api.start(); api.togglePause();
    const before = JSON.stringify(api.players.map(p => p.snake));
    api.setLanguage('en');
    assert.equal(app.document.documentElement.lang, 'en'); assert.equal(ids['play-2'].textContent, 'Resume game');
    assert.equal(ids['speed-1'].textContent, '4.0 cells/s');
    assert.equal(ids['game-2'].attrs['aria-label'], 'Player 2 snake board');
    assert.equal(JSON.stringify(api.players.map(p => p.snake)), before);
    assert.equal(api.get().state, 'paused');
    for (const element of app.elements) {
      if (element.dataset.i18n) assert.ok(api.translations.en[element.dataset.i18n]);
      if (element.dataset.i18nAria) assert.equal(element.attrs['aria-label'], api.translations.en[element.dataset.i18nAria]);
    }
    app.key('ArrowUp', 'ArrowUp', {target:new app.HTMLSelectElement(),preventDefault(){throw Error('selector keyboard intercepted');}});
    api.setLanguage('zh-CN'); assert.equal(ids['play-2'].textContent, '继续游戏');
    if (!blockedStorage) assert.equal(app.storage.get('pixel-snake-language'), 'zh-CN');
  }
});

test('training offers three named schemes and explains seed and folder naming',()=>{
  const {api,ids}=boot();
  const options=html.match(/<select id="training-reward">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...options.matchAll(/value="([^"]+)"/g)].map(m=>m[1]),['classic','strategy','ultimate']);
  for(const lang of ['zh-CN','en','fr']) {
    api.setLanguage(lang);
    assert.ok(api.translations[lang].rewardUltimate.includes('ultimate'));
    assert.ok(ids['seed-hint'].textContent.includes('42'));
    assert.ok(api.translations[lang].trainingSaveHint.includes('models/ultimate'));
  }
  ids['training-model'].value='ultimate/source.pt';
  ids['training-model'].handlers.change();
  assert.equal(ids['training-seed'].disabled,true);
  ids['training-model'].value='';ids['training-model'].handlers.change();
  assert.equal(ids['training-seed'].disabled,false);
});

test('missing Canvas reports a translated error and prevents starting the affected mode', () => {
  const { api, ids } = boot({language:'en', missingCanvas:2});
  api.start(); assert.equal(api.get().state, 'running');
  api.setMode('dual'); api.start(); assert.equal(api.get().state, 'ready');
  assert.equal(ids.start.disabled, true); assert.equal(ids['play-2'].disabled, true);
  assert.equal(ids['text-2'].textContent, api.translations.en.canvasError);
});

test('virtual WASD labels follow player 1 in dual mode and survive language changes', () => {
  const app = boot(), {api} = app;
  const button = (player, direction) => app.elements.find(e => e.dataset.player === String(player) && e.dataset.direction === direction);
  assert.equal(button(1, 'up').textContent, '↑');
  api.setMode('dual');
  for (const [direction, letter] of Object.entries({up:'W',left:'A',down:'S',right:'D'})) {
    assert.equal(button(1, direction).textContent, letter);
  }
  assert.equal(button(2, 'up').textContent, '↑');
  api.setLanguage('en'); assert.equal(button(1, 'up').textContent, 'W');
  api.setMode('single'); assert.equal(button(1, 'up').textContent, '↑');
});

test('physical key presses highlight the correct player until keyup, without repeat turns', () => {
  const app = boot(), {api} = app; api.setMode('dual'); api.start();
  const p1up = app.elements.find(e => e.dataset.player === '1' && e.dataset.direction === 'up');
  const p2down = app.elements.find(e => e.dataset.player === '2' && e.dataset.direction === 'down');
  app.key('w', 'KeyW'); app.key('ArrowDown');
  assert.equal(p1up.classList.contains('pressed'), true);
  assert.equal(p2down.classList.contains('pressed'), true);
  app.key('w', 'KeyW', {repeat:true}); assert.equal(api.players[0].agent.turns.length, 1);
  app.events.keyup({key:'w',code:'KeyW'});
  assert.equal(p1up.classList.contains('pressed'), false);
  assert.equal(p2down.classList.contains('pressed'), true);
  app.events.keyup({key:'ArrowDown',code:'ArrowDown'});
  assert.equal(p2down.classList.contains('pressed'), false);
});

test('virtual buttons move on pointerdown and release on pointerup, cancellation or lost capture', () => {
  const app = boot(), {api} = app; api.setMode('dual'); api.start();
  const up = app.elements.find(e => e.dataset.player === '1' && e.dataset.direction === 'up');
  up.handlers.pointerdown({button:0,pointerId:1});
  assert.equal(up.classList.contains('pressed'), true); assert.equal(api.players[0].agent.turns.length, 1);
  up.handlers.pointerup({pointerId:1}); up.handlers.click({detail:1});
  assert.equal(up.classList.contains('pressed'), false); assert.equal(api.players[0].agent.turns.length, 1);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    up.handlers.pointerdown({button:0,pointerId:2}); up.handlers[type]({pointerId:2});
    assert.equal(up.classList.contains('pressed'), false);
  }
  up.handlers.pointerdown({button:2,pointerId:3}); assert.equal(up.classList.contains('pressed'), false);
});

test('shared keys and pointers keep a button pressed until all input sources release it', () => {
  const app = boot(); app.api.start();
  const up = app.elements.find(e => e.dataset.player === '1' && e.dataset.direction === 'up');
  app.key('w', 'KeyW'); app.key('ArrowUp'); up.handlers.pointerdown({button:0,pointerId:1});
  app.events.keyup({key:'w',code:'KeyW'}); app.events.keyup({key:'ArrowUp',code:'ArrowUp'});
  assert.equal(up.classList.contains('pressed'), true);
  up.handlers.pointerup({pointerId:1}); assert.equal(up.classList.contains('pressed'), false);
});

test('pressed controls clear on pause, restart, mode switch, blur, backgrounding and player death', () => {
  const app = boot(), {api} = app;
  const anyPressed = () => app.elements.some(e => e.classList.contains('pressed'));
  const actions = [
    () => api.togglePause(), () => api.start(), () => api.setMode('dual'),
    () => app.windowEvents.blur(),
    () => { app.document.hidden = true; app.events.visibilitychange(); },
    () => api.finish(api.players[0])
  ];
  for (const action of actions) {
    api.setMode('single'); api.start(); app.key('w', 'KeyW');
    assert.equal(anyPressed(), true); action(); assert.equal(anyPressed(), false);
  }
});

test('fruit emits particles at its own board and flashes only its own updated score', () => {
  const app = boot(), {api,ids} = app;
  api.setMode('dual'); api.start(); const [p1,p2] = api.players;
  p1.food = {x:10,y:10}; api.step(p1);
  assert.equal(p1.particles.length, 16); assert.equal(p2.particles.length, 0);
  assert.ok(p1.particles.every(p => p.x === 252 && p.y === 252));
  assert.ok(p1.particles.every(p => p.length > p.width * 4 && p.width <= 1.5));
  assert.equal(p1.growthFlashes.length, 1); assert.equal(p2.growthFlashes.length, 0);
  assert.equal(ids['score-1'].textContent, 10);
  assert.equal(ids['score-1'].classList.contains('score-pop'), true);
  assert.equal(ids['score-2'].classList.contains('score-pop'), false);
  ids['score-1'].handlers.animationend({animationName:'score-pop'});
  assert.equal(ids['score-1'].classList.contains('score-pop'), false);
  p1.food = {x:11,y:10}; api.step(p1);
  assert.equal(ids['score-1'].classList.contains('score-pop'), true);
  assert.equal(ids['score-1'].textContent, 20);
  assert.equal(ids['speed-1'].textContent, '4.2 格/秒');
  assert.equal(ids['speed-2'].textContent, '4.0 格/秒');
});

test('particles animate between snake steps, freeze while paused, expire, and reset cleanly', () => {
  const app = boot(), {api} = app; api.start(); const player = api.players[0];
  player.food = {x:10,y:10}; api.step(player); app.frame(0);
  const position = JSON.stringify(player.snake), firstX = player.particles[0].x, drawn = app.draws[0];
  app.frame(16);
  assert.equal(JSON.stringify(player.snake), position);
  assert.notEqual(player.particles[0].x, firstX); assert.ok(app.draws[0] > drawn);
  api.togglePause(); const effects = JSON.stringify(player.particles); app.frame(100);
  assert.equal(JSON.stringify(player.particles), effects);
  api.togglePause(); api.finish(player);
  app.frame(200); app.frame(400); app.frame(600); app.frame(800); app.frame(1000); app.frame(1200);
  assert.equal(player.particles.length, 0);
  assert.equal(player.growthFlashes.length, 0);
  api.start(); player.food = {x:10,y:10}; api.step(player);
  api.setMode('dual'); assert.ok(api.players.every(p => p.particles.length === 0));
  assert.equal(app.ids['score-1'].classList.contains('score-pop'), false);
});

test('rays keep radial trajectories and only the new body slot flashes as the snake moves', () => {
  const app = boot(), {api,canvasPaint} = app; api.start(); const player = api.players[0];
  player.food = {x:10,y:10}; api.step(player);
  const velocities = player.particles.map(p => [p.vx,p.vy]);
  const blocks = () => {
    canvasPaint[0].length = 0; api.draw(player);
    return canvasPaint[0].filter(p => p.kind === 'fill' && p.shadowColor === '#b5ff70' && p.shadowBlur === 0);
  };
  let painted = blocks();
  assert.deepEqual(painted.slice(0,3).map(p => p.fillStyle), ['#f1faff','#b5ff70','#63c244']);
  assert.equal(painted[3].fillStyle, '#ffffff');
  assert.equal(player.growthFlashes[0].life, 1000);
  assert.ok(canvasPaint[0].some(p => p.kind === 'fill' && p.shadowColor === '#ff5f76' && p.shadowBlur > 8));
  const rays = canvasPaint[0].filter(p => p.kind === 'stroke' && p.shadowBlur === 6);
  assert.equal(rays.length,16);
  assert.ok(rays.every(p => p.shape.length === 4 && p.lineWidth <= 1.5 && p.lineCap === 'round'));
  app.frame(0); app.frame(150); app.frame(300);
  player.particles.forEach((p,i) => {
    assert.equal(p.vx,velocities[i][0]); assert.equal(p.vy,velocities[i][1]);
    assert.ok((p.x-252)*p.vx + (p.y-252)*p.vy > 0);
  });
  assert.notEqual(blocks()[3].fillStyle, '#b5ff70');
  player.particles = []; player.food = {x:0,y:0}; api.step(player);
  app.frame(450); painted = blocks();
  assert.notEqual(painted[3].fillStyle, '#ffffff');
  assert.equal(painted[3].shape[0], api.visibleSnake(player)[3].x * 24 + 2);
  api.togglePause(); const age = player.growthFlashes[0].age;
  app.frame(750); assert.equal(player.growthFlashes[0].age, age);
  api.togglePause(); api.finish(player); app.frame(850); app.frame(1100); app.frame(1350); app.frame(1600);
  assert.equal(player.growthFlashes.length,0);
  assert.equal(blocks()[3].fillStyle, '#b5ff70');
  api.start(); player.food = {x:10,y:10}; api.step(player);
  player.food = {x:11,y:10}; api.step(player);
  assert.deepEqual(Array.from(player.growthFlashes,flash => flash.index),[3,4]);
  api.setMode('dual'); assert.ok(api.players.every(p => p.growthFlashes.length === 0));
});

test('sound unlocks on start, plays once per fruit for each player and releases audio nodes', () => {
  const app = boot({audio:true}), {api,audioLog} = app;
  assert.equal(audioLog.contexts, 0);
  api.setMode('dual'); api.start();
  assert.equal(audioLog.contexts, 1); assert.equal(audioLog.resumes, 1); assert.equal(audioLog.oscillators.length, 0);
  for (const player of api.players) { player.food = {x:10,y:10}; api.step(player); }
  assert.equal(audioLog.oscillators.length, 2);
  assert.equal(audioLog.oscillators[0].pitch, 660); assert.equal(audioLog.oscillators[1].pitch, 880);
  audioLog.oscillators.forEach((oscillator, index) => {
    assert.ok(oscillator.stopped > oscillator.started);
    oscillator.onended(); assert.equal(oscillator.disconnected, true); assert.equal(audioLog.gains[index].disconnected, true);
  });
  api.start(); assert.equal(audioLog.contexts, 1);
});

test('blocked audio and reduced motion preserve scoring and acceleration', () => {
  const app = boot({audio:true,brokenAudio:true,reducedMotion:true}), {api} = app;
  api.start(); const player = api.players[0]; player.food = {x:10,y:10}; api.step(player);
  assert.equal(player.score, 10); assert.equal(api.speed(player), 4.1); assert.equal(player.particles.length, 4);
  assert.equal(api.get().state, 'running');
});

test('shop starts with two free skins and equips either player without changing game mechanics', () => {
  const app = boot(), {api,ids} = app;
  assert.equal(api.get().coins, 0);
  assert.equal(api.get().ownedSkins.length, 2);
  assert.equal(ids['skin-buy-pink'].disabled, true);
  assert.equal(ids['skin-buy-cyan'].disabled, false);
  api.start(); const player = api.players[0]; player.food = {x:10,y:10}; api.step(player);
  api.openShop();
  const before = JSON.stringify(api.players), originalSpeed = api.speed(player);
  const panelStyle = JSON.stringify(ids['player-1'].style);
  ids['skin-buy-cyan'].handlers.click();
  assert.equal(api.get().equippedSkins[0], 'cyan'); assert.equal(api.get().equippedSkins[1], 'cyan');
  assert.equal(api.get().coins, 5); assert.equal(api.speed(player), originalSpeed);
  assert.equal(JSON.stringify(api.players), before);
  assert.equal(JSON.stringify(ids['player-1'].style), panelStyle);
  api.selectShopPlayer(2); api.buySkin('lime');
  assert.equal(api.get().equippedSkins[1], 'lime');
  api.start(); assert.equal(api.get().equippedSkins[1], 'lime'); assert.equal(api.get().coins, 5);
});

test('both players earn shared coins; unlock charges once and the purchased skin equips both players', () => {
  const app = boot(), {api,ids} = app; api.setMode('dual'); api.start();
  for (let fruit = 0; fruit < 3; fruit++) for (const player of api.players) {
    player.food = {x:player.snake[0].x + 1,y:10}; api.step(player);
  }
  assert.equal(api.get().coins, 30);
  assert.equal(ids.coins.textContent, 30); assert.equal(ids['shop-coins'].textContent, 30);
  assert.equal(ids['skin-buy-pink'].disabled, false);
  api.openShop(); ids['skin-buy-pink'].handlers.click();
  assert.equal(api.get().coins, 0); assert.ok(api.get().ownedSkins.includes('pink'));
  assert.equal(api.get().equippedSkins[0], 'pink'); assert.equal(ids['skin-buy-pink'].disabled, true);
  api.buySkin('pink'); assert.equal(api.get().coins, 0);
  app.elements.find(e => e.dataset.shopPlayer === '2').handlers.click();
  ids['skin-buy-pink'].handlers.click();
  assert.equal(api.get().equippedSkins[1], 'pink'); assert.equal(api.get().coins, 0);
  api.buySkin('solar'); assert.equal(api.get().coins, 0); assert.ok(!api.get().ownedSkins.includes('solar'));
  const saved = JSON.parse(app.storage.get('pixel-snake-shop'));
  assert.deepEqual(saved.equipped, ['pink','pink']); assert.equal(saved.coins, 0);
});

test('shop inventory persists, rejects broken records, and works when storage is denied', () => {
  const savedShop = {coins:120,owned:['lime','cyan','pink'],equipped:['pink','cyan']};
  const app = boot({savedShop}), {api} = app;
  assert.equal(api.get().coins, 120); assert.equal(api.get().equippedSkins[0], 'pink');
  api.buySkin('solar'); assert.equal(api.get().coins, 20);
  const next = boot({savedShop:app.storage.get('pixel-snake-shop')});
  assert.equal(next.api.get().coins, 20); assert.equal(next.api.get().equippedSkins[0], 'solar');
  assert.ok(next.api.get().ownedSkins.includes('solar'));
  const malformed = boot({savedShop:'not json'});
  assert.equal(malformed.api.get().coins, 0); assert.equal(malformed.api.get().equippedSkins[0], 'lime');
  const invalid = boot({savedShop:{coins:-5,owned:['made-up',null],equipped:['solar','made-up']}});
  assert.equal(invalid.api.get().coins, 0); assert.equal(invalid.api.get().ownedSkins.length, 2);
  assert.equal(invalid.api.get().equippedSkins[0], 'lime'); assert.equal(invalid.api.get().equippedSkins[1], 'cyan');
  const denied = boot({blockedStorage:true}); denied.api.start();
  denied.api.players[0].food = {x:10,y:10}; denied.api.step(denied.api.players[0]);
  assert.equal(denied.api.get().coins, 5); denied.api.buySkin('cyan');
  assert.equal(denied.api.get().equippedSkins[0], 'cyan'); assert.equal(denied.ids['shop-storage'].hidden, false);
});

test('shop pauses gameplay and ignores game keys until closed; language switch preserves purchases', () => {
  const app = boot({savedShop:{coins:30,owned:[],equipped:[]}}), {api,ids} = app;
  api.setMode('dual'); api.start(); ids['shop-open'].handlers.click();
  assert.equal(api.get().state, 'paused'); assert.equal(ids['skin-shop'].open, true);
  app.key(' ', 'Space'); app.key('w','KeyW');
  assert.equal(api.get().state, 'paused'); assert.equal(api.players[0].agent.turns.length, 0);
  api.buySkin('pink'); api.setLanguage('en');
  assert.equal(ids['skin-buy-pink'].textContent, 'Equipped');
  assert.match(ids['shop-message'].textContent, /Neon Sakura/);
  assert.equal(api.get().coins, 0); api.setLanguage('zh-CN');
  assert.equal(ids['skin-buy-pink'].textContent, '已装备');
  ids['shop-close'].handlers.click(); assert.equal(ids['skin-shop'].open, false);
  assert.equal(api.get().state, 'paused'); app.key(' ', 'Space'); assert.equal(api.get().state, 'running');
});

test('particles stay red and green across skins while panels keep cyan and pink accents', () => {
  assert.match(css, /\.player\{[^}]*--panel-accent:var\(--cyan\)/);
  assert.match(css, /\.player\.second\{[^}]*--panel-accent:var\(--pink\)/);
  for (const skin of ['lime','cyan','pink','violet','solar','prism']) {
    const app = boot({savedShop:{coins:0,owned:[skin],equipped:[skin,'cyan']}}), {api,ids} = app;
    for (const id of [1,2]) assert.equal(ids['player-' + id].style['--panel-accent'], undefined);
    const panelStyles = JSON.stringify([ids['player-1'].style,ids['player-2'].style]);
    api.selectShopPlayer(2); api.buySkin(skin);
    assert.equal(JSON.stringify([ids['player-1'].style,ids['player-2'].style]), panelStyles);
    api.start(); const player = api.players[0]; player.food = {x:10,y:10}; api.step(player);
    assert.deepEqual([...new Set(player.particles.map(p => p.color))], ['#ff4055','#65ef79']);
    assert.equal(api.speed(player), 4.1);
  }
});

test('hold current direction for half a second boosts to 10; releasing restores earned speed', () => {
  const app = boot(), {api} = app; api.start();
  const player = api.players[0]; player.food = {x:0,y:0};
  app.frame(0); app.key('d','KeyD');
  for (let time=100;time<=400;time+=100) app.frame(time);
  app.frame(499); assert.equal(player.boosting, false); assert.equal(api.currentSpeed(player), 4);
  app.frame(500); assert.equal(player.boosting, true); assert.equal(api.delay(player), 100);
  assert.equal(app.ids['player-1'].classList.contains('boosting'), true);
  assert.match(app.ids['speed-1'].textContent, /10\.0/);
  player.food = {x:player.snake[0].x+1,y:10}; api.step(player);
  assert.equal(api.currentSpeed(player), 10); assert.equal(api.speed(player), 4.1);
  app.events.keyup({key:'d',code:'KeyD'});
  assert.equal(player.boosting, false); assert.equal(api.currentSpeed(player), 4.1);
  assert.equal(app.ids['player-1'].classList.contains('boosting'), false);
});

test('only uninterrupted forward input charges boost; repeats do not restart the timer', () => {
  const app = boot(), {api} = app; api.start(); const player = api.players[0];
  app.key('a','KeyA'); api.updateBoost(player,2100); assert.equal(player.boosting,false);
  app.events.keyup({key:'a',code:'KeyA'});
  app.key('d','KeyD'); api.updateBoost(player,250);
  app.events.keyup({key:'d',code:'KeyD'}); app.key('d','KeyD');
  api.updateBoost(player,250); assert.equal(player.boosting,false);
  app.key('d','KeyD',{repeat:true}); api.updateBoost(player,249); assert.equal(player.boosting,false);
  api.updateBoost(player,1); assert.equal(player.boosting,true);
  app.key('w','KeyW'); api.step(player);
  assert.equal(player.direction.y,-1); assert.equal(player.boosting,false); assert.equal(player.boostHeldMs,0);
});

test('two players charge independently and virtual-button boost ends on cancellation', () => {
  const app = boot(), {api} = app; api.setMode('dual'); api.start();
  app.key('d','KeyD'); api.players.forEach(p=>api.updateBoost(p,500));
  assert.equal(api.players[0].boosting,true); assert.equal(api.players[1].boosting,false);
  const right = app.elements.find(e=>e.dataset.player==='2' && e.dataset.direction==='right');
  right.handlers.pointerdown({button:0,pointerId:10}); api.updateBoost(api.players[1],500);
  assert.equal(api.players[1].boosting,true);
  right.handlers.pointercancel({pointerId:10});
  assert.equal(api.players[1].boosting,false); assert.equal(api.players[0].boosting,true);
});

test('pause, shop, restart, mode switch, loss of focus and collision clear boost', () => {
  const app = boot(), {api} = app;
  for (const action of [()=>api.togglePause(),()=>api.openShop(),()=>api.start(),()=>api.setMode('dual'),()=>app.windowEvents.blur(),()=>api.finish(api.players[0])]) {
    app.ids['skin-shop'].close(); api.setMode('single'); api.start();
    app.key('d','KeyD'); api.updateBoost(api.players[0],500); assert.equal(api.players[0].boosting,true);
    action(); assert.equal(api.players[0].boosting,false); assert.equal(api.players[0].boostHeldMs,0);
  }
});

test('solid skins unlock, persist and use one color for both head and body', () => {
  const app = boot({savedShop:{coins:100,owned:[],equipped:[]}}), {api} = app;
  for (const skin of ['solid_cyan','solid_pink','solid_white']) {
    api.buySkin(skin); assert.ok(api.get().ownedSkins.includes(skin));
    assert.equal(api.skins[skin].accent,api.skins[skin].alternate);
    assert.equal(app.ids['skin-card-'+skin].style['--skin-head'],api.skins[skin].accent);
  }
  assert.equal(api.get().coins,20);
  const reloaded = boot({savedShop:app.storage.get('pixel-snake-shop')});
  assert.equal(reloaded.api.get().equippedSkins[0],'solid_white');
});

test('all skins match shop colors, rounded corners and a uniform glow; fruit is a pixel apple', () => {
  for (const skin of ['lime','cyan','pink','violet','solar','prism','solid_cyan','solid_pink','solid_white']) {
    const app = boot({savedShop:{owned:[skin],equipped:[skin,skin]}}), {api,ids,canvasPaint} = app;
    const card = ids['skin-card-' + skin];
    const referenceMain = card.attrs.style.match(/--skin-color:(#[0-9a-f]+)/)[1];
    const referenceHead = api.skins[skin].solid ? referenceMain : '#f1faff';
    const referenceAlt = card.attrs.style.match(/--skin-alt:(#[0-9a-f]+)/)[1];
    assert.equal(card.style['--skin-color'], referenceMain);
    assert.equal(card.style['--skin-alt'], referenceAlt);
    api.setMode('dual');
    for (const player of api.players) {
      player.snake = Array.from({length:6}, (_, i) => ({x:9-i,y:10}));
      player.food = {x:15,y:15};
      player.particles = [{x:228,y:252,ux:1,uy:0,length:10,width:1,age:0,life:400,color:'#ff00ab'}];
      canvasPaint[player.id - 1].length = 0;
      api.draw(player);
      const particleIndex = canvasPaint[player.id - 1].findIndex(p => p.kind === 'stroke' && p.strokeStyle === '#ff00ab');
      const snakeIndex = canvasPaint[player.id - 1].findIndex(p => p.kind === 'fill' && p.fillStyle === referenceHead && p.shadowBlur === 0);
      assert.ok(particleIndex >= 0 && particleIndex < snakeIndex, 'the snake must be painted above overlapping particles');
      const segments = canvasPaint[player.id - 1].filter(p => p.kind === 'fill' && p.shadowColor === referenceMain && p.shadowBlur === 0);
      assert.deepEqual(segments.map(p => p.fillStyle), [referenceHead,referenceMain,referenceAlt,referenceMain,referenceAlt,referenceMain]);
      assert.ok(segments.every(p => p.globalAlpha === 1 && p.shape[4] === 5));
      const glowIndexes = canvasPaint[player.id - 1].map((p,index) => p.kind === 'fill' && p.shadowBlur > 0 ? index : -1).filter(index => index >= 0);
      assert.ok(glowIndexes.every(index => index < snakeIndex), 'all glows must be below the final opaque blocks');
      const glow = canvasPaint[player.id - 1].filter(p => p.kind === 'fill' && p.shadowColor === 'rgba(174,239,255,.5)' && p.shadowBlur === 8);
      assert.equal(glow.length, 6);
      const apple = canvasPaint[player.id - 1].filter(p => p.kind === 'fillRect' && ['#ff5f76','#7cde7d','#b98b52'].includes(p.fillStyle));
      assert.ok(apple.some(p => p.fillStyle === '#7cde7d'), 'original apple has a green leaf');
      assert.ok(apple.some(p => p.fillStyle === '#b98b52'), 'apple has a brown stem');
      assert.ok(apple.every(p => p.shape[2] === 2 && p.shape[3] === 2 && p.globalAlpha === 1 && p.shadowBlur === 0));
      const appleWidth = Math.max(...apple.map(p => p.shape[0]+p.shape[2])) - Math.min(...apple.map(p => p.shape[0]));
      assert.equal(appleWidth, 20);
      assert.equal(Math.max(...apple.map(p => p.shape[1]+p.shape[3])) - Math.min(...apple.map(p => p.shape[1])), 20);
      const eyes = canvasPaint[player.id - 1].filter(p => p.kind === 'fillRect' && p.fillStyle === '#0a1024');
      assert.equal(eyes.length, 2);
      assert.ok(eyes.every(p => p.shape[2] === 3 && p.shape[3] === 3));
      assert.equal(card.style['--skin-head'], referenceHead);
      assert.equal(card.style['--skin-eye'], '#0a1024');
      assert.equal(card.style['--skin-radius'], '5px');
      assert.equal(card.style['--skin-glow'], '8px');
      assert.equal(card.style['--skin-glow-color'], 'rgba(174,239,255,.5)');
    }
  }
});


test('production engine and controller integrate without any state-fixture hooks', () => {
  const app = boot({legacyFixtures:false}), {api, ids} = app;
  api.setMode('dual'); ids.start.handlers.click();
  assert.ok(api.players.every(p => p.engine.setStateForTest === undefined));
  app.key('w','KeyW'); app.key('ArrowDown');
  app.frame(0); app.frame(250);
  assert.equal(api.players[0].model.snake[0].y, 9);
  assert.equal(api.players[1].model.snake[0].y, 11);
  for (const player of api.players) {
    assert.equal(JSON.stringify(player.model), JSON.stringify(player.engine.getState()));
    const snapshot = player.engine.getState(); snapshot.snake[0].x = -1;
    assert.notEqual(player.model.snake[0].x, -1);
  }
  for (let time = 500; time <= 3000; time += 250) app.frame(time);
  assert.equal(api.get().state, 'over');
  assert.ok(api.players.every(p => p.engine.isGameOver()));
  ids.restart.handlers.click();
  assert.ok(api.players.every(p => !p.engine.isGameOver() && p.model.score === 0));
});

test('controller selectors route each agent through the same engine and AI ignores human direction input', () => {
  const app = boot({legacyFixtures:false,language:'en'}), {api,ids} = app;
  const p = api.players[0];
  for (const type of ['random','heuristic','human']) {
    ids['agent-1'].handlers.change({target:{value:type}});
    assert.equal(p.agentType, type);
    assert.equal(api.get().state, 'ready');
    api.start();
    const actionCount = {chosen:0,stepped:0};
    const choose = p.agent.chooseAction.bind(p.agent), step = p.engine.step.bind(p.engine);
    p.agent.chooseAction = state => { actionCount.chosen++; return choose(state); };
    p.engine.step = action => { actionCount.stepped++; return step(action); };
    app.key('w','KeyW');
    const button = app.elements.find(e => e.dataset.player === '1' && e.dataset.direction === 'up');
    assert.equal(button.disabled, type !== 'human');
    if (type !== 'human') {
      assert.equal(button.classList.contains('pressed'), false);
      api.updateBoost(p,1000); assert.equal(p.boosting, false);
    }
    api.step(p);
    assert.equal(actionCount.chosen, 1); assert.equal(actionCount.stepped, 1);
    assert.equal(p.model.steps, 1);
    p.engine.step = step;
  }
});

test('fast AI batches many steps per frame while a human board keeps its normal clock', () => {
  const app = boot({legacyFixtures:false}), {api,ids} = app;
  api.setMode('dual');
  ids['agent-2'].handlers.change({target:{value:'heuristic'}});
  ids['ai-speed'].handlers.change({target:{value:'6000'}});
  api.start();
  const p = api.players[1]; p.model = p.runner.reset({seed:42,countEpisode:false});
  app.frame(0); app.frame(16);
  assert.ok(p.model.steps >= 90, 'roughly 96 AI ticks run within a single 16 ms frame');
  assert.equal(api.players[0].model.steps, 0);
  assert.equal(p.motionProgress, 1);
  assert.equal(p.particles.length, 0);
  api.togglePause(); const before = p.model.steps;
  app.frame(1000); assert.equal(p.model.steps,before);
  api.togglePause(); app.frame(1100); assert.equal(p.model.steps,before);
  ids['ai-speed'].handlers.change({target:{value:'normal'}});
  assert.equal(api.currentSpeed(p),api.speed(p));
});

test('headless browser mode performs no canvas drawing or audio and works without Canvas', () => {
  const app = boot({legacyFixtures:false,missingCanvas:1,audio:true}), {api,ids} = app;
  ids['agent-1'].handlers.change({target:{value:'heuristic'}});
  ids['headless'].handlers.change({target:{checked:true}});
  ids['ai-speed'].handlers.change({target:{value:'6000'}});
  const draws = [...app.draws];
  api.start();
  const p = api.players[0]; p.model = p.runner.reset({seed:42,countEpisode:false});
  app.frame(0); app.frame(16);
  assert.equal(api.get().state,'running');
  assert.ok(p.model.steps > 1);
  assert.equal(ids['steps-1'].textContent, p.model.stepsSurvived);
  assert.deepEqual(app.draws,draws);
  assert.equal(app.audioLog.contexts,0);
  assert.equal(p.particles.length,0); assert.equal(p.growthFlashes.length,0);
  assert.equal(ids['game-1'].hidden,true); assert.equal(ids['headless-1'].hidden,false);
  ids['headless'].handlers.change({target:{checked:false}});
  assert.equal(ids['game-1'].hidden,false);
});

test('episode UI displays actual engine counters and death, with new episodes counted only on start', () => {
  const app = boot({legacyFixtures:false,language:'en'}), {api,ids} = app;
  const p = api.players[0];
  assert.equal(ids['episode-1'].textContent,0);
  api.start(); p.model = p.runner.reset({seed:42,countEpisode:false});
  for (let i=0;i<11;i++) api.step(p);
  assert.equal(ids['episode-1'].textContent,1);
  assert.equal(ids['steps-1'].textContent,10);
  assert.equal(ids['food-1'].textContent,0);
  assert.equal(ids['death-1'].textContent,'Wall');
  ids.restart.handlers.click();
  assert.equal(ids['episode-1'].textContent,2);
  assert.equal(ids['steps-1'].textContent,0);
  assert.equal(ids['death-1'].textContent,'—');
  app.key('w','KeyW');
  ids['agent-1'].handlers.change({target:{value:'heuristic'}});
  assert.equal(ids['episode-1'].textContent,2);
  ids['agent-1'].handlers.change({target:{value:'human'}});
  api.start(); assert.equal(ids['episode-1'].textContent,3);
  assert.equal(p.agent.turns.length,0);
});

test('automatic episode restarts require AI on all active boards and respect backgrounding', () => {
  const app = boot({legacyFixtures:false}), {api,ids} = app;
  ids['agent-1'].handlers.change({target:{value:'random'}});
  api.players[0].agent.chooseAction = () => 'RIGHT';
  ids['ai-speed'].handlers.change({target:{value:'6000'}});
  ids['auto-restart'].handlers.change({target:{checked:true}});
  api.start(); app.frame(0); app.frame(250);
  assert.equal(api.get().state,'over');
  app.document.hidden = true; app.frame(266);
  assert.equal(api.players[0].runner.episodeNumber,1);
  app.document.hidden = false; app.frame(282);
  assert.equal(api.players[0].runner.episodeNumber,2);
  assert.equal(api.get().state,'running');
  api.setMode('dual'); api.start();
  for (const p of api.players) for (let i=0;i<11;i++) api.step(p);
  assert.equal(api.get().state,'over');
  const number = api.players[0].runner.episodeNumber;
  app.frame(600); assert.equal(api.players[0].runner.episodeNumber,number);
});

test('changing AI speed preserves a human player’s held boost and movement progress', () => {
  const app = boot({legacyFixtures:false}), {api} = app;
  api.setMode('dual'); api.setAgentType(api.players[1], 'heuristic'); api.start();
  const human = api.players[0];
  app.key('d','KeyD'); api.updateBoost(human,500);
  app.frame(0); app.frame(50);
  const before = JSON.stringify(api.visibleSnake(human));
  api.setAISpeed('6000');
  assert.equal(human.boosting,true);
  assert.equal(api.currentSpeed(human),10);
  assert.equal(JSON.stringify(api.visibleSnake(human)),before);
});


test('actual throughput counts completed steps, not requested speed or waiting decisions', () => {
  const app=boot({legacyFixtures:false,language:'en'}), {api,ids}=app;
  const p=api.players[0]; api.setAgentType(p,'random'); api.setAISpeed('6000'); api.setHeadless(true);
  api.start(); p.agent.chooseAction=()=>null;
  app.frame(0); for(let t=100;t<=1000;t+=100)app.frame(t);
  assert.equal(p.actualRate,0); assert.match(ids['ai-rate-1'].textContent,/Actual 0 steps/);
  assert.match(ids['ai-rate-1'].textContent,/6000/);
  // A safe four-cell loop isolates clock accounting from policy decisions.
  const headings=['UP','RIGHT','DOWN','LEFT'];
  p.agent.chooseAction=s=>{const d=headings.findIndex(a=>app.SnakeEngine.directions[a].x===s.direction.x&&app.SnakeEngine.directions[a].y===s.direction.y);return headings[(d+1)%4]};
  p.model=p.runner.reset({seed:17,countEpisode:false});
  for(let t=1100;t<=2000;t+=100)app.frame(t);
  assert.equal(p.actualRate,p.model.steps); assert.ok(p.actualRate>0); assert.ok(p.actualRate<6000);
  api.togglePause();assert.match(ids['ai-rate-1'].textContent,/Actual 0 steps/);
  api.setAISpeed('600');assert.equal(p.actualRate,null);
});
