"""Public model schemes; preserve the legacy numeric reward implementation."""
PROFILES = ('classic', 'strategy', 'ultimate')


def normalize_profile(profile):
    if profile == 'strategy_v1':
        profile = 'strategy'
    if profile not in PROFILES:
        raise ValueError('Choose classic, strategy, or ultimate')
    return profile


def model_profile(metadata, relative_path=''):
    if metadata.get('model_profile'):
        return normalize_profile(metadata['model_profile'])
    # Old ultimate checkpoints used strategy rewards plus a browser rule.
    if metadata.get('inference_rules', {}).get('dense_board_sweep_above_half') is True:
        return 'ultimate'
    folder = str(relative_path).replace('\\', '/').split('/')[0]
    if folder in PROFILES:
        return folder
    return normalize_profile(metadata.get('env_config', {}).get('reward_profile', 'classic'))


def training_reward(profile):
    return 'classic' if normalize_profile(profile) == 'classic' else 'strategy_v1'


def inference_rules(profile):
    return {'dense_board_sweep_above_half': True} if normalize_profile(profile) == 'ultimate' else {}
