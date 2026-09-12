"""Uniform experience replay in a bounded NumPy ring buffer."""
import numpy as np


class ReplayBuffer:
    def __init__(self, capacity=50000, observation_size=10, seed=42):
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self.capacity = capacity
        self.rng = np.random.default_rng(seed)
        self.position = self.size = 0
        self.states = np.zeros((capacity, observation_size), dtype=np.float32)
        self.next_states = np.zeros_like(self.states)
        self.actions = np.zeros(capacity, dtype=np.int64)
        self.rewards = np.zeros(capacity, dtype=np.float32)
        self.terminated = np.zeros(capacity, dtype=np.bool_)
        self.truncated = np.zeros(capacity, dtype=np.bool_)

    def __len__(self):
        return self.size

    def add(self, state, action, reward, next_state, terminated, truncated):
        i = self.position
        # Assignment copies observations: subsequent caller mutations cannot alter replay.
        self.states[i], self.next_states[i] = state, next_state
        self.actions[i], self.rewards[i] = action, reward
        self.terminated[i], self.truncated[i] = terminated, truncated
        self.position = (i + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def sample(self, batch_size):
        if not 1 <= batch_size <= self.size:
            raise ValueError("batch_size must be between 1 and the number of stored transitions")
        indices = self.rng.choice(self.size, size=batch_size, replace=False)
        return {name: getattr(self, name)[indices] for name in
                ("states", "actions", "rewards", "next_states", "terminated", "truncated")}


    def state_dict(self):
        """Tensors/primitives keep checkpoints compatible with weights_only=True."""
        import json
        import torch
        return {"capacity": self.capacity, "position": self.position, "size": self.size,
                "rng": json.dumps(self.rng.bit_generator.state),
                "arrays": {name: torch.from_numpy(getattr(self, name)[:self.size].copy())
                           for name in ("states", "actions", "rewards", "next_states", "terminated", "truncated")}}

    def load_state_dict(self, state):
        import json
        if state["capacity"] != self.capacity or not 0 <= state["size"] <= self.capacity:
            raise ValueError("Incompatible replay checkpoint")
        if not 0 <= state["position"] < self.capacity:
            raise ValueError("Invalid replay position")
        self.size, self.position = state["size"], state["position"]
        for name, tensor in state["arrays"].items():
            getattr(self, name)[:self.size] = tensor.numpy()
        self.rng.bit_generator.state = json.loads(state["rng"])
