"""Fail-fast recorded full-suite repetitions; never retries a failed pass."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--rounds',type=int,default=3);parser.add_argument('--label',default='main');args=parser.parse_args()
out=ROOT/'results/full_recheck_2026_09_15'
dest=out/f'tests_{args.label}.json'
if dest.exists():raise FileExistsError(dest)
rows=[];env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
env.pop('SNAKE_SAFETY_SOURCE',None)
for iteration in range(1,args.rounds+1):
    for suite,cmd in [('python',[sys.executable,'-B','-m','unittest','discover','-s','rl','-p','test_*.py']),('javascript',['node','--test',*[str(p.relative_to(ROOT)) for p in sorted((ROOT/'tests').glob('*.test.cjs'))]])]:
        started=time.perf_counter();r=subprocess.run(cmd,cwd=ROOT,env=env,text=True,capture_output=True,encoding='utf8',errors='replace')
        log=r.stdout+r.stderr;path=out/'logs'/f'tests-{args.label}-{iteration}-{suite}.log';path.write_text(log,encoding='utf8')
        count=re.search(r'Ran (\d+) tests',log) if suite=='python' else re.search(r'(?:ℹ|#) tests (\d+)',log)
        rows.append({'suite':suite,'iteration':iteration,'exit_code':r.returncode,'tests':int(count[1]) if count else None,'seconds':time.perf_counter()-started,'command':cmd,'log':path.relative_to(ROOT).as_posix()})
        dest.write_text(json.dumps({'complete':False,'runs':rows},indent=2)+'\n')
        print(rows[-1],flush=True)
        if r.returncode:raise SystemExit(r.returncode)
dest.write_text(json.dumps({'complete':True,'runs':rows},indent=2)+'\n')
