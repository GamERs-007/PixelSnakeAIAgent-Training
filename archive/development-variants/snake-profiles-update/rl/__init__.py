"""Python RL environment; the existing JavaScript demo remains independent."""

from gymnasium.envs.registration import register, registry

from .snake_env import SnakeEnv

if "PixelSnake-v0" not in registry:
    register(id="PixelSnake-v0", entry_point="rl.snake_env:SnakeEnv")

__all__ = ["SnakeEnv"]
