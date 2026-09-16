"""Vanilla DQN: epsilon-greedy actions, replay updates, Bellman targets and checkpoints."""
from dataclasses import asdict, dataclass
from pathlib import Path
import random

import numpy as np
import torch
from torch import nn

from .model import QNetwork
from .replay_buffer import ReplayBuffer


@dataclass
class DQNConfig:
    observation_size: int = 10
    action_size: int = 3
    hidden_size: int = 128
    learning_rate: float = 0.0003
    gamma: float = 0.99
    batch_size: int = 64
    replay_capacity: int = 50000
    learning_starts: int = 1000
    train_every: int = 4
    target_update_every: int = 500  # optimizer updates, not environment ticks
    epsilon_start: float = 1.0
    epsilon_end: float = 0.05
    epsilon_decay_steps: int = 100000
    seed: int = 42

    def __post_init__(self):
        for name in ("observation_size", "action_size", "hidden_size", "batch_size", "replay_capacity",
                     "learning_starts", "train_every", "target_update_every", "epsilon_decay_steps"):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} must be positive")
        if self.batch_size > self.replay_capacity:
            raise ValueError("batch_size exceeds replay_capacity")
        if not 0 <= self.gamma <= 1 or self.learning_rate <= 0:
            raise ValueError("invalid discount or learning rate")
        if not 0 <= self.epsilon_end <= self.epsilon_start <= 1:
            raise ValueError("epsilon must satisfy 0 <= end <= start <= 1")


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    # One CPU thread is fast for this small network and repeatable on this setup.
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)


def bellman_targets(rewards, terminated, next_q_values, gamma):
    # Truncation is not death: bootstrap from the final pre-reset observation.
    # y = r + gamma * (1 - terminated) * max_a Q_target(s_next, a)
    return rewards + gamma * (~terminated).float() * next_q_values.max(dim=1).values


class DQNAgent:
    def __init__(self, config=None):
        self.config = config or DQNConfig()
        c = self.config
        seed_everything(c.seed)
        self.rng = random.Random(c.seed)
        self.online = QNetwork(c.observation_size, c.action_size, c.hidden_size)
        self.target = QNetwork(c.observation_size, c.action_size, c.hidden_size)
        self.target.load_state_dict(self.online.state_dict())
        self.target.requires_grad_(False)
        self.target.eval()
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=c.learning_rate)
        self.loss_function = nn.SmoothL1Loss()  # Huber loss is less sensitive to large TD errors.
        self.replay = ReplayBuffer(c.replay_capacity, c.observation_size, c.seed + 1)
        self.environment_steps = self.updates = 0

    @property
    def epsilon(self):
        c = self.config
        fraction = min(1.0, self.environment_steps / c.epsilon_decay_steps)
        return c.epsilon_start + fraction * (c.epsilon_end - c.epsilon_start)

    def choose_action(self, observation, explore=True):
        if explore and self.rng.random() < self.epsilon:
            return self.rng.randrange(self.config.action_size)
        with torch.no_grad():
            values = self.online(torch.as_tensor(observation, dtype=torch.float32).unsqueeze(0))
        return int(values.argmax(dim=1).item())

    def observe(self, state, action, reward, next_state, terminated, truncated):
        self.replay.add(state, action, reward, next_state, terminated, truncated)
        self.environment_steps += 1
        c = self.config
        if (self.environment_steps < c.learning_starts or len(self.replay) < c.batch_size
                or self.environment_steps % c.train_every):
            return None
        return self.train_batch()

    def train_batch(self):
        c = self.config
        batch = {name: torch.from_numpy(value) for name, value in self.replay.sample(c.batch_size).items()}
        # Only the Q value for the action actually taken contributes to this loss.
        predictions = self.online(batch["states"]).gather(1, batch["actions"].unsqueeze(1)).squeeze(1)
        with torch.no_grad():
            targets = bellman_targets(batch["rewards"], batch["terminated"],
                                      self.target(batch["next_states"]), c.gamma)
        loss = self.loss_function(predictions, targets)
        if not torch.isfinite(loss):
            raise FloatingPointError("non-finite DQN loss")
        self.optimizer.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.online.parameters(), max_norm=10.0)
        self.optimizer.step()
        self.updates += 1
        if self.updates % c.target_update_every == 0:
            self.target.load_state_dict(self.online.state_dict())
        return float(loss.item())

    def save(self, path, metadata=None, include_training_state=False):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"format_version": 1, "config": asdict(self.config),
                   "online": self.online.state_dict(), "target": self.target.state_dict(),
                   "optimizer": self.optimizer.state_dict(), "environment_steps": self.environment_steps,
                   "updates": self.updates, "metadata": metadata or {}}
        if include_training_state:
            payload["format_version"] = 2
            payload["training_state"] = {
                "replay": self.replay.state_dict(), "agent_rng": self.rng.getstate(),
                "torch_rng": torch.get_rng_state(), "python_rng": random.getstate(),
                "numpy_rng": {"name": np.random.get_state()[0],
                              "keys": torch.from_numpy(np.random.get_state()[1].astype(np.int64)),
                              "position": np.random.get_state()[2],
                              "has_gauss": np.random.get_state()[3], "cached_gauss": np.random.get_state()[4]}}
        temporary = path.with_suffix(path.suffix + ".tmp")
        torch.save(payload, temporary)
        temporary.replace(path)

    @classmethod
    def load(cls, path):
        data = torch.load(path, map_location="cpu", weights_only=True)
        if data.get("format_version") not in (1, 2):
            raise ValueError("Unsupported checkpoint format")
        agent = cls(DQNConfig(**data["config"]))
        agent.online.load_state_dict(data["online"])
        agent.target.load_state_dict(data["target"])
        agent.optimizer.load_state_dict(data["optimizer"])
        agent.environment_steps, agent.updates = data["environment_steps"], data["updates"]
        if "training_state" in data:
            state = data["training_state"]
            agent.replay.load_state_dict(state["replay"])
            agent.rng.setstate(state["agent_rng"])
            torch.set_rng_state(state["torch_rng"])
            random.setstate(state["python_rng"])
            rng = state["numpy_rng"]
            np.random.set_state((rng["name"], rng["keys"].numpy().astype(np.uint32),
                                 rng["position"], rng["has_gauss"], rng["cached_gauss"]))
        agent.exact_resume_available = "training_state" in data
        return agent, data["metadata"]
