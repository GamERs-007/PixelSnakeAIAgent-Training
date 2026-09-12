"""Greedy held-out evaluation of DQN and observation-only baseline agents."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from statistics import mean, median

import numpy as np

from rl.snake_env import SnakeEnv
from .agent import DQNAgent

ROOT = Path(__file__).resolve().parents[2]


class RandomAgent:
    def __init__(self, seed=42):
        self.rng = np.random.default_rng(seed)

    def choose_action(self, observation):
        return int(self.rng.integers(3))


class HeuristicAgent:
    """Port the JS greedy rule using the same 10 observations as DQN."""
    def choose_action(self, observation):
        safe = [a for a in range(3) if observation[a] == 0]
        if not safe:
            return 0
        direction = int(np.argmax(observation[3:7]))
        # JS tie order is up, down, left, right after preferring straight.
        tie_order = {0: 0, 2: 1, 3: 2, 1: 3}
        def rank(action):
            heading = (direction + (0, -1, 1)[action]) % 4
            dx, dy = SnakeEnv.DIRECTIONS[heading]
            # A move toward food reduces Manhattan distance by 1; away adds 1.
            # At zero offset either sign increases distance. No hidden board access.
            change = sum(0 if move == 0 else -1 if offset * move > 0 else 1
                         for offset, move in zip(observation[7:9], (dx, dy)))
            return change, action != 0, tie_order[heading]
        return min(safe, key=rank)


def rollout(policy, episodes, seed, env_config=None, max_episode_steps=10000):
    if episodes < 1 or max_episode_steps < 1:
        raise ValueError("episodes and max_episode_steps must be positive")
    env = SnakeEnv(**(env_config or {}))
    records = []
    try:
        for episode in range(episodes):
            observation, _ = env.reset(seed=seed + episode)
            total_reward = 0.0
            for tick in range(max_episode_steps):
                action = policy(observation)
                observation, reward, terminated, truncated, info = env.step(action)
                total_reward += reward
                capped = tick + 1 == max_episode_steps and not (terminated or truncated)
                if terminated or truncated or capped:
                    records.append({"episode": episode + 1, "seed": seed + episode,
                                    "episode_reward": total_reward, **info,
                                    "terminated": terminated, "truncated": truncated or capped,
                                    "end_reason": "evaluation_step_limit" if capped else info["end_reason"]})
                    break
    finally:
        env.close()
    return records


def summarize(records):
    scores = [row["score"] for row in records]
    return {"episodes": len(records), "mean_score": mean(scores), "median_score": median(scores),
            "maximum_score": max(scores),
            "mean_survival_steps": mean(row["steps_survived"] for row in records),
            "mean_reward": mean(row["episode_reward"] for row in records),
            "terminated": sum(row["terminated"] for row in records),
            "truncated": sum(row["truncated"] for row in records)}


def evaluate(checkpoint, episodes=100, seed=200000, output_dir=ROOT / "results"):
    if episodes < 100:
        raise ValueError("Final evaluation requires at least 100 episodes per policy")
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    agent, metadata = DQNAgent.load(checkpoint)
    agent.online.eval()
    random_agent, heuristic = RandomAgent(seed + 1000000), HeuristicAgent()
    policies = {"DQN": lambda obs: agent.choose_action(obs, explore=False),
                "RandomAgent": random_agent.choose_action, "HeuristicAgent": heuristic.choose_action}
    report = {"checkpoint": str(Path(checkpoint).resolve()),
              "checkpoint_sha256": hashlib.sha256(Path(checkpoint).read_bytes()).hexdigest(),
              "checkpoint_episode": metadata.get("episode"), "seed": seed,
              "exploration_epsilon": 0.0, "env_config": metadata.get("env_config", {}), "policies": {}}
    all_records = []
    for name, policy in policies.items():
        records = rollout(policy, episodes, seed, report["env_config"])
        report["policies"][name] = summarize(records)
        all_records.extend({"policy": name, **row} for row in records)
    with (output_dir / "evaluation_episodes.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(all_records[0]))
        writer.writeheader(); writer.writerows(all_records)
    (output_dir / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "models/best_model.pt")
    parser.add_argument("--episodes", type=int, default=100)
    parser.add_argument("--seed", type=int, default=200000)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "results")
    args = parser.parse_args()
    print(json.dumps(evaluate(args.checkpoint, args.episodes, args.seed, args.output_dir), indent=2))


if __name__ == "__main__":
    main()
