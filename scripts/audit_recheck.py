"""Final reproducibility audit. Fails on stale documentation or changed history."""
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import numpy as np
import torch

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'results/full_recheck_2026_09_15'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
load=lambda p:json.loads(p.read_text(encoding='utf8'))
summary=load(OUT/'summary.json');checks={}
history=load(OUT/'historical_hashes.json')
for name,expected in history.items():assert digest(ROOT/name)==expected,name
checks['historical_files_unchanged']=len(history)
for name,item in summary['metadata']['models'].items():assert digest(ROOT/item['file'])==item['sha256'],name
payloads={n:torch.load(ROOT/v['file'],map_location='cpu',weights_only=True) for n,v in summary['metadata']['models'].items()}
assert all(torch.equal(v,payloads['ultimate']['online'][k]) for k,v in payloads['strategy']['online'].items())
checks['active_model_hashes_verified']=3;checks['strategy_ultimate_online_tensors_identical']=True
with (OUT/'raw_episodes.csv').open() as f:rows=list(csv.DictReader(f))
assert len(rows)==1200
for name,s in summary['raw'].items():
    selected=[r for r in rows if r['policy']==name]
    assert len(selected)==300
    seeds={int(r['seed']) for r in selected}
    assert seeds=={b+i for b in [500000,501000,502000] for i in range(100)}
    values=np.array([int(r['score']) for r in selected])
    assert np.isclose(values.mean(),s['mean_score']) and np.isclose(values.std(ddof=1),s['std_score'])
    assert all(int(r['score'])==10*int(r['food_collected']) for r in selected)
    assert all(int(r['steps'])-int(r['steps_survived'])==(r['end_reason'] in ['wall','self']) for r in selected)
checks['raw_episodes_verified']=1200
for file,expected in [('safety_final.json',160),('ultimate_before_verified.json',20),('ultimate_final.json',20)]:
    data=load(OUT/file);assert data['complete'] and len(data['records'])==expected
    assert all(r['score']==10*r['food_collected'] for r in data['records'])
    assert all(not r['won'] or r['score']==3970 for r in data['records'])
    assert all(r['terminated']!=r['truncated'] for r in data['records'])
checks['browser_episodes_verified']=200
main=load(OUT/'tests_main.json');final=load(OUT/'tests_final.json')
assert main['complete'] and final['complete'] and len(main['runs'])==6 and len(final['runs'])==2
assert all(x['exit_code']==0 and x['tests']==(64 if x['suite']=='python' else 97) for x in main['runs']+final['runs'])
checks['full_test_passes']=4
for i in [1,2]:
    text=(OUT/'logs'/f'regression-extra-{i}.log').read_text(encoding='utf8')
    assert re.search(r'tests 10',text) and re.search(r'pass 10',text) and re.search(r'fail 0',text)
old=(OUT/'logs/regression-old-final.log').read_text(encoding='utf8')
assert 'the original seed-10 recovery loop must be prevented' in old and 'fail 1' in old
checks['old_fails_new_passes']=True
report=ROOT/'reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.md'
links=[]
for doc in [ROOT/'README.md',report]:
    text=doc.read_text(encoding='utf8')
    for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',text):
        if re.match(r'https?://|#',target):continue
        path=(doc.parent/target.split('#')[0]).resolve();assert path.exists(),(doc,target);links.append(target)
    for name,v in summary['raw'].items():assert f"{v['mean_score']:.2f}" in text,(doc,name)
    assert 'HISTORICAL / ORIGINAL EXPERIMENT' in text
checks['local_document_links']=len(links)
figure_files=sorted((OUT/'figures').glob('*'));before={p.name:digest(p) for p in figure_files}
subprocess.run([sys.executable,'-B','scripts/generate_report_figures.py'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
assert {p.name:digest(p) for p in figure_files}==before,'Figures changed on identical input'
checks['byte_reproducible_figures']=len(figure_files)
doc_hashes={str(p):digest(p) for p in [ROOT/'README.md',report]}
subprocess.run([sys.executable,'-B','scripts/build_recheck_documents.py'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
assert {str(p):digest(p) for p in [ROOT/'README.md',report]}==doc_hashes,'Documents were stale'
checks['documents_match_summary']=True
pdf=report.with_suffix('.pdf');assert pdf.exists() and pdf.stat().st_size>50000
checks['report_sha256']=digest(pdf)
checks['browser_smoke']=load(OUT/'browser_smoke.json')
assert checks['browser_smoke']['observed_win'] and checks['browser_smoke']['console_errors_warnings']==[]
inventory=[{'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name not in ['artifact_manifest.json','audit.json'] and p.suffix not in ['.tmp']]
(OUT/'artifact_manifest.json').write_text(json.dumps(inventory,indent=2)+'\n')
checks['artifacts_hashed']=len(inventory)
(OUT/'audit.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2)+'\n')
print(json.dumps(checks,indent=2))
