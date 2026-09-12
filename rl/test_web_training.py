"""Local web contracts and exact episode-boundary resume regression tests."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

import numpy as np
import torch

from rl.web_server import LocalApp, Handler, model_path, observation_from_snapshot
from rl.snake_env import SnakeEnv
from rl.dqn.agent import DQNAgent, DQNConfig
from rl.dqn.train_session import train_session


class WebTrainingTests(unittest.TestCase):
    def config(self):
        return DQNConfig(hidden_size=16, batch_size=4, replay_capacity=80, learning_starts=4,
                         train_every=1, target_update_every=5, seed=13)

    def test_resumed_training_matches_uninterrupted_training(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            full=train_session(4,root/'full',root/'full_models',config=self.config(),seed=13)
            first=train_session(2,root/'first',root/'models',config=self.config(),seed=13)
            source=root/'models'/first['saved_model']
            resumed=train_session(2,root/'resume',root/'models',checkpoint=source)
            self.assertEqual(resumed['episode'],4)
            self.assertEqual(resumed['saved_model'],'4_model.pt')
            self.assertTrue(resumed['exact_resume'])
            a,_=DQNAgent.load(root/'full_models'/full['saved_model'])
            b,_=DQNAgent.load(root/'models'/resumed['saved_model'])
            for name,value in a.online.state_dict().items():
                torch.testing.assert_close(value,b.online.state_dict()[name],rtol=0,atol=0)
            self.assertEqual(a.environment_steps,b.environment_steps)
            self.assertEqual(a.rng.getstate(),b.rng.getstate())
            sample_a,sample_b=a.replay.sample(4),b.replay.sample(4)
            for key in sample_a:np.testing.assert_array_equal(sample_a[key],sample_b[key])
            self.assertEqual(len(a.replay),len(b.replay))

    def test_checkpoint_replay_and_rng_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            a=DQNAgent(self.config());env=SnakeEnv();obs,_=env.reset(seed=4)
            for _ in range(100):
                action=a.choose_action(obs);next_obs,reward,t,tr,_=env.step(action)
                a.observe(obs,action,reward,next_obs,t,tr);obs=next_obs
                if t or tr:obs,_=env.reset()
            path=Path(temp)/'100_model.pt';a.save(path,{'episode':100},include_training_state=True)
            b,meta=DQNAgent.load(path)
            self.assertEqual(meta['episode'],100)
            self.assertEqual(a.epsilon,b.epsilon)
            sample_a,sample_b=a.replay.sample(8),b.replay.sample(8)
            for key in sample_a:np.testing.assert_array_equal(sample_a[key],sample_b[key])
            self.assertEqual([a.choose_action(obs) for _ in range(20)],[b.choose_action(obs) for _ in range(20)])
            self.assertAlmostEqual(a.train_batch(),b.train_batch(),places=7)

    def test_legacy_resume_and_duplicate_names_preserve_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);models=root/'models';models.mkdir()
            legacy=models/'best_model.pt';DQNAgent(self.config()).save(legacy,{'episode':20,'training_seed':13})
            first=train_session(1,root/'a',models,legacy)
            original=(models/'21_model.pt').read_bytes()
            second=train_session(1,root/'b',models,legacy)
            self.assertFalse(first['exact_resume']);self.assertEqual(second['saved_model'],'b/21_model.pt')
            self.assertEqual((models/'21_model.pt').read_bytes(),original)
            self.assertEqual(json.loads((root/'b/status.json').read_text())['episode'],21)

    def test_stop_before_first_episode_and_bad_parameters(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);job=root/'job';job.mkdir();(job/'stop').touch()
            status=train_session(3,job,root/'models',config=self.config())
            self.assertEqual(status['state'],'stopped');self.assertEqual(status['episode'],0)
            self.assertIsNone(status['saved_model'])
            with self.assertRaises(ValueError):train_session(0,job,root/'models')

    def test_snapshot_observations_match_environment(self):
        env=SnakeEnv();obs,_=env.reset(seed=42)
        state=env.get_state();state['stepsSinceFood']=env.steps_since_food
        actual,heading=observation_from_snapshot(state)
        np.testing.assert_array_equal(actual,obs);self.assertEqual(heading,1)
        for action in [0,1,0,2,0]:
            obs,_,t,tr,_=env.step(action)
            if t or tr:break
            state=env.get_state();state['stepsSinceFood']=env.steps_since_food
            actual,_=observation_from_snapshot(state);np.testing.assert_array_equal(actual,obs)
        with self.assertRaises(ValueError):observation_from_snapshot({'size':20,'snake':[]})
        state['snake'][1]=state['snake'][0].copy()
        with self.assertRaises(ValueError):observation_from_snapshot(state)

    def test_http_blocks_remote_origins_private_files_and_path_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'models').mkdir();(root/'index.html').write_text('snake')
            DQNAgent(self.config()).save(root/'models/model.pt',{'episode':0})
            with self.assertRaises(ValueError):model_path(root/'models','../index.html')
            app=LocalApp(root)
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.app=app
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_address[1]}'
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                self.assertEqual(json.load(opener.open(base+'/api/models'))['models'][0]['name'],'model.pt')
                for path,headers,code in [('/models/model.pt',{},404),('/',{'Host':'evil.test'},403),
                                           ('/api/health',{'Origin':'http://evil.test'},403)]:
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(urllib.request.Request(base+path,headers=headers))
                    self.assertEqual(error.exception.code,code)
                env=SnakeEnv();env.reset(seed=42)
                payload=json.dumps({'agent':'dqn','model':'model.pt','state':env.get_state()}).encode()
                req=urllib.request.Request(base+'/api/action',data=payload,
                    headers={'Content-Type':'application/json','X-Snake-Client':'1'})
                response=json.load(opener.open(req))
                self.assertIn(response['action'],('UP','RIGHT','DOWN'))
                self.assertFalse(response['fallback'])
                export_body=json.dumps({'model':'model.pt'}).encode()
                export_req=urllib.request.Request(base+'/api/dqn/model',data=export_body,
                    headers={'Content-Type':'application/json','X-Snake-Client':'1'})
                exported=json.load(opener.open(export_req))
                self.assertEqual(exported['format'],'snake-dqn-dense-v1')
                self.assertNotIn('training_state',exported)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    opener.open(urllib.request.Request(base+'/api/dqn/model',data=export_body,
                        headers={'Content-Type':'application/json','X-Snake-Client':'1','Origin':'http://evil.test'}))
                self.assertEqual(error.exception.code,403)
            finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
