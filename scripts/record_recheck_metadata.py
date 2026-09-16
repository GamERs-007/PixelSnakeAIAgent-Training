"""Record task provenance without changing historical files or model weights."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'results/full_recheck_2026_09_15'
p=OUT/'metadata.json';m=json.loads(p.read_text())
m['git_before']='5c956389ba349739b861e8d7970809a28cf6571f'
m['git_before_error']='Initial project directory had no .git. Existing upload clone located in prior task; its unchanged Git metadata was copied into the canonical project root. No git init was used.'
m['git_implementation']='0f443f177ee00b666b17906aca6a9b41b69f1672'
m['git_branch']='main';m['git_remote']='https://github.com/GamERs-007/PixelSnakeAIAgent-Training.git'
m['git_provenance']='Source at experiment start included existing unpushed profile/UI changes relative to git_before; exact source_before hashes distinguish this working baseline from that commit.'
m['date_note']='Experiment folder follows local start date 2026-09-15. The ISO start timestamp is recorded separately; file timestamps and Git commits record subsequent creation times.'
m['source_after']={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['js','rl','tests','scripts'] for p in sorted((ROOT/folder).rglob('*')) if p.is_file() and p.suffix in ['.js','.cjs','.py']}
m['hardware']=subprocess.run(['powershell','-NoProfile','-Command','Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress'],capture_output=True,text=True,check=True).stdout.strip()
p.write_text(json.dumps(m,indent=2)+'\n')
notes={
 'definitive_data':{'raw':'raw_episodes.csv','safety':'safety_final.json','ultimate_before':'ultimate_before_verified.json','ultimate_after':'ultimate_final.json'},
 'protocol_amendments':[
  'Trained-network parity uses rtol=1e-5, atol=1e-5, with exact observation and greedy-action equality. The original random-network test remains at atol=1e-6. Its trained-weight pilot failed only a near-zero Q-value tolerance (violation up to 1.80e-6); full logs are retained.',
  'Fixed evaluator repeated-state counting: capture prior membership before updating the map. The initial ultimate_before pilot did not correctly count repeated_ordered_states; before_verified reruns the old controller with corrected accounting.',
  'The 400-move locked-mode food bound starts at max(last food, first lock), not at food collected during recovery. ultimate_current and before_checked had premature ordered_no_progress_bug endings; these are instrumentation pilots, not definitive results.',
  'Legacy fixture food bound increased from 400 to 800 for joining plus traversal. The observed first food was step 477 for fixture 7. Exhaustive aligned tests still enforce <=400, and production episodes distinguish recovery from lock.',
  'Candidate4 was interrupted while seed10 was expensive after ten completed seeds. Its incomplete file and log remain. Final controller immediately replans after real food growth.'
 ],
 'candidates':{'candidate1':'Complete-state recovery visit memory only; failures retained.','candidate2':'Stop prioritizing food in recovery; failures retained.','candidate3':'Width32 moving-body beam search; seed10 still failed.','verified':'Corrected instrumentation rerun of candidate3; not final.','candidate4':'Width128 and hypothetical post-food lookahead, but delayed growth replanning; incomplete.','final':'Width128 lookahead, execute only to known food, immediately replan after real growth.'},
 'limitations':['Twenty Ultimate seeds were used during development, so final outcomes are regression evidence, not an untouched holdout estimate.','Nine of eleven already near-full legacy loop fixtures did not eat within the 1,600-move diagnostic. All eleven remained collision-free; only two ate.','Synchronous bounded search can pause browser responsiveness; measured worst decision in final20 is recorded.','Three evaluation blocks do not replace multiple independent training seeds.','Qwen is historical only; no fresh local model evaluation was run.']}
(OUT/'experiment_notes.json').write_text(json.dumps(notes,indent=2)+'\n')
print(m['hardware'])
