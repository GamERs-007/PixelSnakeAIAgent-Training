"""Unit and integration checks for the explicit DQN implementation."""
import csv
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from rl.dqn.agent import DQNAgent, DQNConfig, bellman_targets
from rl.dqn.replay_buffer import ReplayBuffer
from rl.dqn.evaluate import HeuristicAgent, RandomAgent, rollout, summarize
from rl.dqn.train import train


class DQNTests(unittest.TestCase):
    def test_bellman_targets_and_terminal_mask(self):
        actual = bellman_targets(torch.tensor([10., -10., -.01]),
                                 torch.tensor([False, True, False]),
                                 torch.tensor([[1., 2., 3.], [90., 100., 80.], [2., 4., 3.]]), .9)
        torch.testing.assert_close(actual, torch.tensor([12.7, -10., 3.59]))

    def test_replay_capacity_copies_and_seed(self):
        buffers = [ReplayBuffer(3, 2, 1), ReplayBuffer(3, 2, 1)]
        for buffer in buffers:
            for index in range(5):
                state = np.array([index, index], dtype=np.float32)
                buffer.add(state, 0, index, state + 1, False, index == 4)
                state[:] = -999
        for a, b in zip(buffers[0].sample(3).values(), buffers[1].sample(3).values()):
            np.testing.assert_array_equal(a, b)
        self.assertEqual(set(buffers[0].sample(3)['rewards']), {2, 3, 4})
        self.assertTrue(buffers[0].sample(3)['truncated'].any())
        with self.assertRaises(ValueError):
            buffers[0].sample(4)

    def test_greedy_evaluation_never_consumes_exploration_rng(self):
        agent = DQNAgent()
        state = np.zeros(10, dtype=np.float32)
        for parameter in agent.online.parameters():
            torch.nn.init.zeros_(parameter)
        with torch.no_grad():
            agent.online.layers[-1].bias[2] = 10
        before = agent.rng.getstate()
        self.assertTrue(all(agent.choose_action(state, explore=False) == 2 for _ in range(20)))
        self.assertEqual(before, agent.rng.getstate())
        actions = {agent.choose_action(state) for _ in range(100)}
        self.assertEqual(actions, {0, 1, 2})
        agent.environment_steps = 100000
        self.assertAlmostEqual(agent.epsilon, .05)

    def test_training_updates_online_then_target(self):
        agent = DQNAgent(DQNConfig(batch_size=4, learning_starts=4, train_every=1, target_update_every=2))
        original = {key: value.clone() for key, value in agent.target.state_dict().items()}
        for i in range(4):
            loss = agent.observe(np.ones(10), i % 3, 10., np.zeros(10), False, False)
        self.assertIsNotNone(loss)
        self.assertTrue(np.isfinite(loss))
        self.assertTrue(any(not torch.equal(original[k], v) for k, v in agent.online.state_dict().items()))
        for key, value in agent.target.state_dict().items():
            torch.testing.assert_close(value, original[key])
        self.assertTrue(all(p.grad is None for p in agent.target.parameters()))
        agent.train_batch()
        for key, value in agent.target.state_dict().items():
            torch.testing.assert_close(value, agent.online.state_dict()[key])

    def test_checkpoint_roundtrip_and_seeded_updates(self):
        c = DQNConfig(batch_size=4, learning_starts=4, train_every=1)
        a, b = DQNAgent(c), DQNAgent(c)
        for i in range(8):
            state = np.full(10, i / 10, dtype=np.float32)
            self.assertEqual(a.choose_action(state), b.choose_action(state))
            self.assertEqual(a.observe(state, i % 3, 1., state, i == 7, False),
                             b.observe(state, i % 3, 1., state, i == 7, False))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'model.pt'
            a.save(path, {'episode': 3})
            restored, metadata = DQNAgent.load(path)
            self.assertEqual(metadata['episode'], 3)
            self.assertEqual(restored.updates, a.updates)
            for key, value in a.online.state_dict().items():
                torch.testing.assert_close(value, restored.online.state_dict()[key])
            self.assertEqual(len(restored.replay), 0)

    def test_baselines_and_rollout_bounds(self):
        heuristic = HeuristicAgent()
        # Facing right, food above: choose relative left.
        obs = np.array([0, 0, 0, 0, 1, 0, 0, 0, -1, 0], dtype=np.float32)
        self.assertEqual(heuristic.choose_action(obs), 1)
        obs[1] = 1
        self.assertEqual(heuristic.choose_action(obs), 0)
        obs[:3] = 1
        self.assertEqual(heuristic.choose_action(obs), 0)
        a, b = RandomAgent(42), RandomAgent(42)
        self.assertEqual([a.choose_action(obs) for _ in range(100)], [b.choose_action(obs) for _ in range(100)])
        rows = rollout(lambda obs: 0, 3, 42, max_episode_steps=1)
        self.assertTrue(all(row['truncated'] for row in rows))
        self.assertEqual(summarize(rows)['mean_survival_steps'], 1)

    def test_training_artifacts_and_overwrite_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            train(episodes=2, output_root=directory, validation_every=1, validation_episodes=1)
            root = Path(directory)
            for name in ['models/best_model.pt', 'models/latest_model.pt', 'results/training.csv',
                         'results/training_reward.png', 'results/training_score.png',
                         'results/moving_average_score.png', 'results/validation.json']:
                self.assertTrue((root / name).is_file(), name)
            with (root / 'results/training.csv').open() as handle:
                self.assertEqual(len(list(csv.DictReader(handle))), 2)
            with self.assertRaises(FileExistsError):
                train(episodes=2, output_root=directory)


if __name__ == '__main__':
    unittest.main()
