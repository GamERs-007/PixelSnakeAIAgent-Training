"""Create a separate rule-enabled checkpoint without altering trained parameters."""
import hashlib
from pathlib import Path
import torch

source = Path('D:/isaac-lab/PixelSnake/models/strategy_v1/2300_model.pt')
destination = Path(__file__).parent / 'models/strategy_v1/2300_fill50_model.pt'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
payload = torch.load(source, map_location='cpu', weights_only=True)
payload['metadata'] = {**payload['metadata'],
    'inference_rules': {'dense_board_sweep_above_half': True},
    'variant_source': 'strategy_v1/2300_model.pt',
    'variant_source_sha256': source_hash,
    'variant_description': 'Original strategy_v1 episode 2300 weights; browser safety sweep above 50% board occupancy.'}
destination.parent.mkdir(parents=True, exist_ok=True)
with destination.open('xb') as handle:
    torch.save(payload, handle)
saved = torch.load(destination, map_location='cpu', weights_only=True)
original = torch.load(source, map_location='cpu', weights_only=True)

def identical(a, b):
    if isinstance(a, torch.Tensor):
        return isinstance(b, torch.Tensor) and torch.equal(a, b)
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(identical(a[k], b[k]) for k in a)
    if isinstance(a, (tuple, list)):
        return type(a) is type(b) and len(a) == len(b) and all(identical(x, y) for x, y in zip(a, b))
    return a == b

assert saved.keys() == original.keys()
for field in original:
    if field != 'metadata':
        assert identical(original[field], saved[field]), field
assert saved['metadata']['episode'] == 2300
assert saved['metadata']['env_config']['reward_profile'] == 'strategy_v1'
assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
print(f'Created and verified: {destination}; source SHA256: {source_hash}')
