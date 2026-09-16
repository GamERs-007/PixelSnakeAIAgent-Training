"""Recompute every published statistic and figure from preserved episode data."""
import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--experiment',type=Path,default=ROOT/'results/full_recheck_2026_09_15');args=parser.parse_args()
OUT=args.experiment.resolve();FIG=OUT/'figures';FIG.mkdir(exist_ok=True)
load=lambda p:json.loads(p.read_text(encoding='utf8'))
protocol=load(OUT/'protocol.json');metadata=load(OUT/'metadata.json')
with (OUT/'raw_episodes.csv').open(encoding='utf8') as f: raw=list(csv.DictReader(f))
for r in raw:
    for k in ['score','steps','steps_survived','food_collected','seed','block']:r[k]=int(r[k])
    r['turn_ratio']=float(r['turn_ratio'])
    for k in ['terminated','truncated','won']:r[k]=r[k]=='True'
safety=load(OUT/'safety_final.json');before=load(OUT/'ultimate_before_verified.json');after=load(OUT/'ultimate_final.json')
assert all(x['complete'] for x in [safety,before,after])
assert len(raw)==1200 and len(safety['records'])==160 and len(after['records'])==len(before['records'])==20

def ci(values):
    v=np.asarray(values,float);rng=np.random.default_rng(9152026)
    return np.percentile(v[rng.integers(0,len(v),(2000,len(v)))].mean(axis=1),[2.5,97.5]).tolist()

def stats(rows):
    scores=np.array([r['score'] for r in rows]);ends=Counter(r['end_reason'] for r in rows)
    return {'episodes':len(rows),'mean_score':float(scores.mean()),'median_score':float(np.median(scores)),
        'std_score':float(scores.std(ddof=1)),'min_score':int(scores.min()),'max_score':int(scores.max()),
        'score_ci95':ci(scores),'mean_food_collected':float(np.mean([r['food_collected'] for r in rows])),
        'mean_survival_steps':float(np.mean([r['steps_survived'] for r in rows])),
        'mean_attempted_steps':float(np.mean([r['steps'] for r in rows])),
        'mean_turn_ratio':float(np.mean([r['turn_ratio'] for r in rows])),
        'terminated':sum(r['terminated'] for r in rows),'truncated':sum(r['truncated'] for r in rows),
        'end_reasons':{k:ends[k] for k in ['wall','self','no_food_limit','board_full','evaluation_step_limit','ordered_no_progress_bug']},
        'wins':sum(r['won'] for r in rows),'win_rate':sum(r['won'] for r in rows)/len(rows)}

names=protocol['raw']['policies']
groups={n:[r for r in raw if r['policy']==n] for n in names}
raw_stats={n:stats(rows) for n,rows in groups.items()}
for n,rows in groups.items():
    blocks={str(b):stats([r for r in rows if r['block']==b]) for b in protocol['raw']['blocks']}
    means=[r['mean_score'] for r in blocks.values()]
    raw_stats[n].update(blocks=blocks,block_mean_score_std=float(np.std(means,ddof=1)))
safety_stats={f'{n}_{flag}':stats([r for r in safety['records'] if r['policy']==n and r['assistance']==flag]) for n in names for flag in [False,True]}
ultimate_stats={}
for label,data in [('before',before),('after',after)]:
    rows=data['records'];s=stats(rows)
    for k in ['reached_half','ordered_steps','recovery_steps','repeated_states','repeated_ordered_states','unexpected_ordered_fallbacks','ordered_progress_errors','collision_after_requested','collision_after_locked','no_food_after_requested']:s[k]=sum(r[k] for r in rows)
    s['locked_episodes']=sum(r['ordered_locked_step'] is not None for r in rows)
    s['mean_max_occupancy_percent']=float(np.mean([r['max_occupancy_percent'] for r in rows]))
    s['max_repeated_cycle_length']=max(r['max_repeated_cycle_length'] for r in rows)
    s['mean_steps_half_to_win']=float(np.mean([r['steps_half_to_win'] for r in rows if r['won']]))
    s['max_decision_ms']=max(r['max_decision_ms'] for r in rows)
    s['total_seconds']=sum(r['elapsed_seconds'] for r in rows)
    ultimate_stats[label]=s
diff=np.array([r['score'] for r in groups['Strategy']])-np.array([r['score'] for r in groups['Classic']])
comparison={'strategy_minus_classic_mean_score':float(diff.mean()),'paired_score_ci95':ci(diff),
    'interpretation':'Evaluation-seed uncertainty for these frozen checkpoints; not uncertainty across independently trained models.'}
for label,data in [('safety',safety),('ultimate_before',before),('ultimate_after',after)]:
    with (OUT/f'{label}_episodes.csv').open('w',newline='',encoding='utf8') as f:
        writer=csv.DictWriter(f,fieldnames=list(data['records'][0]));writer.writeheader();writer.writerows(data['records'])

plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.dpi':120,'savefig.dpi':200})
colors=['#7c8898','#d99b36','#3976b8','#14877e'];figures=[]
def canvas(title,ylabel):
    fig,ax=plt.subplots(figsize=(8.4,4.2),layout='constrained');ax.set(title=title,ylabel=ylabel);ax.grid(axis='y',alpha=.2);ax.set_axisbelow(True);return fig,ax
def save(fig,name,source,caption):
    fig.savefig(FIG/f'{name}.png',metadata={'Software':'PixelSnake recheck'})
    fig.savefig(FIG/f'{name}.pdf',metadata={'CreationDate':None,'ModDate':None})
    plt.close(fig);figures.append({'file':f'figures/{name}.png','vector':f'figures/{name}.pdf','source':source,'caption':caption})
with (ROOT/'results/training.csv').open() as f:train=list(csv.DictReader(f))
for name,column,title,ylabel in [('01_training_score','score','Historical: original DQN training','Score (10 per food)'),('02_training_moving_average','moving_average_score','Historical: trailing 100-episode score','Mean score'),('03_training_reward','episode_reward','Historical: original training return','Episode return')]:
    fig,ax=canvas(title,ylabel);ax.plot([int(r['episode']) for r in train],[float(r[column]) for r in train],color=colors[2],lw=.8);ax.set_xlabel('Training episode');ax.set_xlim(0,2000)
    if column!='episode_reward':ax.set_ylim(bottom=0)
    save(fig,name,'results/training.csv','HISTORICAL / ORIGINAL EXPERIMENT. Regenerated from the original 2,000-episode CSV; no retraining.')
for name,column,title,ylabel in [('04_raw_scores','score','Fresh raw policies: score distribution','Score'),('05_raw_survival','steps_survived','Fresh raw policies: survival distribution','Successful moves'),('06_raw_turn_rate','turn_ratio','Fresh raw policies: turning frequency','Turns / attempted moves')]:
    fig,ax=canvas(title,ylabel);b=ax.boxplot([[r[column] for r in groups[n]] for n in names],tick_labels=names,patch_artist=True,showmeans=True)
    for patch,c in zip(b['boxes'],colors):patch.set_facecolor(c);patch.set_alpha(.55)
    ax.set_ylim(bottom=0);save(fig,name,'raw_episodes.csv','CURRENT FRESH RE-EVALUATION. 300 episodes per policy across three matched 100-seed blocks. Boxes show median and quartiles; triangles show means.')
for name,field,title,ylabel in [('07_safety_scores','mean_score','Browser assistance OFF / ON','Mean score'),('08_safety_survival','mean_survival_steps','Browser assistance OFF / ON','Mean successful moves')]:
    fig,ax=canvas(title,ylabel);x=np.arange(4)
    for flag,offset,c in [(False,-.18,colors[0]),(True,.18,colors[3])]:ax.bar(x+offset,[safety_stats[f'{n}_{flag}'][field] for n in names],.36,label='Assistance '+('ON' if flag else 'OFF'),color=c)
    ax.set_xticks(x,names);ax.legend();ax.set_ylim(bottom=0)
    save(fig,name,'safety_episodes.csv','CURRENT FRESH RE-EVALUATION. 20 matched browser seeds per condition; 3,000 attempted-step cap. These are separate from the Gymnasium raw-policy protocol. Surviving to the cap is not a win.')
fig,ax=canvas('Ultimate: maximum occupancy','Board occupied (%)')
for i,(label,data) in enumerate([('Before',before),('After',after)]):ax.scatter(np.full(20,i)+np.linspace(-.12,.12,20),[r['max_occupancy_percent'] for r in data['records']],s=25,alpha=.65,label=label,color=colors[0 if i==0 else 3])
ax.set_xticks([0,1],['Before fix','After fix']);ax.set_ylim(0,105)
save(fig,'09_ultimate_occupancy','ultimate_before_episodes.csv; ultimate_after_episodes.csv','Maximum occupancy for each of 20 matched seeds, with deterministic horizontal jitter for overlapping points.')
fig,ax=canvas('Ultimate: completion and recovery outcomes','Episodes')
x=np.arange(2);wins=[ultimate_stats[k]['wins'] for k in ['before','after']];ax.bar(x,wins,label='Full-board win',color=colors[3]);ax.bar(x,20-np.array(wins),bottom=wins,label='No-food ending in recovery',color=colors[1]);ax.set_xticks(x,['Before fix','After fix']);ax.set_ylim(0,23);ax.legend()
save(fig,'10_ultimate_outcomes','ultimate_before_episodes.csv; ultimate_after_episodes.csv','All episodes reached >50%. Each ending is classified from the actual engine/evaluator result; step-limit survival is never a win.')
fig,ax=canvas('Ultimate: actual seed 10 progression','Board occupied (%)')
for label,data,c in [('Before',before,colors[1]),('After',after,colors[3])]:
    trace=data['traces']['10'];ax.plot([r['step'] for r in trace],[r['occupancy'] for r in trace],label=label,color=c)
ax.axhline(50,color='#555555',ls='--',lw=.8,label='50% threshold');ax.set(xlabel='Attempted moves',ylim=(0,105),xlim=(0,None));ax.legend()
save(fig,'11_ultimate_progression','ultimate_before_verified.json; ultimate_final.json','Seed 10 was selected as the first investigated failing seed, not as a representative success. Traces are sampled every 100 moves and at food/mode transitions.')
fig,ax=canvas('Fresh raw policies: episode endings','Episodes');base=np.zeros(4)
for reason,c in [('wall',colors[0]),('self',colors[1]),('no_food_limit',colors[2]),('board_full',colors[3])]:
    values=np.array([raw_stats[n]['end_reasons'][reason] for n in names]);ax.bar(names,values,bottom=base,label=reason,color=c);base+=values
ax.legend(ncol=4,loc='upper center');ax.set_ylim(0,355)
save(fig,'12_raw_end_reasons','raw_episodes.csv','Raw policy termination categories, 300 episodes per policy; successful survival and attempted steps differ by one on collisions.')
fig,ax=canvas('Fresh raw policies: mean score and 95% bootstrap CI','Mean score');means=np.array([raw_stats[n]['mean_score'] for n in names]);bounds=np.array([raw_stats[n]['score_ci95'] for n in names]);ax.bar(names,means,color=colors);ax.errorbar(names,means,yerr=np.stack([means-bounds[:,0],bounds[:,1]-means]),fmt='none',ecolor='#202b3b',capsize=5);ax.set_ylim(bottom=0)
save(fig,'13_raw_confidence_intervals','raw_episodes.csv','Percentile bootstrap confidence intervals: 2,000 resamples, seed 9152026. Intervals describe held-out episode sampling for the fixed models, not training-seed variation.')

summary={'label':'CURRENT FRESH RE-EVALUATION','metadata':metadata,'protocol':protocol,'raw':raw_stats,'safety':safety_stats,'ultimate':ultimate_stats,'paired_comparison':comparison,
    'tests':load(OUT/'tests_main.json'),'trained_parity':load(OUT/'trained_parity.json'),'figures':figures,
    'report':'reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.pdf',
    'definitive_inputs':['raw_episodes.csv','safety_final.json','ultimate_before_verified.json','ultimate_final.json'],
    'historical_training':load(ROOT/'results/training_status.json')}
if (OUT/'tests_final.json').exists():summary['final_tests']=load(OUT/'tests_final.json')
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf8')
(OUT/'figure_manifest.json').write_text(json.dumps(figures,indent=2)+'\n',encoding='utf8')
print(json.dumps({'raw':{k:{x:v[x] for x in ['mean_score','std_score','score_ci95','mean_survival_steps','mean_turn_ratio']} for k,v in raw_stats.items()},'paired':comparison,'ultimate':ultimate_stats},indent=2))
