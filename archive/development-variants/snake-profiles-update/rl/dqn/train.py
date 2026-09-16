"""Train vanilla DQN without a high-level RL library; retain all episode logs."""
import argparse
import csv
from dataclasses import asdict
import json
from pathlib import Path
import platform
from statistics import mean
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import gymnasium

from rl.snake_env import SnakeEnv
from .agent import DQNAgent, DQNConfig
from .evaluate import rollout, summarize

ROOT = Path(__file__).resolve().parents[2]


def plot_training(csv_path, output_dir):
    with Path(csv_path).open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    episodes = [int(row["episode"]) for row in rows]
    for column, title, filename in [
        ("episode_reward", "Training reward", "training_reward.png"),
        ("score", "Training score", "training_score.png"),
        ("moving_average_score", "Trailing 100-episode mean score", "moving_average_score.png")]:
        fig, ax = plt.subplots(figsize=(9, 4.5), constrained_layout=True)
        ax.plot(episodes, [float(row[column]) for row in rows], color="#2769b0", linewidth=1, alpha=.85)
        ax.set(xlabel="Episode", ylabel=title, title=title + " vs episode")
        ax.grid(alpha=.2)
        fig.savefig(Path(output_dir) / filename, dpi=160)
        plt.close(fig)


def train(episodes=2000, seed=42, output_root=ROOT, validation_every=100, validation_episodes=20):
    if not 1 <= episodes < 100000 or validation_every < 1 or validation_episodes < 1:
        raise ValueError("Use positive episode counts; training seeds must not overlap validation seeds")
    output_root = Path(output_root)
    models, results = output_root / "models", output_root / "results"
    if any((folder / name).exists() for folder, name in
           [(models, "best_model.pt"), (models, "latest_model.pt"), (results, "training.csv")]):
        raise FileExistsError("Run artifacts already exist; choose a new --output-root to preserve them")
    models.mkdir(parents=True, exist_ok=True); results.mkdir(parents=True, exist_ok=True)
    config = DQNConfig(seed=seed)
    env_config = {"board_size": 20, "max_steps_without_food": 400}
    agent, env = DQNAgent(config), SnakeEnv(**env_config)
    run_config = {"dqn": asdict(config), "env": env_config, "episodes": episodes,
                  "training_seed_start": seed, "validation_seed_start": 100000,
                  "validation_every": validation_every, "validation_episodes": validation_episodes,
                  "moving_average_window": 100, "max_episode_steps": 10000,
                  "device": "cpu", "threads": 1, "python": platform.python_version(),
                  "torch": str(torch.__version__), "numpy": np.__version__, "gymnasium": gymnasium.__version__}
    if seed < 0 or seed + episodes > 100000:
        raise ValueError("Training seed range must stay below validation seed 100000")
    (results / "run_config.json").write_text(json.dumps(run_config, indent=2) + "\n", encoding="utf-8")
    fields = ["episode", "episode_reward", "score", "epsilon", "training_loss", "moving_average_score",
              "steps", "steps_survived", "food_collected", "terminated", "truncated", "end_reason",
              "environment_steps", "optimizer_updates"]
    scores, validations = [], []
    best_validation = float("-inf")
    started = time.perf_counter()
    episode = 0
    try:
        with (results / "training.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
            for episode in range(1, episodes + 1):
                observation, _ = env.reset(seed=seed + episode - 1)
                total_reward, losses = 0.0, []
                for tick in range(10000):
                    action = agent.choose_action(observation)
                    next_observation, reward, terminated, truncated, info = env.step(action)
                    capped = tick == 9999 and not (terminated or truncated)
                    loss = agent.observe(observation, action, reward, next_observation, terminated, truncated or capped)
                    if loss is not None:
                        losses.append(loss)
                    total_reward += reward
                    observation = next_observation
                    if terminated or truncated or capped:
                        break
                scores.append(info["score"])
                moving = mean(scores[-100:])
                writer.writerow({"episode": episode, "episode_reward": total_reward, "score": info["score"],
                                 "epsilon": agent.epsilon, "training_loss": mean(losses) if losses else "",
                                 "moving_average_score": moving, "steps": info["steps"],
                                 "steps_survived": info["steps_survived"], "food_collected": info["food_collected"],
                                 "terminated": terminated, "truncated": truncated or capped,
                                 "end_reason": "training_step_limit" if capped else info["end_reason"],
                                 "environment_steps": agent.environment_steps, "optimizer_updates": agent.updates})
                handle.flush()
                metadata = {"episode": episode, "env_config": env_config, "training_seed": seed}
                if episode % validation_every == 0 or episode == episodes:
                    validation = summarize(rollout(lambda obs: agent.choose_action(obs, explore=False),
                                                   validation_episodes, 100000, env_config))
                    validations.append({"episode": episode, **validation})
                    if validation["mean_score"] > best_validation:
                        best_validation = validation["mean_score"]
                        agent.save(models / "best_model.pt", {**metadata, "validation": validation})
                    (results / "validation.json").write_text(json.dumps(validations, indent=2) + "\n", encoding="utf-8")
                    agent.save(models / "latest_model.pt", metadata)
                    print(f"episode={episode} reward={total_reward:.2f} score={info['score']} "
                          f"epsilon={agent.epsilon:.3f} loss={mean(losses) if losses else 0:.4f} "
                          f"moving_score={moving:.2f} validation_score={validation['mean_score']:.2f}", flush=True)
    finally:
        env.close()
        agent.save(models / "latest_model.pt", {"episode": episode, "env_config": env_config, "training_seed": seed})
        (results / "training_status.json").write_text(json.dumps({"completed_episodes": len(scores),
            "requested_episodes": episodes, "environment_steps": agent.environment_steps,
            "optimizer_updates": agent.updates, "elapsed_seconds": time.perf_counter() - started}, indent=2) + "\n", encoding="utf-8")
        if scores:
            plot_training(results / "training.csv", results)
    return agent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episodes", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output-root", type=Path, default=ROOT)
    parser.add_argument("--validation-every", type=int, default=100)
    parser.add_argument("--validation-episodes", type=int, default=20)
    args = parser.parse_args()
    train(args.episodes, args.seed, args.output_root, args.validation_every, args.validation_episodes)


if __name__ == "__main__":
    main()
