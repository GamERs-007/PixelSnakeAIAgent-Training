"""Training saves by public scheme, retaining ultimate rules on resume."""
from datetime import datetime
from pathlib import Path
import tempfile
import unittest

from rl.dqn.agent import DQNAgent, DQNConfig
from rl.dqn.train_session import train_session
from rl.model_profiles import model_profile, normalize_profile
from rl.web_server import LocalApp


class ModelProfileTests(unittest.TestCase):
    def test_web_worker_uses_selected_folder_and_keeps_ultimate_rule(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);app=LocalApp(root)
            try:
                app.start_training({'episodes':1,'save_every':1,'seed':23,'reward_profile':'ultimate'})
                self.assertEqual(app.process.wait(timeout=30),0)
                status=app.training_status()
                self.assertEqual(status['state'],'completed')
                self.assertTrue(status['saved_model'].startswith('ultimate/'))
                self.assertEqual(status['training_seed'],23)
                exported=app.browser_model({'model':status['saved_model']})
                self.assertTrue(exported['inference_rules']['dense_board_sweep_above_half'])
            finally:
                if app.process and app.process.poll() is None:
                    app.stop_training();app.process.wait(timeout=30)

    def test_three_profiles_train_save_export_and_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            config=DQNConfig(hidden_size=8, batch_size=4, replay_capacity=50,
                             learning_starts=4, train_every=1, seed=17)
            for profile in ('classic','strategy','ultimate'):
                run=train_session(1,root/profile,root/'models',config=config,seed=17,reward_profile=profile)
                name=run['saved_model']
                self.assertTrue(name.startswith(profile+'/'))
                self.assertRegex(name,r'/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{6}_ep1\.pt$')
                _,meta=DQNAgent.load(root/'models'/name)
                self.assertEqual(meta['model_profile'],profile)
                self.assertIsNotNone(datetime.fromisoformat(meta['saved_at']).tzinfo)
                exported=LocalApp(root).browser_model({'model':name})
                self.assertEqual(bool(exported.get('inference_rules')),profile=='ultimate')
                resumed=train_session(1,root/(profile+'-resume'),root/'models',checkpoint=root/'models'/name,seed=999)
                self.assertEqual(resumed['reward_profile'],profile)
                self.assertEqual(resumed['training_seed'],17)
                self.assertTrue(resumed['saved_model'].startswith(profile+'/'))
                self.assertTrue(resumed['exact_resume'])
            self.assertEqual({m['reward_profile'] for m in LocalApp(root).list_models()}, {'classic','strategy','ultimate'})

    def test_switching_ultimate_off_removes_rule_without_discarding_compatible_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);models=root/'models'
            config=DQNConfig(hidden_size=8,replay_capacity=50,batch_size=4)
            first=train_session(1,root/'first',models,config=config,reward_profile='ultimate')
            second=train_session(1,root/'second',models,checkpoint=models/first['saved_model'],reward_profile='strategy')
            self.assertFalse(second['replay_reset_for_reward_change'])
            self.assertTrue(second['exact_resume'])
            self.assertNotIn('inference_rules',LocalApp(root).browser_model({'model':second['saved_model']}))
            third=train_session(1,root/'third',models,checkpoint=models/second['saved_model'],reward_profile='classic')
            self.assertTrue(third['replay_reset_for_reward_change'])
            self.assertTrue(third['saved_model'].startswith('classic/'))

    def test_legacy_categories_and_validation(self):
        self.assertEqual(normalize_profile('strategy_v1'),'strategy')
        self.assertEqual(model_profile({'env_config':{'reward_profile':'strategy_v1'}}),'strategy')
        self.assertEqual(model_profile({'inference_rules':{'dense_board_sweep_above_half':True}}),'ultimate')
        self.assertEqual(model_profile({},'ultimate/old.pt'),'ultimate')
        with self.assertRaises(ValueError):normalize_profile('../escape')


if __name__=='__main__':unittest.main()
