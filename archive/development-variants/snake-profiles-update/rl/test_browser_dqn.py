"""Cross-language inference contract, checked against the real PyTorch network."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
import torch

from rl.dqn.agent import DQNAgent, DQNConfig
from rl.snake_env import SnakeEnv
from rl.web_server import LocalApp, observation_from_snapshot

ROOT = Path(__file__).resolve().parents[1]


class BrowserDQNTests(unittest.TestCase):
    def test_variant_exports_only_supported_inference_rule(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'models').mkdir()
            agent = DQNAgent(DQNConfig(hidden_size=8))
            agent.save(root / 'models/variant.pt', {'episode':2300, 'inference_rules':{
                'dense_board_sweep_above_half':True, 'unknown_private_field':'not exported'}})
            exported = LocalApp(root).browser_model({'model':'variant.pt'})
            self.assertEqual(exported['inference_rules'], {'dense_board_sweep_above_half':True})

    def test_javascript_observations_q_values_and_actions_match_pytorch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'models').mkdir()
            agent = DQNAgent(DQNConfig(seed=71, hidden_size=128))
            agent.save(root / 'models/model.pt', {'episode':0})
            exported = LocalApp(root).browser_model({'model':'model.pt'})
            self.assertEqual(set(exported), {'format','board_size','max_steps_without_food','layers'})
            env = SnakeEnv()
            rng = np.random.default_rng(31)
            snapshots, observations = [], []
            obs, _ = env.reset(seed=19)
            for _ in range(1000):
                snapshot = env.get_state()
                snapshot['stepsSinceFood'] = env.steps_since_food
                snapshots.append(snapshot)
                observations.append(obs.copy())
                safe = np.flatnonzero(obs[:3] == 0)
                action = int(rng.choice(safe)) if len(safe) else 0
                obs, _, terminated, truncated, _ = env.step(action)
                if terminated or truncated:
                    obs, _ = env.reset()
            script = """
const fs=require('node:fs'), {DenseQNetwork,observation}=require('./js/dqn-agent.js');
const data=JSON.parse(fs.readFileSync(0,'utf8')), network=new DenseQNetwork(data.model);
const result=data.states.map(s=>{const obs=observation(s,s.stepsSinceFood); const q=Array.from(network.forward(obs));return {obs:Array.from(obs),q,action:q.indexOf(Math.max(...q))};});
process.stdout.write(JSON.stringify(result));
"""
            result = subprocess.run(['node','-e',script],cwd=ROOT,input=json.dumps({'model':exported,'states':snapshots}),
                                    text=True,capture_output=True,check=True)
            rows = json.loads(result.stdout)
            np.testing.assert_array_equal([row['obs'] for row in rows], np.array(observations))
            with torch.no_grad():
                q = agent.online(torch.tensor(np.array(observations))).numpy()
            np.testing.assert_allclose([row['q'] for row in rows], q, rtol=1e-5, atol=1e-6)
            np.testing.assert_array_equal([row['action'] for row in rows],q.argmax(axis=1))

    def test_export_rejects_wrong_board_and_does_not_expose_training_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'models').mkdir()
            agent=DQNAgent(DQNConfig(hidden_size=8))
            path=root/'models/model.pt'
            agent.save(path,{'env_config':{'board_size':10}},include_training_state=True)
            app=LocalApp(root)
            with self.assertRaises(ValueError): app.browser_model({'model':'model.pt'})
            with self.assertRaises(ValueError): app.browser_model({'model':'../outside.pt'})
            agent.save(path,{'env_config':{'board_size':20}},include_training_state=True)
            exported=app.browser_model({'model':'model.pt'})
            self.assertNotIn('training_state',exported)
            self.assertNotIn('optimizer',exported)


if __name__ == '__main__':
    unittest.main()
