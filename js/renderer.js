// Canvas, animation, particles, and sound consume engine snapshots.
(function (root) {
  'use strict';
  root.createSnakeRenderer = function ({size, skinStyle, getSkin}) {
    const $ = id => document.getElementById(id);
    let audioContext = null;
    function unlockAudio() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audioContext) audioContext = new AudioContext();
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      } catch { /* 声音不可用时仍可正常游戏。 */ }
    }
    function playEatSound(player) {
      if (!audioContext || audioContext.state !== 'running') return;
      try {
        const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
        const time = audioContext.currentTime, pitch = player.id === 1 ? 660 : 880;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(pitch, time);
        oscillator.frequency.exponentialRampToValueAtTime(pitch * 1.5, time + .10);
        gain.gain.setValueAtTime(.0001, time);
        gain.gain.exponentialRampToValueAtTime(.08, time + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, time + .14);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(time); oscillator.stop(time + .15);
      } catch { /* 音频设备切换不影响游戏逻辑。 */ }
    }
    function fruitFeedback(player, fruit) {
      const cell = player.canvas.width / size;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const count = reducedMotion ? 4 : 16;
      const colors = ['#ff4055', '#65ef79'];
      for (let i = 0; i < count; i++) {
        const angle = Math.PI * 2 * i / count + Math.random() * .3;
        const velocity = reducedMotion ? 25 : 90 + Math.random() * 90;
        player.particles.push({
          x: (fruit.x + .5) * cell, y: (fruit.y + .5) * cell,
          vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
          ux: Math.cos(angle), uy: Math.sin(angle),
          age: 0, life: reducedMotion ? 180 : 350 + Math.random() * 180,
          length: reducedMotion ? 4 : 7 + Math.random() * 6,
          width: .9 + Math.random() * .6, color: colors[i % colors.length]
        });
      }
      player.particles = player.particles.slice(-80);
      player.growthFlashes.push({index:player.model.snake.length - 1,age:0,life:1000,reducedMotion});
      const scoreElement = $('score-' + player.id);
      scoreElement.classList.remove('score-pop');
      void scoreElement.offsetWidth;
      scoreElement.classList.add('score-pop');
      playEatSound(player);
    }
    function updateParticles(player, delta) {
      for (const particle of player.particles) {
        particle.age += delta;
        particle.x += particle.vx * delta / 1000;
        particle.y += particle.vy * delta / 1000;
      }
      player.particles = player.particles.filter(particle => particle.age < particle.life);
      for (const flash of player.growthFlashes) flash.age += delta;
      player.growthFlashes = player.growthFlashes.filter(flash => flash.age < flash.life);
    }
    function visibleSnake(player) {
      const progress = Math.min(1, player.motionProgress);
      if (progress >= 1) return player.model.snake;
      return player.model.snake.map((target, index) => {
        const from = player.motionFrom[index] || target;
        const via = player.motionVia[index] || target;
        const first = Math.hypot(via.x - from.x, via.y - from.y);
        const second = Math.hypot(target.x - via.x, target.y - via.y);
        const distance = (first + second) * progress;
        const start = distance < first ? from : via;
        const end = distance < first ? via : target;
        const length = distance < first ? first : second;
        const fraction = length ? (distance < first ? distance : distance - first) / length : 1;
        return {x:start.x + (end.x - start.x) * fraction, y:start.y + (end.y - start.y) * fraction};
      });
    }
    function draw(player) {
      const {ctx, canvas} = player;
      const {direction, food} = player.model;
      const snake = visibleSnake(player);
      if (!ctx) return;
      const cell = canvas.width / size, skin = getSkin(player.id);
      const blockSize = cell - 4;
      const fillBlock = (part, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(part.x * cell + 2, part.y * cell + 2, blockSize, blockSize, skinStyle.radius);
        ctx.fill();
      };
      const segmentColor = index => skin.solid ? skin.accent : index === 0 ? skinStyle.head : index % 2 ? skin.accent : skin.alternate;
      const flashStrength = index => {
        const flash = player.growthFlashes.find(item => item.index === index);
        if (!flash) return 0;
        const progress = flash.age / flash.life;
        return flash.reducedMotion ? .65 * (1 - progress) : (1 + Math.cos(progress * Math.PI)) / 2;
      };
      const apple = ['.....gg...','....sg....','..rrsrrr..','.rrrrrrrr.','rrrrrrrrrr','rrrrrrrrrr','rrrrrrrrrr','.rrrrrrrr.','..rrrrrr..','..rr..rr..'];
      const appleColors = {r:'#ff5f76',g:'#7cde7d',s:'#b98b52'};
      const drawApple = glow => {
        const width = Math.max(...apple.map(row => row.length));
        const pixel = blockSize / Math.max(width, apple.length);
        const x = food.x * cell + (cell - width * pixel) / 2, y = food.y * cell + 2;
        if (glow) { ctx.beginPath(); ctx.fillStyle = appleColors.r; }
        apple.forEach((row, iy) => [...row].forEach((color, ix) => {
          if (!appleColors[color]) return;
          const left = Math.round(x + ix * pixel), top = Math.round(y + iy * pixel);
          const width = Math.round(x + (ix + 1) * pixel) - left, height = Math.round(y + (iy + 1) * pixel) - top;
          if (!width || !height) return;
          if (glow) ctx.rect(left, top, width, height);
          else { ctx.fillStyle = appleColors[color]; ctx.fillRect(left, top, width, height); }
        }));
        if (glow) ctx.fill();
      };
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
      ctx.fillStyle = '#090e21'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(117,174,255,.075)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i <= size; i++) {
        ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, canvas.height);
        ctx.moveTo(0, i * cell); ctx.lineTo(canvas.width, i * cell);
      }
      ctx.stroke();
      // All glows go underneath every solid block, so adjacent segments cannot tint one another.
      ctx.save();
      if (food) {
        ctx.shadowColor = '#ff5f76'; ctx.shadowBlur = 8;
        drawApple(true);
      }
      ctx.shadowColor = skinStyle.glowColor; ctx.shadowBlur = skinStyle.glow;
      snake.forEach((part, index) => {
        const amount = flashStrength(index);
        ctx.shadowColor = amount > .1 ? '#ff5f76' : skinStyle.glowColor;
        ctx.shadowBlur = skinStyle.glow + amount * 20;
        fillBlock(part, segmentColor(index));
      });
      ctx.restore();
      if (food) drawApple(false);
      ctx.save();
      for (const particle of player.particles) {
        const fade = Math.max(0, 1 - particle.age / particle.life);
        // Short luminous rays stay aligned with their outward motion, without falling.
        const length = particle.length * (.4 + .6 * fade);
        ctx.globalAlpha = fade; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x + particle.ux * length, particle.y + particle.uy * length);
        ctx.strokeStyle = particle.color; ctx.lineWidth = particle.width;
        ctx.shadowColor = particle.color; ctx.shadowBlur = 6; ctx.stroke();
        ctx.strokeStyle = particle.color === '#ff4055' ? '#ffb2ba' : '#b9ffc4'; ctx.lineWidth = particle.width * .4;
        ctx.shadowBlur = 0; ctx.stroke();
      }
      ctx.restore();
      // Draw the snake last so effects never cover its solid skin blocks.
      ctx.save();
      ctx.shadowColor = skin.accent; ctx.shadowBlur = 0;
      snake.forEach((part, i) => {
        let color = segmentColor(i);
        const amount = flashStrength(i);
        if (amount > 0) {
          // Tint just the newly added body slot; it follows the snake as it moves.
          color = '#' + [1,3,5].map(offset => {
            const channel = parseInt(color.slice(offset, offset + 2), 16);
            const target = 255;
            return Math.round(channel + (target - channel) * amount).toString(16).padStart(2, '0');
          }).join('');
        }
        fillBlock(part, color);
        if (amount > .1) {
          // A warm outline accompanies the single white flash and red halo.
          ctx.save(); ctx.globalAlpha = amount;
          ctx.strokeStyle = '#ffb2ba'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(part.x * cell + 3, part.y * cell + 3, blockSize - 2, blockSize - 2, skinStyle.radius - 1);
          ctx.stroke(); ctx.restore();
        }
        if (i === 0) {
          ctx.fillStyle = skinStyle.eye;
          const cx = part.x * cell + cell / 2 + direction.x * 5, cy = part.y * cell + cell / 2 + direction.y * 5;
          const px = direction.y * 5, py = direction.x * 5;
          ctx.fillRect(cx + px - 1.5, cy + py - 1.5, 3, 3); ctx.fillRect(cx - px - 1.5, cy - py - 1.5, 3, 3);
        }
      });
      ctx.restore();
    }

    return {draw, visibleSnake, fruitFeedback, updateParticles, unlockAudio};
  };
})(globalThis);
