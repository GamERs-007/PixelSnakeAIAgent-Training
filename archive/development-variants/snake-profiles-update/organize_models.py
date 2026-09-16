"""Reviewable, hash-checked file renames within the original models directory."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import torch
from rl.model_profiles import model_profile

parser=argparse.ArgumentParser()
parser.add_argument('--apply',action='store_true')
args=parser.parse_args()
root=Path('D:/isaac-lab/PixelSnake/models').resolve()
manifest=Path(__file__).with_name('model-renames.json')
if not args.apply:
    rows=[]
    for source in sorted(root.rglob('*.pt')):
        assert source.resolve().is_relative_to(root)
        data=torch.load(source,map_location='cpu',weights_only=True)
        metadata=data.get('metadata',{})
        profile=model_profile(metadata,source.relative_to(root).as_posix())
        stamp=datetime.fromtimestamp(source.stat().st_mtime).astimezone()
        episode=int(metadata.get('episode',0))
        destination=root/profile/f'{stamp:%Y-%m-%d_%H-%M-%S-%f}_ep{episode}.pt'
        if destination != source and (destination.exists() or any(r['to']==str(destination) for r in rows)):
            raise FileExistsError(destination)
        rows.append({'from':str(source),'to':str(destination),'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
    manifest.write_text(json.dumps(rows,indent=2),encoding='utf-8')
    print(json.dumps(rows,indent=2))
else:
    rows=json.loads(manifest.read_text(encoding='utf-8'))
    # Validate every source and destination before making any changes.
    for row in rows:
        source,destination=Path(row['from']).resolve(),Path(row['to']).resolve()
        assert source.is_relative_to(root) and destination.is_relative_to(root)
        assert source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest()==row['sha256']
        assert source==destination or not destination.exists()
    for row in rows:
        source,destination=Path(row['from']),Path(row['to'])
        if source!=destination:
            destination.parent.mkdir(exist_ok=True)
            source.rename(destination)
        assert hashlib.sha256(destination.read_bytes()).hexdigest()==row['sha256']
    print(f'Organized {len(rows)} models; all file hashes unchanged.')
