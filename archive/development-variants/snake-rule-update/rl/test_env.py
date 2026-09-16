"""Run: python -m unittest rl.test_env -v (or python -m rl.test_env)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium.error import ResetNeeded
from gymnasium.utils.env_checker import check_env

if not __package__:
    # Also support `python rl/test_env.py`, whose import root is normally rl/.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rl.random_agent import evaluate
from rl.snake_env import SnakeEnv


class SnakeEnvTests(unittest.TestCase):
    def setUp(self):
        self.env = SnakeEnv()
        self.env.reset(seed=42)
        self.env.food = (0, 0)

    def tearDown(self):
        self.env.close()

    def test_gymnasium_checker(self):
        # A spec lets the checker create every supported render mode as well.
        from gymnasium.envs.registration import EnvSpec
        env = SnakeEnv()
        env.spec = EnvSpec(id="SnakeCheck-v0", entry_point=SnakeEnv)
        try:
            check_env(env)
        finally:
            env.close()

    def test_registered_environment(self):
        # Importing the package registers an optional gym.make entry point.
        import rl  # noqa: F401
        with gym.make("PixelSnake-v0") as env:
            obs, info = env.reset(seed=42)
            self.assertTrue(env.observation_space.contains(obs))
            self.assertEqual(info["score"], 0)
            self.assertEqual(len(env.step(0)), 5)

    def test_observation_layout_and_bounds(self):
        self.env.food = (19, 0)
        obs = self.env._observation()
        self.assertEqual(obs.shape, (10,))
        self.assertEqual(obs.dtype, np.float32)
        np.testing.assert_array_equal(obs[:7], [0, 0, 0, 0, 1, 0, 0])
        np.testing.assert_allclose(obs[7:9], [10 / 19, -10 / 19])
        self.assertEqual(obs[9], 0)
        self.assertTrue(self.env.observation_space.contains(obs))

    def test_danger_matches_actual_transitions(self):
        self.env.snake = [(19, 0), (18, 0), (18, 1), (19, 1), (19, 2)]
        obs = self.env._observation()
        np.testing.assert_array_equal(obs[:3], [1, 1, 1])
        for action in range(3):
            with self.subTest(action=action):
                env = SnakeEnv()
                env.reset(seed=42)
                env.snake = list(self.env.snake)
                env.food = (0, 0)
                _, reward, terminated, truncated, info = env.step(action)
                self.assertTrue(terminated)
                self.assertFalse(truncated)
                self.assertEqual(reward, -10.0)
                self.assertEqual(info["cause_of_death"], "self" if action == 2 else "wall")

    def test_wall_collision(self):
        self.env.snake = [(19, 10), (18, 10), (17, 10)]
        before = list(self.env.snake)
        obs, reward, terminated, truncated, info = self.env.step(0)
        self.assertEqual(self.env.snake, before)
        self.assertEqual((reward, terminated, truncated), (-10.0, True, False))
        self.assertEqual(info["cause_of_death"], "wall")
        self.assertEqual(info["steps"], 1)
        self.assertEqual(info["steps_survived"], 0)
        self.assertTrue(self.env.observation_space.contains(obs))

    def test_self_collision(self):
        self.env.snake = [(9, 10), (9, 11), (10, 11), (10, 10), (11, 10)]
        _, reward, terminated, truncated, info = self.env.step(0)
        self.assertEqual((reward, terminated, truncated), (-10.0, True, False))
        self.assertEqual(info["cause_of_death"], "self")

    def test_departing_tail_is_safe(self):
        self.env.snake = [(9, 10), (9, 11), (10, 11), (10, 10)]
        self.assertEqual(self.env._observation()[0], 0)
        _, reward, terminated, truncated, _ = self.env.step(0)
        self.assertEqual((reward, terminated, truncated), (-0.01, False, False))
        self.assertEqual(len(self.env.snake), 4)
        self.assertEqual(self.env.snake[0], (10, 10))

    def test_eating_food(self):
        self.env.food = (10, 10)
        _, reward, terminated, truncated, info = self.env.step(0)
        self.assertEqual((reward, terminated, truncated), (10.0, False, False))
        self.assertEqual(info["score"], 10)
        self.assertEqual(info["food_collected"], 1)
        self.assertEqual(info["steps_survived"], 1)
        self.assertEqual(info["steps_since_food"], 0)
        self.assertNotIn(self.env.food, self.env.snake)

    def test_growth_retains_tail_only_when_eating(self):
        original_tail = self.env.snake[-1]
        self.env.food = (10, 10)
        self.env.step(0)
        self.assertEqual(len(self.env.snake), 4)
        self.assertEqual(self.env.snake[-1], original_tail)
        self.env.food = (0, 0)
        self.env.step(0)
        self.assertEqual(len(self.env.snake), 4)
        self.assertNotIn(original_tail, self.env.snake)

    def test_relative_actions_cannot_reverse(self):
        for direction in range(4):
            for action in range(3):
                with self.subTest(direction=direction, action=action):
                    self.env.reset(seed=42)
                    self.env.food = (0, 0)
                    self.env.direction = direction
                    dx, dy = self.env.DIRECTIONS[direction]
                    self.env.snake = [(9 - dx * i, 10 - dy * i) for i in range(3)]
                    self.env.step(action)
                    expected = (direction + (0, -1, 1)[action]) % 4
                    self.assertEqual(self.env.direction, expected)
                    self.assertNotEqual(self.env.direction, (direction + 2) % 4)

    def test_invalid_actions_do_not_change_state(self):
        before = self.env.get_state()
        for action in [-1, 3, 99, True, np.bool_(False), 1.0, "LEFT", None, [0]]:
            with self.subTest(action=action):
                with self.assertRaises(ValueError):
                    self.env.step(action)
                self.assertEqual(self.env.get_state(), before)
        self.env.step(np.int64(0))
        self.assertEqual(self.env.steps, 1)

    def test_reset_clears_all_episode_state(self):
        self.env.food = (10, 10)
        self.env.step(0)
        for _ in range(10):
            if not self.env._terminated:
                self.env.step(0)
        obs, info = self.env.reset(seed=42, options={})
        self.assertEqual(self.env.snake, [(9, 10), (8, 10), (7, 10)])
        self.assertEqual(self.env.direction, 1)
        for key in ["score", "steps", "steps_survived", "food_collected", "steps_since_food"]:
            self.assertEqual(info[key], 0)
        self.assertIsNone(info["cause_of_death"])
        self.assertIsNone(info["end_reason"])
        self.assertFalse(info["won"])
        self.assertTrue(self.env.get_state()["alive"])
        self.assertFalse(self.env.get_state()["truncated"])
        self.assertTrue(self.env.observation_space.contains(obs))

    def test_observation_info_and_state_are_detached(self):
        obs, info = self.env.reset(seed=42)
        before = self.env.get_state()
        obs[:] = -99
        info["score"] = 999
        snapshot = self.env.get_state()
        snapshot["snake"][0]["x"] = -100
        snapshot["direction"]["x"] = 100
        snapshot["food"]["x"] = 100
        self.assertEqual(self.env.get_state(), before)

    def test_no_food_cutoff_is_truncation(self):
        env = SnakeEnv(max_steps_without_food=4)
        env.reset(seed=1)
        env.food = (0, 0)
        for index in range(4):
            # A four-turn square returns to the same state without eating.
            obs, reward, terminated, truncated, info = env.step(2)
            self.assertFalse(terminated)
            self.assertEqual(truncated, index == 3)
        self.assertEqual(reward, -0.01)
        self.assertEqual(info["end_reason"], "no_food_limit")
        self.assertIsNone(info["cause_of_death"])
        self.assertEqual(info["steps_survived"], 4)
        self.assertEqual(obs[-1], 1.0)
        with self.assertRaises(ResetNeeded):
            env.step(0)
        env.reset()
        self.assertEqual(env.steps_since_food, 0)
        self.assertFalse(env.step(0)[3])

    def test_eating_resets_no_food_budget_at_boundary(self):
        env = SnakeEnv(max_steps_without_food=2)
        env.reset(seed=1)
        env.food = (11, 10)
        self.assertFalse(env.step(0)[3])
        obs, reward, terminated, truncated, info = env.step(0)
        self.assertEqual((reward, terminated, truncated), (10.0, False, False))
        self.assertEqual(info["steps_since_food"], 0)
        self.assertEqual(obs[-1], 0.0)

    def test_collision_takes_precedence_over_timeout(self):
        env = SnakeEnv(max_steps_without_food=1)
        env.reset(seed=1)
        env.snake = [(19, 10), (18, 10), (17, 10)]
        _, reward, terminated, truncated, info = env.step(0)
        self.assertEqual((reward, terminated, truncated), (-10.0, True, False))
        self.assertEqual(info["end_reason"], "wall")

    def test_full_board_win(self):
        env = SnakeEnv(board_size=6, max_steps_without_food=1)
        env.reset(seed=1)
        # A contiguous route from the head through all cells except final food.
        env.snake = [(4, 5)] + [(x, 5) for x in range(3, -1, -1)]
        for y in range(4, -1, -1):
            env.snake.extend((x, y) for x in (range(6) if y % 2 == 0 else range(5, -1, -1)))
        env.food = (5, 5)
        env.food_collected = len(env.snake) - 3
        env.score = env.food_collected * 10
        obs, reward, terminated, truncated, info = env.step(0)
        self.assertEqual((reward, terminated, truncated), (10.0, True, False))
        self.assertEqual(len(env.snake), 36)
        self.assertIsNone(env.food)
        self.assertTrue(info["won"])
        self.assertEqual(info["end_reason"], "board_full")
        self.assertEqual(info["score"], 330)
        self.assertIsNone(info["cause_of_death"])
        np.testing.assert_array_equal(obs[7:9], [0, 0])

    def test_step_requires_reset_before_and_after_terminal(self):
        env = SnakeEnv()
        with self.assertRaises(ResetNeeded):
            env.step(0)
        env.reset(seed=42)
        for _ in range(11):
            env.step(0)
        with self.assertRaises(ResetNeeded):
            env.step(0)

    def test_reproducible_seed_and_multiple_food_spawns(self):
        first, second = SnakeEnv(), SnakeEnv()
        first.reset(seed=19)
        second.reset(seed=19)
        cycle = [(0, 0)]
        for y in range(20):
            cycle.extend((x, y) for x in (range(1, 20) if y % 2 == 0 else range(19, 0, -1)))
        cycle.extend((0, y) for y in range(19, 0, -1))
        positions = {cell: index for index, cell in enumerate(cycle)}
        for _ in range(3000):
            head = first.snake[0]
            target = cycle[(positions[head] + 1) % len(cycle)]
            vector = (target[0] - head[0], target[1] - head[1])
            direction = first.DIRECTIONS.index(vector)
            rotation = (direction - first.direction) % 4
            action = {0: 0, 3: 1, 1: 2}[rotation]
            a, b = first.step(action), second.step(action)
            np.testing.assert_array_equal(a[0], b[0])
            self.assertEqual(a[1:], b[1:])
            self.assertEqual(first.get_state(), second.get_state())
            self.assertFalse(a[2] or a[3])
        self.assertGreaterEqual(first.food_collected, 10)
        first.reset(seed=19)
        second.reset(seed=19)
        self.assertEqual(first.get_state(), second.get_state())

    def test_reset_none_continues_random_stream(self):
        a, b = SnakeEnv(), SnakeEnv()
        a.reset(seed=42)
        b.reset(seed=42)
        rng = a.np_random
        foods = set()
        for _ in range(10):
            a.reset()
            b.reset()
            self.assertIs(a.np_random, rng)
            self.assertEqual(a.food, b.food)
            foods.add(a.food)
        self.assertGreater(len(foods), 1)

    def test_render_and_close(self):
        self.assertIsNone(self.env.render())
        env = SnakeEnv(render_mode="ansi")
        with self.assertRaises(ResetNeeded):
            env.render()
        env.reset(seed=42)
        before = env.get_state()
        text = env.render()
        self.assertIsInstance(text, str)
        self.assertIn("Score: 0", text)
        self.assertEqual(text.count("H"), 1)
        self.assertEqual(text.count("*"), 1)
        self.assertEqual(env.get_state(), before)
        env.close()
        env.close()

    def test_configuration_validation(self):
        for value in [0, 5, 6.5, True]:
            with self.assertRaises(ValueError):
                SnakeEnv(board_size=value)
        for value in [0, -1, 1.5, True]:
            with self.assertRaises(ValueError):
                SnakeEnv(max_steps_without_food=value)
        with self.assertRaises(ValueError):
            SnakeEnv(render_mode="unsupported")
        with self.assertRaises(ValueError):
            self.env.reset(options={"unknown": True})

    def test_random_agent_100_episodes(self):
        report = evaluate(episodes=100, seed=42)
        self.assertEqual(report, evaluate(episodes=100, seed=42))
        self.assertEqual(len(report["records"]), 100)
        self.assertEqual(report["terminated_episodes"] + report["truncated_episodes"], 100)
        self.assertGreater(report["mean_survival_length"], 0)
        self.assertGreaterEqual(report["mean_score"], 0)
        self.assertGreaterEqual(report["median_score"], 0)

    @unittest.skipUnless(shutil.which("node"), "Optional JS parity check needs Node.js")
    def test_javascript_transition_parity(self):
        # Compare real engines from matching fixtures; only their RNGs differ.
        cases = [
            ([(9, 10), (8, 10), (7, 10)], (0, 0), action) for action in range(3)
        ] + [
            ([(9, 10), (8, 10), (7, 10)], (10, 10), 0),
            ([(19, 10), (18, 10), (17, 10)], (0, 0), 0),
            ([(9, 10), (9, 11), (10, 11), (10, 10)], (0, 0), 0),
            ([(9, 10), (9, 11), (10, 11), (10, 10), (11, 10)], (0, 0), 0),
        ]
        fixtures, expected = [], []
        for snake, food, action in cases:
            self.env.reset(seed=42)
            self.env.snake, self.env.food = snake.copy(), food
            fixtures.append({"state": self.env.get_state(), "action": ["RIGHT", "UP", "DOWN"][action]})
            self.env.step(action)
            result = self.env.get_state()
            result.pop("food")  # Different random generators intentionally.
            result.pop("truncated")  # Python-only no-food cutoff.
            expected.append(result)
        script = r"""
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('js/game.js','utf8').replace('    getState() {',
  '    setFixture(state) { this.#state = state; }\n    getState() {');
const context = {}; vm.runInNewContext(source, context);
const cases = JSON.parse(fs.readFileSync(0,'utf8'));
const results = cases.map(item => {
  const game = new context.SnakeEngine.SnakeGame({seed:42});
  delete item.state.truncated; game.setFixture(item.state);
  const result = game.step(item.action); delete result.food; return result;
});
process.stdout.write(JSON.stringify(results));
"""
        process = subprocess.run([shutil.which("node"), "-e", script], input=json.dumps(fixtures),
                                 text=True, capture_output=True, check=True,
                                 cwd=Path(__file__).resolve().parents[1], timeout=15)
        self.assertEqual(json.loads(process.stdout), expected)


if __name__ == "__main__":
    unittest.main()
