import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np
from gymnasium.utils.env_checker import check_env

from rl.snake_env import SnakeEnv
from rl.strategy_reward import geometry,potential
from rl.dqn.agent import DQNAgent,DQNConfig
from rl.dqn.train_session import train_session


class StrategyTests(unittest.TestCase):
    def test_modern_env_checker_and_seed(self):
        env=SnakeEnv(reward_profile='strategy_v1')
        check_env(env,skip_render_check=True)
        traces=[]
        for _ in range(2):
            env.reset(seed=123);trace=[]
            for action in [0,1,0,2,0,2,2,2]:
                o,r,t,tr,info=env.step(action);trace.append((o.tolist(),r,info))
                if t or tr:break
            traces.append(trace)
        self.assertEqual(traces[0],traces[1])

    def test_bfs_distance_accounts_for_obstacles(self):
        # A wall between head and food forces a detour instead of Manhattan distance.
        snake=[(1,2),(2,2),(2,1),(2,0),(3,0)]
        result=geometry(snake,(3,2),6)
        self.assertGreater(result['food_distance'],2)
        self.assertTrue(result['tail_reachable'])

    def test_terminal_potential_zero_and_reward_decomposition(self):
        env=SnakeEnv(reward_profile='strategy_v1');env.reset(seed=1)
        env.snake=[(19,2),(18,2),(17,2)];env.direction=1;env.food=(0,0)
        before=potential(env.snake,env.food,20)
        _,reward,t,_,info=env.step(0)
        self.assertTrue(t)
        self.assertAlmostEqual(info['reward_components']['potential'],-before)
        self.assertEqual(info['reward_components']['base'],-10)
        self.assertAlmostEqual(reward,sum(info['reward_components'].values()))

    def test_turn_penalty_small_and_eating_reward_dominates(self):
        env=SnakeEnv(reward_profile='strategy_v1');env.reset(seed=1)
        env.food=(9,9)
        _,reward,t,tr,info=env.step(1)
        self.assertGreater(reward,8)
        self.assertEqual(info['reward_components']['turn'],-.005)
        self.assertEqual(info['reward_components']['base'],10)
        self.assertEqual(info['reward_components']['repeat'],0)
        self.assertEqual(len(env.snake),4)

    def test_repeated_loop_penalty_and_timeout(self):
        env=SnakeEnv(reward_profile='strategy_v1',max_steps_without_food=12)
        env.reset(seed=1);env.food=(0,0)
        penalties=[]
        for _ in range(12):
            _,r,t,tr,info=env.step(2);penalties.append(info['reward_components']['repeat'])
        self.assertTrue(tr);self.assertFalse(t)
        self.assertTrue(any(p<0 for p in penalties))
        self.assertEqual(info['reward_components']['timeout'],-2)
        env.reset(seed=1);env.food=(0,0)
        _,_,_,_,info=env.step(2)
        self.assertEqual(info['reward_components']['repeat'],0)

    def test_discounted_potential_sum_telescopes(self):
        env=SnakeEnv(reward_profile='strategy_v1');env.reset(seed=6);initial=potential(env.snake,env.food,20)
        shaping=0
        for t,action in enumerate([0,1,0,2,0,2]):
            _,_,term,tr,info=env.step(action)
            self.assertFalse(term or tr)
            shaping+=.99**t*info['reward_components']['potential']
        expected=-initial+.99**6*potential(env.snake,env.food,20)
        self.assertAlmostEqual(shaping,expected)

    def test_progress_write_retries_transient_windows_lock(self):
        from rl.dqn.train_session import write_json
        import json
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'status.json';write_json(path,{'episode':1})
            original=Path.replace;attempts=[]
            def intermittent(source,destination):
                attempts.append(1)
                if len(attempts)<3:raise PermissionError('simulated Windows reader lock')
                return original(source,destination)
            with patch.object(Path,'replace',intermittent):write_json(path,{'episode':2})
            self.assertEqual(len(attempts),3)
            self.assertEqual(json.loads(path.read_text()),{'episode':2})

    def test_reward_change_clears_replay_and_inherit_preserves_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);config=DQNConfig(hidden_size=16,batch_size=4,replay_capacity=100,learning_starts=4,train_every=1)
            train_session(2,root/'old',root/'models',config=config)
            changed=train_session(1,root/'changed',root/'models',root/'models/2_model.pt',reward_profile='strategy_v1')
            self.assertTrue(changed['replay_reset_for_reward_change'])
            self.assertFalse(changed['exact_resume'])
            agent,meta=DQNAgent.load(root/'models/3_model.pt')
            self.assertEqual(meta['env_config']['reward_profile'],'strategy_v1')
            self.assertLessEqual(len(agent.replay),changed['steps'])
            inherited=train_session(1,root/'inherited',root/'models',root/'models/3_model.pt')
            self.assertEqual(inherited['reward_profile'],'strategy_v1')
            self.assertTrue(inherited['exact_resume'])

if __name__=='__main__':unittest.main()
