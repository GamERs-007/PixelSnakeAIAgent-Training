"""Frozen PyTorch evaluation and trained-checkpoint JS parity; never retrains."""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from rl.dqn.agent import DQNAgent
from rl.dqn.evaluate import RandomAgent, HeuristicAgent
from rl.snake_env import SnakeEnv


def parity(out, models):
    env, rng = SnakeEnv(), np.random.default_rng(31)
    obs, _ = env.reset(seed=19)
    snapshots, observations = [], []
    for _ in range(1000):
        snapshots.append({**env.get_state(), 'stepsSinceFood':env.steps_since_food})
        observations.append(obs.copy())
        safe = np.flatnonzero(obs[:3] == 0)
        obs, _, done, trunc, _ = env.step(int(rng.choice(safe)) if len(safe) else 0)
        if done or trunc: obs, _ = env.reset()
    script = """
const fs=require('node:fs'),{DenseQNetwork,observation}=require('./js/dqn-agent.js');
const d=JSON.parse(fs.readFileSync(0,'utf8')),n=new DenseQNetwork(d.model);
console.log(JSON.stringify(d.states.map(s=>{const o=observation(s,s.stepsSinceFood),q=Array.from(n.forward(o));return {o:Array.from(o),q,a:q.indexOf(Math.max(...q))};})));
"""
    results = {}
    for name, agent in models.items():
        payload=json.loads((out/f'{name.lower()}_weights.json').read_text())
        result=subprocess.run(['node','-e',script],cwd=ROOT,input=json.dumps({'model':payload,'states':snapshots}),text=True,capture_output=True,check=True)
        rows=json.loads(result.stdout)
        with torch.no_grad(): q=agent.online(torch.tensor(np.array(observations))).numpy()
        jq=np.array([r['q'] for r in rows])
        np.testing.assert_array_equal([r['o'] for r in rows],observations)
        np.testing.assert_allclose(jq,q,rtol=1e-5,atol=1e-5)
        np.testing.assert_array_equal([r['a'] for r in rows],q.argmax(axis=1))
        results[name]={'states':1000,'identical_observations':True,'identical_greedy_actions':True,'max_absolute_q_error':float(abs(jq-q).max()),'rtol':1e-5,'atol':1e-5}
    (out/'trained_parity.json').write_text(json.dumps(results,indent=2)+'\n')
    print('Trained parity:',results,flush=True)


def main():
    out=Path(sys.argv[1] if len(sys.argv)>1 else ROOT/'results/full_recheck_2026_09_15').resolve()
    destination=out/'raw_episodes.csv'
    if destination.exists(): raise FileExistsError(destination)
    protocol=json.loads((out/'protocol.json').read_text())['raw']
    metadata=json.loads((out/'metadata.json').read_text())
    models={}
    for name, item in metadata['models'].items():
        assert hashlib.sha256((ROOT/item['file']).read_bytes()).hexdigest()==item['sha256']
        models[name.capitalize()]=DQNAgent.load(ROOT/item['file'])[0]
        models[name.capitalize()].online.eval()
    parity(out,models)
    all_rows=[]
    timings=[]
    for block in protocol['blocks']:
        for name in protocol['policies']:
            started=time.perf_counter()
            # One reproducible action stream per seed block, matching original evaluator.
            baseline=RandomAgent(block+1000000) if name=='Random' else HeuristicAgent()
            policy=baseline.choose_action if name in ('Random','Heuristic') else lambda o:models[name].choose_action(o,explore=False)
            env=SnakeEnv(board_size=20,max_steps_without_food=400,reward_profile='classic')
            for episode in range(protocol['episodes_per_policy_per_block']):
                obs,_=env.reset(seed=block+episode)
                reward_sum=0.0; turns=0
                for tick in range(protocol['max_steps']):
                    action=policy(obs); turns+=action!=0
                    obs,reward,done,trunc,info=env.step(action);reward_sum+=reward
                    cap=tick+1==protocol['max_steps'] and not(done or trunc)
                    if done or trunc or cap:
                        all_rows.append({'policy':name,'block':block,'episode':episode+1,'seed':block+episode,'random_action_seed':block+1000000 if name=='Random' else '',**info,'terminated':done,'truncated':trunc or cap,'end_reason':'evaluation_step_limit' if cap else info['end_reason'],'turn_ratio':turns/info['steps'],'episode_reward':reward_sum})
                        break
            env.close()
            elapsed=time.perf_counter()-started
            timings.append({'block':block,'policy':name,'episodes':100,'seconds':elapsed})
            with destination.open('w',newline='',encoding='utf8') as f:
                writer=csv.DictWriter(f,fieldnames=list(all_rows[0]));writer.writeheader();writer.writerows(all_rows)
            print(block,name,'mean score',np.mean([r['score'] for r in all_rows[-100:]]),'seconds',elapsed,flush=True)
    (out/'raw_run.json').write_text(json.dumps({'complete':True,'episodes':len(all_rows),'timings':timings},indent=2)+'\n')


if __name__=='__main__': main()
