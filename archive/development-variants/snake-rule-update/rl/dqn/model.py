"""Q(s, a) approximation: 10 features -> 128 -> 128 -> 3 action values."""
from torch import nn


class QNetwork(nn.Module):
    def __init__(self, observation_size=10, action_size=3, hidden_size=128):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(observation_size, hidden_size), nn.ReLU(),
            nn.Linear(hidden_size, hidden_size), nn.ReLU(),
            nn.Linear(hidden_size, action_size),
        )

    def forward(self, observations):
        # Q values are unrestricted real numbers, not action probabilities.
        return self.layers(observations)
