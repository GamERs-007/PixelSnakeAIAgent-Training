"""Matched reward ablation, keeping raw DQN evaluation separate from browser assistance."""
import hashlib
import json
from pathlib import Path
from statistics import mean,median
import time

from rl.snake_env import SnakeEnv
from rl.dqn.agent import DQNAgent
from rl.dqn.train_session import train_session

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'results/strategy_v1_experiment'


def evaluate(path,episodes=100,seed=400000):
    agent,meta=DQNAgent.load(path)
    # Use the same classic evaluation task for all models; compare score, not different rewards.
    env=SnakeEnv();rows=[]
    for episode in range(episodes):
        obs,_=env.reset(seed=seed+episode);turns=0
        for tick in range(10000):
            action=agent.choose_action(obs,explore=False);turns+=action!=0
            obs,reward,t,tr,info=env.step(action)
            if t or tr:break
        rows.append({'episode':episode+1,'seed':seed+episode,**info,'turn_rate':turns/info['steps'],
                     'truncated':tr or tick==9999})
    env.close()
    return {'checkpoint':str(path),'episodes':episodes,'mean_score':mean(r['score'] for r in rows),
            'median_score':median(r['score'] for r in rows),'mean_steps':mean(r['steps'] for r in rows),
            'mean_turn_rate':mean(r['turn_rate'] for r in rows),
            'no_food_limits':sum(r['end_reason']=='no_food_limit' for r in rows),'rows':rows}


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/'comparison.json').exists():raise FileExistsError('Experiment already exists')
    source=ROOT/'models/best_model.pt';report={'source':str(source),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'additional_training_episodes':300,
                                           'evaluation_seed':400000,'policies':{}}
    report['policies']['original']=evaluate(source)
    print('original', {k:v for k,v in report['policies']['original'].items() if k!='rows'},flush=True)
    for profile in ['classic','strategy_v1']:
        job=OUT/profile
        started=time.perf_counter()
        result=train_session(300,job,ROOT/'models',checkpoint=source,save_every=300,reward_profile=profile)
        model=ROOT/'models'/result['saved_model']
        report['policies'][profile]=evaluate(model)
        report['policies'][profile]['train_and_evaluate_seconds']=time.perf_counter()-started
        (OUT/'comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(profile,{k:v for k,v in report['policies'][profile].items() if k!='rows'},flush=True)


if __name__=='__main__':main()
