// Hardware events never mutate an engine or its snake.
(function (root) {
  'use strict';
  root.createSnakeInput = function ({players, getMode, getStatus, canControl = () => true, onAction, onRelease, onClear, start, togglePause}) {
    const $ = id => document.getElementById(id);
    const dispatch = (player, name) => onAction(player, root.SnakeEngine.Actions[name.toUpperCase()]);
    const directionButtons = Array.from(document.querySelectorAll('[data-direction]'));
    const pressedInputs = new Map();
    function renderPressedControls() {
      const pressed = new Set(pressedInputs.values());
      directionButtons.forEach(button => button.classList.toggle('pressed', pressed.has(button)));
    }
    function releaseInput(input) {
      pressedInputs.delete(input);
      renderPressedControls();
      onRelease();
    }
    function clearPressedControls(playerId) {
      for (const [input, button] of pressedInputs) {
        if (playerId === undefined || Number(button.dataset.player) === playerId) pressedInputs.delete(input);
      }
      renderPressedControls();
      onClear(playerId);
    }
    directionButtons.forEach(button => {
      const move = () => dispatch(players[Number(button.dataset.player) - 1], button.dataset.direction);
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !canControl(players[Number(button.dataset.player) - 1])) return;
        button.setPointerCapture(event.pointerId);
        pressedInputs.set('pointer:' + event.pointerId, button);
        renderPressedControls();
        move();
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, event => releaseInput('pointer:' + event.pointerId));
      }
      // Pointer input moves on press; retain click activation for keyboard and assistive technology.
      button.addEventListener('click', event => { if (event.detail === 0) move(); });
    });
    const wasd = {KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right',w:'up',s:'down',a:'left',d:'right'};
    const arrows = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
    document.addEventListener('keydown', event => {
      if ($('skin-shop').open || event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLSelectElement) return;
      const letter = wasd[event.code] || wasd[event.key.toLowerCase()], arrow = arrows[event.key];
      if (letter || arrow) {
        event.preventDefault();
        const player = arrow && getMode() === 'dual' ? players[1] : players[0], name = letter || arrow;
        if (!canControl(player)) return;
        const button = directionButtons.find(item => Number(item.dataset.player) === player.id && item.dataset.direction === name);
        pressedInputs.set('key:' + (event.code || event.key.toLowerCase()), button);
        renderPressedControls();
        if (!event.repeat) dispatch(player, name);
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) getStatus() === 'running' || getStatus() === 'paused' ? togglePause() : start();
      }
    });
    document.addEventListener('keyup', event => releaseInput('key:' + (event.code || event.key.toLowerCase())));
    window.addEventListener('blur', () => {
      clearPressedControls();
      if (getStatus() === 'running') togglePause();
    });
    for (const player of players) {
      const screen = $('screen-' + player.id);
      screen.addEventListener('pointerdown', event => {
        if (!canControl(player) || event.target.closest('button')) return;
        player.touch = {x: event.clientX, y: event.clientY, id: event.pointerId}; screen.setPointerCapture(event.pointerId);
      });
      screen.addEventListener('pointerup', event => {
        if (!player.touch || player.touch.id !== event.pointerId) return;
        const dx = event.clientX - player.touch.x, dy = event.clientY - player.touch.y; player.touch = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
        dispatch(player, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      });
      screen.addEventListener('pointercancel', () => { player.touch = null; });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      clearPressedControls();
      if (getStatus() === 'running') togglePause();
    });

    const isHeld = (playerId, name) => [...pressedInputs.values()].some(button => Number(button.dataset.player) === playerId && button.dataset.direction === name.toLowerCase());
    return {clearPressedControls, directionButtons, isHeld};
  };
})(globalThis);
