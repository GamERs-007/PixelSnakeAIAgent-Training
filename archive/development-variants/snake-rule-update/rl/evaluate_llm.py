"""Standalone, time-budgeted local-LLM benchmark. Never trains or modifies DQN."""
import argparse
import csv
import hashlib
import json
import time
from pathlib import Path
from statistics import mean, median

import torch

from rl.snake_env import SnakeEnv
from rl.llm_agent import LLMAgent, SYSTEM_PROMPT
from rl.dqn.agent import DQNAgent
from rl.dqn.evaluate import RandomAgent, HeuristicAgent

ROOT = Path(__file__).resolve().parents[1]


def rollout(name, policy, episodes, seed, env_config, max_steps, output_dir, deadline=None):
    records, decisions = [], []
    env = SnakeEnv(**env_config)
    llm = isinstance(policy, LLMAgent)
    try:
        with (output_dir / (name + "_decisions.jsonl")).open("w", encoding="utf-8") as log:
            for episode in range(episodes):
                if deadline is not None and time.perf_counter() >= deadline:
                    break
                obs, info = env.reset(seed=seed + episode)
                reward_sum, samples = 0., []
                terminated = truncated = budget_cut = capped = False
                for tick in range(max_steps):
                    remaining = None if deadline is None else deadline - time.perf_counter()
                    if remaining is not None and remaining <= 0:
                        budget_cut = True
                        break
                    started = time.perf_counter()
                    action = policy.choose_action(obs, timeout=remaining) if llm else policy(obs)
                    latency = (time.perf_counter() - started) * 1000
                    sample = dict(policy.last_decision) if llm else {
                        "action": action, "invalid_response": False, "request_error": False,
                        "fallback": False, "latency_ms": latency, "dangerous_action": bool(obs[action])}
                    sample.update(episode=episode + 1, seed=seed + episode, step=tick + 1)
                    # Capture timed-out/invalid calls even if the budget expired during inference.
                    executed = deadline is None or time.perf_counter() < deadline
                    sample["executed"] = executed
                    log.write(json.dumps(sample) + "\n")
                    if llm:
                        log.flush()
                    decisions.append(sample); samples.append(sample)
                    if not executed:
                        budget_cut = True
                        break
                    obs, reward, terminated, truncated, info = env.step(action)
                    reward_sum += reward
                    capped = tick + 1 == max_steps and not (terminated or truncated)
                    if llm and (tick + 1) % 20 == 0:
                        print(f"Qwen episode {episode + 1}: {tick + 1} moves, score {info['score']}", flush=True)
                    if terminated or truncated or capped:
                        break
                row = {"policy": name, "episode": episode + 1, "seed": seed + episode,
                       "episode_reward": reward_sum, **info, "terminated": terminated,
                       "truncated": truncated or capped, "budget_cut": budget_cut,
                       "complete": not budget_cut,
                       "end_reason": "wall_time_budget" if budget_cut else "evaluation_step_limit" if capped else info["end_reason"],
                       "decisions": len(samples),
                       "mean_latency_ms": mean(s["latency_ms"] for s in samples) if samples else None}
                records.append(row)
                with (output_dir / (name + "_episodes.json")).open("w", encoding="utf-8") as handle:
                    json.dump(records, handle, indent=2)
                print(f"{name}: episode {episode + 1}, score {info['score']}, steps {info['steps_survived']}, {row['end_reason']}", flush=True)
                if budget_cut:
                    break
    finally:
        env.close()
    return records, decisions


def summarize(records, decisions):
    complete = [row for row in records if row["complete"]]
    response_count = sum(not s["request_error"] for s in decisions)
    invalid = sum(s["invalid_response"] for s in decisions)
    return {"completed_episodes": len(complete), "partial_episodes": len(records) - len(complete),
            "mean_score": mean(r["score"] for r in complete) if complete else None,
            "median_score": median(r["score"] for r in complete) if complete else None,
            "maximum_score": max((r["score"] for r in complete), default=None),
            "mean_survival_steps": mean(r["steps_survived"] for r in complete) if complete else None,
            "decisions": len(decisions),
            "mean_latency_ms": mean(s["latency_ms"] for s in decisions) if decisions else None,
            "invalid_action_rate": invalid / response_count if response_count else None,
            "request_error_rate": sum(s["request_error"] for s in decisions) / len(decisions) if decisions else None,
            "fallback_rate": sum(s["fallback"] for s in decisions) / len(decisions) if decisions else None,
            "dangerous_action_rate": sum(s["dangerous_action"] for s in decisions) / len(decisions) if decisions else None}


def table(policies):
    rows = ["| Agent | Completed episodes | Mean score | Median | Max | Mean survival steps | Decision ms | Invalid response % |",
            "|---|---:|---:|---:|---:|---:|---:|---:|"]
    def fmt(value):
        return "n/a" if value is None else f"{value:.3f}"
    for name, stats in policies.items():
        invalid = stats["invalid_action_rate"]
        values = [stats[k] for k in ("mean_score", "median_score", "maximum_score", "mean_survival_steps", "mean_latency_ms")]
        rows.append(f"| {name} | {stats['completed_episodes']} | " + " | ".join(map(fmt, values)) + f" | {fmt(None if invalid is None else invalid * 100)} |")
    return "\n".join(rows)


def evaluate(args):
    if min(args.episodes, args.max_steps, args.budget_seconds, args.timeout) <= 0:
        raise ValueError("Episode count, step limit, budget and timeout must be positive")
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError("Choose an empty output directory to preserve earlier experiment results")
    torch.set_num_threads(1)
    dqn, metadata = DQNAgent.load(args.checkpoint)
    dqn.online.eval()
    llm = LLMAgent(model=args.model, base_url=args.base_url, seed=args.seed, timeout=args.timeout)
    model_info = llm.verify()
    config = {"requested_episodes": args.episodes, "seed": args.seed,
              "env_config": metadata.get("env_config", {}), "max_episode_steps": args.max_steps,
              "llm_budget_seconds": args.budget_seconds, "request_timeout_seconds": args.timeout,
              "ollama": model_info, "base_url": args.base_url, "prompt": SYSTEM_PROMPT,
              "model_options": {"temperature": 0, "seed": args.seed, "num_ctx": 2048, "num_predict": 32, "think": False},
              "checkpoint": str(args.checkpoint.resolve()), "checkpoint_episode": metadata.get("episode"),
              "checkpoint_sha256": hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              "dqn_exploration": 0, "state_cache": False}
    (out / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    started = time.perf_counter()
    all_records, all_decisions = {}, {}
    records, decisions = rollout("Qwen", llm, args.episodes, args.seed, config["env_config"],
                                 args.max_steps, out, started + args.budget_seconds)
    all_records["Qwen"], all_decisions["Qwen"] = records, decisions
    policies = {"Random": RandomAgent(args.seed + 1000000).choose_action,
                "Heuristic": HeuristicAgent().choose_action,
                "DQN": lambda obs: dqn.choose_action(obs, explore=False)}
    for name, policy in policies.items():
        all_records[name], all_decisions[name] = rollout(name, policy, args.episodes, args.seed,
                                                       config["env_config"], args.max_steps, out)
    report = {"config": config, "elapsed_seconds": time.perf_counter() - started,
              "policies": {name: summarize(all_records[name], all_decisions[name])
                           for name in ("Random", "Heuristic", "DQN", "Qwen")}}
    matched_seeds = {r["seed"] for r in records if r["complete"]}
    report["matched_policies"] = {
        name: summarize([r for r in all_records[name] if r["seed"] in matched_seeds],
                        [s for s in all_decisions[name] if s["seed"] in matched_seeds])
        for name in report["policies"]}
    (out / "comparison.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    rows = [row for records in all_records.values() for row in records]
    with (out / "episodes.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    note = ("Scores use completed episodes only; budget-interrupted episodes remain in episodes.csv. "
            "Latency includes all attempted decisions, failed calls and any cold loading. "
            "Invalid rate is malformed/incomplete action responses divided by received responses; "
            "transport/API failures and fallback rates are separate in comparison.json. "
            "Different episode counts are not a matched performance comparison.\n\n")
    markdown = "# Local Ollama Snake experiment\n\n" + note + table(report["policies"])
    markdown += "\n\n## Shared completed episode seeds\n\n" + table(report["matched_policies"])
    markdown += ("\n\nA compact state does not describe the full body or a route to safety. "
                 "An LLM can follow language rules but needs a request for every move; "
                 "DQN and heuristic policies make much cheaper local decisions. "
                 "Schema-valid output does not guarantee a safe move or escape from loops. "
                 "The LLM may be more useful for explaining episodes or selecting high-level goals. "
                 "Small completed samples and one seed sequence cannot establish a reliable ranking.\n")
    (out / "comparison.md").write_text(markdown, encoding="utf-8")
    print(markdown, flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episodes", type=int, default=50)
    parser.add_argument("--seed", type=int, default=300000)
    parser.add_argument("--budget-seconds", type=float, default=600)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--max-steps", type=int, default=10000)
    parser.add_argument("--model", default="qwen3.8:27b-q4_K_M")
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "models/best_model.pt")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "results/llm_experiment")
    evaluate(parser.parse_args())


if __name__ == "__main__":
    main()
