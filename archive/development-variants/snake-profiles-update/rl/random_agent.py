"""Reproducible random-policy evaluation; no learning or neural network."""

from __future__ import annotations

import argparse
import json
from statistics import mean, median
from typing import Any

if __package__:
    from .snake_env import SnakeEnv
else:
    from snake_env import SnakeEnv


def evaluate(episodes: int = 100, seed: int = 42) -> dict[str, Any]:
    if isinstance(episodes, bool) or not isinstance(episodes, int) or episodes < 1:
        raise ValueError("episodes must be a positive integer.")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ValueError("seed must be a non-negative integer.")
    env = SnakeEnv()
    records = []
    try:
        for episode in range(episodes):
            # Action-space and food RNGs are separate and both must be seeded.
            episode_seed = seed + episode
            env.action_space.seed(episode_seed)
            _, info = env.reset(seed=episode_seed)
            terminated = truncated = False
            total_reward = 0.0
            while not (terminated or truncated):
                _, reward, terminated, truncated, info = env.step(env.action_space.sample())
                total_reward += reward
            records.append({"episode": episode + 1, "seed": episode_seed, **info,
                            "return": total_reward, "terminated": terminated, "truncated": truncated})
    finally:
        env.close()
    return {
        "episodes": episodes, "seed": seed,
        "mean_score": mean(record["score"] for record in records),
        "median_score": median(record["score"] for record in records),
        # Survival length is time in successful grid moves, not the snake's size.
        "mean_survival_length": mean(record["steps_survived"] for record in records),
        "mean_episode_steps": mean(record["steps"] for record in records),
        "terminated_episodes": sum(record["terminated"] for record in records),
        "truncated_episodes": sum(record["truncated"] for record in records),
        "records": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episodes", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--details", action="store_true", help="Include each episode's record in JSON.")
    args = parser.parse_args()
    try:
        report = evaluate(args.episodes, args.seed)
    except ValueError as error:
        parser.error(str(error))
    if not args.details:
        report.pop("records")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
