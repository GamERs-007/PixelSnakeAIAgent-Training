"""Resumable DQN training job for the local web UI; runs in its own process."""
import argparse
import csv
import json
from pathlib import Path
from statistics import mean
import time
from datetime import datetime
import uuid

from rl.snake_env import SnakeEnv
from .agent import DQNAgent, DQNConfig
from rl.model_profiles import model_profile, normalize_profile, training_reward, inference_rules

ROOT = Path(__file__).resolve().parents[2]


def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    # Windows readers may momentarily hold the destination without delete sharing.
    # A UI poll must not terminate a training run at a completed episode boundary.
    for attempt in range(50):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 49: raise
            time.sleep(.01)


def train_session(episodes, job_dir, models_dir, checkpoint=None, seed=42, save_every=100,
                  config=None, reward_profile="inherit"):
    if type(episodes) is not int or not 1 <= episodes <= 10000 or not 1 <= save_every <= 10000:
        raise ValueError("Episodes and save interval must be integers in 1..10000")
    job_dir, models_dir = Path(job_dir), Path(models_dir)
    job_dir.mkdir(parents=True, exist_ok=True); models_dir.mkdir(parents=True, exist_ok=True)
    if (job_dir / "training.csv").exists():
        raise FileExistsError("Choose a new job directory")
    metadata = {}
    if checkpoint:
        agent, metadata = DQNAgent.load(checkpoint)
        seed = metadata.get("training_seed", agent.config.seed)
    else:
        agent = DQNAgent(config or DQNConfig(seed=seed))
    start_episode = int(metadata.get("episode", 0))
    env_config = metadata.get("env_config", {"board_size": 20, "max_steps_without_food": 400})
    env_config = dict(env_config)
    old_profile = model_profile(metadata, Path(checkpoint).parent.name if checkpoint else '')
    if reward_profile != 'inherit':
        reward_profile = normalize_profile(reward_profile)
    selected_profile = old_profile if reward_profile == "inherit" else reward_profile
    reward_changed = training_reward(selected_profile) != env_config.get('reward_profile', 'classic')
    env_config.update(reward_profile=training_reward(selected_profile), shaping_gamma=agent.config.gamma)
    if reward_changed:
        # Old transitions contain old rewards: never silently mix the two objectives.
        from .replay_buffer import ReplayBuffer
        agent.replay = ReplayBuffer(agent.config.replay_capacity,agent.config.observation_size,seed+1)
    env = SnakeEnv(**env_config)
    completed, saved, scores = start_episode, None, list(metadata.get("recent_scores", []))
    status = {"state": "running", "start_episode": start_episode, "episode": completed,
              "target_episode": start_episode + episodes, "requested_episodes": episodes,
              "source_model": str(checkpoint) if checkpoint else None,
              "exact_resume": bool(checkpoint and not reward_changed and getattr(agent, "exact_resume_available", False)),
              "reward_profile": selected_profile, "training_seed": seed, "replay_reset_for_reward_change":reward_changed,
              "saved_model": None, "job": job_dir.name}
    write_json(job_dir / "status.json", status)
    started = time.perf_counter()
    at_boundary = True

    def save():
        nonlocal saved
        saved_at = datetime.now().astimezone()
        filename = f"{saved_at:%Y-%m-%d_%H-%M-%S-%f}_ep{completed}.pt"
        destination = models_dir / selected_profile / filename
        if destination.exists():
            destination = destination.with_name(f"{destination.stem}_{uuid.uuid4().hex[:8]}.pt")
        agent.save(destination, {"episode": completed, "env_config": env_config,
                                "model_profile": selected_profile, "saved_at": saved_at.isoformat(),
                                "inference_rules": inference_rules(selected_profile),
                                "training_seed": seed, "recent_scores": scores[-100:],
                                "parent_model": str(checkpoint) if checkpoint else None,
                                "job": job_dir.name}, include_training_state=True)
        saved = completed
        status["saved_model"] = destination.relative_to(models_dir).as_posix()

    fields = ["episode", "episode_reward", "score", "epsilon", "training_loss", "moving_average_score", "steps", "turn_rate", "repeat_penalty", "potential_reward"]
    try:
        with (job_dir / "training.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
            for episode in range(start_episode + 1, start_episode + episodes + 1):
                if (job_dir / "stop").exists():
                    break
                at_boundary = False
                observation, _ = env.reset(seed=seed + episode - 1)
                total_reward, losses = 0., []
                turns, repeat_penalty, potential_reward = 0, 0., 0.
                for step in range(10000):
                    action = agent.choose_action(observation)
                    turns += action != 0
                    next_obs, reward, terminated, truncated, info = env.step(action)
                    parts=info.get("reward_components", {})
                    repeat_penalty += parts.get("repeat",0.)
                    potential_reward += parts.get("potential",0.)
                    capped = step == 9999 and not (terminated or truncated)
                    loss = agent.observe(observation, action, reward, next_obs, terminated, truncated or capped)
                    if loss is not None: losses.append(loss)
                    total_reward += reward; observation = next_obs
                    if terminated or truncated or capped: break
                completed = episode
                at_boundary = True
                scores.append(info["score"])
                row = {"episode": episode, "episode_reward": total_reward, "score": info["score"],
                       "epsilon": agent.epsilon, "training_loss": mean(losses) if losses else None,
                       "moving_average_score": mean(scores[-100:]), "steps": info["steps"],
                       "turn_rate": turns/info["steps"], "repeat_penalty":repeat_penalty, "potential_reward":potential_reward}
                writer.writerow(row); handle.flush()
                if (episode - start_episode) % save_every == 0 or episode == start_episode + episodes:
                    save()
                status.update(row, elapsed_seconds=time.perf_counter() - started,
                              environment_steps=agent.environment_steps, optimizer_updates=agent.updates)
                write_json(job_dir / "status.json", status)
        status["state"] = "completed" if completed == start_episode + episodes else "stopped"
    except Exception as error:
        status.update(state="failed", error=str(error))
        raise
    finally:
        env.close()
        try:
            if at_boundary and completed > start_episode and saved != completed:
                save()
        finally:
            status.update(episode=completed, elapsed_seconds=time.perf_counter() - started)
            write_json(job_dir / "status.json", status)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episodes", type=int, required=True)
    parser.add_argument("--job-dir", type=Path, required=True)
    parser.add_argument("--models-dir", type=Path, default=ROOT / "models")
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--reward-profile", choices=["inherit","classic","strategy","ultimate","strategy_v1"], default="inherit")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--save-every", type=int, default=100)
    args = parser.parse_args()
    train_session(args.episodes, args.job_dir, args.models_dir, args.checkpoint, args.seed, args.save_every, reward_profile=args.reward_profile)


if __name__ == "__main__":
    main()
