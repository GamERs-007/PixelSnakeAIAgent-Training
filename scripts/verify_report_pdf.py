"""Structural/text verification supplements (does not replace) rendered page review."""
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'results/full_recheck_2026_09_15'
pdf=ROOT/'reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.pdf'
reader=PdfReader(pdf);summary=json.loads((OUT/'summary.json').read_text())
texts=[p.extract_text() for p in reader.pages];text='\n'.join(texts)
assert len(reader.pages)==26 and all(len(t)>200 for t in texts)
assert sum(len(p.images) for p in reader.pages)==13
for n,v in summary['raw'].items():assert f"{v['mean_score']:.2f}" in text,n
for item in summary['metadata']['models'].values():assert item['sha256'] in text
for phrase in ['Abstract','References','no universal recovery guarantee','97 JavaScript','64 Python','HISTORICAL / ORIGINAL EXPERIMENT']:
    assert phrase in text,phrase
assert '\ufffd' not in text
record={'pages':len(reader.pages),'embedded_figures':sum(len(p.images) for p in reader.pages),
    'all_pages_have_text':True,'raw_means_and_model_hashes_match_summary':True,
    'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),
    'method':'pypdf text/structure checks; visual inspection of Poppler-rendered pages is recorded separately.'}
(OUT/'report_pdf_validation.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
