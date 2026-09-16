"""Numeric Gymnasium Snake environment matching the browser's grid rules.

Actions are relative: 0 = straight, 1 = left, 2 = right. No browser or neural
network is needed. Food randomness uses Gymnasium's per-environment NumPy RNG.
"""

from __future__ import annotations

from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from gymnasium.error import ResetNeeded


class SnakeEnv(gym.Env[np.ndarray, int]):
    """Snake with a compact, partially observed vector and sparse rewards."""

    metadata = {"render_modes": ["ansi"], "render_fps": 10}
    # Clockwise direction order, in screen coordinates (positive y is down).
    DIRECTIONS = ((0, -1), (1, 0), (0, 1), (-1, 0))
    ACTION_TURNS = (0, -1, 1)
    FOOD_REWARD = 10.0
    DEATH_REWARD = -10.0
    STEP_REWARD = -0.01
    OBSERVATION_NAMES = (
        "danger_straight", "danger_left", "danger_right",
        "direction_up", "direction_right", "direction_down", "direction_left",
        "food_dx", "food_dy", "no_food_fraction",
    )

    def __init__(
        self,
        board_size: int = 20,
        max_steps_without_food: int | None = None,
        render_mode: str | None = None,
        reward_profile: str = "classic",
        shaping_gamma: float = 0.99,
    ) -> None:
        super().__init__()
        if isinstance(board_size, bool) or not isinstance(board_size, int) or board_size < 6:
            raise ValueError("board_size must be an integer of at least 6.")
        if max_steps_without_food is None:
            max_steps_without_food = board_size * board_size
        if (isinstance(max_steps_without_food, bool)
                or not isinstance(max_steps_without_food, int)
                or max_steps_without_food < 1):
            raise ValueError("max_steps_without_food must be a positive integer.")
        if render_mode not in (None, *self.metadata["render_modes"]):
            raise ValueError("render_mode must be None or 'ansi'.")
        if reward_profile not in ("classic", "strategy_v1"):
            raise ValueError("reward_profile must be classic or strategy_v1")
        if not 0 <= shaping_gamma <= 1:
            raise ValueError("shaping_gamma must be in [0,1]")
        self.reward_profile, self.shaping_gamma = reward_profile, shaping_gamma
        from rl.strategy_reward import StrategyReward
        self.reward_strategy = StrategyReward(shaping_gamma) if reward_profile == "strategy_v1" else None
        self.reward_components = {}
        self.board_size = board_size
        self.max_steps_without_food = max_steps_without_food
        self.render_mode = render_mode
        self.action_space = spaces.Discrete(3)
        self.observation_space = spaces.Box(
            low=np.array([0, 0, 0, 0, 0, 0, 0, -1, -1, 0], dtype=np.float32),
            high=np.ones(10, dtype=np.float32),
            dtype=np.float32,
        )
        self.snake: list[tuple[int, int]] = []
        self.food: tuple[int, int] | None = None
        self.direction = 1
        self.score = self.steps = self.steps_survived = self.food_collected = 0
        self.steps_since_food = 0
        self.cause_of_death: str | None = None
        self.won = self._terminated = self._truncated = False
        self._has_reset = False

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        if options:
            raise ValueError("No reset options are supported; configure limits in __init__.")
        # Default board matches JS: head (9, 10), length 3, facing right.
        x, y = self.board_size // 2 - 1, self.board_size // 2
        self.snake = [(x, y), (x - 1, y), (x - 2, y)]
        self.direction = 1
        self.score = self.steps = self.steps_survived = self.food_collected = 0
        self.steps_since_food = 0
        self.cause_of_death = None
        self.won = self._terminated = self._truncated = False
        self.food = self._spawn_food()
        self._has_reset = True
        self.reward_components = {}
        if self.reward_strategy: self.reward_strategy.reset(self)
        return self._observation(), self._info()

    def _spawn_food(self) -> tuple[int, int] | None:
        occupied = set(self.snake)
        empty = [(x, y) for y in range(self.board_size) for x in range(self.board_size)
                 if (x, y) not in occupied]
        return empty[int(self.np_random.integers(len(empty)))] if empty else None

    def _next_head(self, action: int) -> tuple[int, int]:
        direction = (self.direction + self.ACTION_TURNS[action]) % 4
        dx, dy = self.DIRECTIONS[direction]
        return self.snake[0][0] + dx, self.snake[0][1] + dy

    def _collision(self, head: tuple[int, int]) -> str | None:
        x, y = head
        if not (0 <= x < self.board_size and 0 <= y < self.board_size):
            return "wall"
        # The tail vacates its cell unless the step eats food.
        body = self.snake if head == self.food else self.snake[:-1]
        return "self" if head in body else None

    def _observation(self) -> np.ndarray:
        dangers = [float(self._collision(self._next_head(action)) is not None) for action in range(3)]
        direction = [float(self.direction == index) for index in range(4)]
        dx = dy = 0.0
        if self.food is not None:
            dx = (self.food[0] - self.snake[0][0]) / (self.board_size - 1)
            dy = (self.food[1] - self.snake[0][1]) / (self.board_size - 1)
        return np.array([
            *dangers, *direction, dx, dy,
            min(1.0, self.steps_since_food / self.max_steps_without_food),
        ], dtype=np.float32)

    def _info(self) -> dict[str, Any]:
        reason = self.cause_of_death
        if self.won:
            reason = "board_full"
        elif self._truncated:
            reason = "no_food_limit"
        return {
            "score": self.score, "steps": self.steps,
            "steps_survived": self.steps_survived, "food_collected": self.food_collected,
            "snake_length": len(self.snake), "steps_since_food": self.steps_since_food,
            "cause_of_death": self.cause_of_death, "end_reason": reason, "won": self.won,
            **({"reward_components":dict(self.reward_components)} if self.reward_strategy else {}),
        }

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        if not self._has_reset or self._terminated or self._truncated:
            raise ResetNeeded("Call reset() before stepping a new or completed episode.")
        if isinstance(action, (bool, np.bool_)) or not self.action_space.contains(action):
            raise ValueError("Action must be 0 (straight), 1 (left), or 2 (right).")
        action = int(action)
        if self.reward_strategy:
            from rl.strategy_reward import potential
            before_potential = potential(self.snake, self.food, self.board_size)
        previous_food = self.food_collected
        head = self._next_head(action)
        self.direction = (self.direction + self.ACTION_TURNS[action]) % 4
        self.steps += 1
        self.steps_since_food += 1
        self.cause_of_death = self._collision(head)
        if self.cause_of_death is not None:
            self._terminated = True
            reward = self.DEATH_REWARD
        else:
            self.snake.insert(0, head)
            self.steps_survived += 1
            if head == self.food:
                self.score += 10
                self.food_collected += 1
                self.steps_since_food = 0
                self.food = self._spawn_food()
                self.won = self.food is None
                self._terminated = self.won
                reward = self.FOOD_REWARD
            else:
                self.snake.pop()
                reward = self.STEP_REWARD
            if not self._terminated and self.steps_since_food >= self.max_steps_without_food:
                self._truncated = True
        if self.reward_strategy:
            reward, self.reward_components = self.reward_strategy.reward(
                self, action, reward, before_potential, self.food_collected > previous_food)
        return self._observation(), reward, self._terminated, self._truncated, self._info()

    def get_state(self) -> dict[str, Any]:
        """Detached JS-shaped diagnostic snapshot; not the learning observation.

        Coordinates and common fields match js/game.js. Python RNG sequences do
        not match the JavaScript generator for the same numeric seed.
        """
        if not self._has_reset:
            raise ResetNeeded("Call reset() before requesting a state.")
        dx, dy = self.DIRECTIONS[self.direction]
        return {
            "size": self.board_size,
            "snake": [{"x": x, "y": y} for x, y in self.snake],
            "direction": {"x": dx, "y": dy},
            "food": None if self.food is None else {"x": self.food[0], "y": self.food[1]},
            "score": self.score, "alive": not self._terminated, "won": self.won,
            "steps": self.steps, "stepsSurvived": self.steps_survived,
            "foodCollected": self.food_collected, "causeOfDeath": self.cause_of_death,
            "truncated": self._truncated,
        }

    def render(self) -> str | None:
        if self.render_mode is None:
            return None
        if not self._has_reset:
            raise ResetNeeded("Call reset() before rendering.")
        grid = [["." for _ in range(self.board_size)] for _ in range(self.board_size)]
        if self.food is not None:
            grid[self.food[1]][self.food[0]] = "*"
        for x, y in self.snake[1:]:
            grid[y][x] = "o"
        x, y = self.snake[0]
        grid[y][x] = "H"
        border = "+" + "-" * self.board_size + "+"
        rows = [border, *("|" + "".join(row) + "|" for row in grid), border]
        return f"Score: {self.score} | Steps: {self.steps} | {self._info()['end_reason'] or 'playing'}\n" + "\n".join(rows)

    def close(self) -> None:
        # ANSI rendering owns no windows, files, sockets, or other resources.
        pass
