# PixelSnake

A browser-based Snake demo plus a Python Gymnasium environment for reinforcement
learning experiments. Human single-player and two-player modes remain available
alongside Random AI and Heuristic AI. The Python component adds relative actions,
numeric observations, rewards, and an explicit PyTorch DQN with replay, target
network, training, evaluation, and saved experiment results. A separate local Ollama
experiment compares Qwen with the existing Python policies. The browser remains
the human/AI demo and now connects to a loopback Python service for DQN/Qwen control and resumable DQN training.

## Verified technical summary for internship resumes

This section records the source-code and artifact inspection, rather than proposed
features. The canonical project directory is `D:/isaac-lab/PixelSnake`. Earlier development
copies are preserved under `archive/development-variants/`; run and maintain the
application from this root, which contains the complete `results/` and `models/`. Source paths
below are relative to the complete project root. Benchmark aggregates were checked
against episode CSVs, and surviving checkpoint hashes were compared with experiment
records. Existing usage instructions and historical experiment descriptions follow
this summary.

### 1. Architecture and important files

| Component | Implemented responsibility and source |
| --- | --- |
| Browser engine | `js/game.js`: `SnakeGame`, `step()`, collision queries, food spawning, score, and terminal state; no DOM or rendering dependency. |
| Browser policies | `js/agents.js`: `HumanAgent`, `RandomAgent`, `HeuristicAgent`, each using `chooseAction(state)`. |
| Episode orchestration | `js/episode.js`: `EpisodeRunner` connects agents to `game.step(action)`; `runEpisodes()` provides seeded batches. |
| Presentation and input | `js/renderer.js`: `createSnakeRenderer`; `js/input.js`: `createSnakeInput`; `js/main.js`: scheduling, controller selection, statistics, persistence, and training UI. |
| Browser inference | `js/dqn-agent.js`: `DenseQNetwork`, `BrowserDQNAgent`; `js/local-ai.js`: asynchronous `RemoteAgent`. |
| Optional assistance | `js/safety.js`: `SafetyGuard`, `safeFoodPath()`, `AssistedAgent`, and dense-board sweep rules. |
| Gymnasium environment | `rl/snake_env.py`: `SnakeEnv`; `rl/__init__.py` registers `PixelSnake-v0`. |
| DQN | `rl/dqn/model.py`, `replay_buffer.py`, `agent.py`, `train.py`, `train_session.py`, and `evaluate.py`; `evaluation.py` is an entry-point alias. |
| LLM evaluation | `rl/llm_agent.py`: `LLMAgent`; `rl/evaluate_llm.py`: timed four-policy benchmark. |
| Local backend | `rl/web_server.py`: `LocalApp`, `Handler`, `ThreadingHTTPServer`; loopback service at `127.0.0.1:8765`, model exports, inference, and training subprocesses. |
| Entry points | `index.html` and `PixelSnake.html`; `start-local.ps1` starts the Python service. |

The frontend uses plain HTML/CSS/JavaScript, scoped browser globals, and CommonJS
exports for Node execution, without a frontend bundler. Sources: `index.html`
script loading and the exports in `js/game.js`, `js/agents.js`, `js/episode.js`.

### 2. Gymnasium observation space and exact features

`SnakeEnv.__init__()` declares `Box(shape=(10,), dtype=np.float32)` with:

```text
low  = [0,0,0,0,0,0,0,-1,-1,0]
high = [1,1,1,1,1,1,1, 1, 1,1]
```

| Index | Feature | Exact meaning |
| --- | --- | --- |
| 0 | `danger_straight` | Next straight move would collide: 1; otherwise 0. |
| 1 | `danger_left` | Next relative left move would collide. |
| 2 | `danger_right` | Next relative right move would collide. |
| 3 | `direction_up` | One-hot current heading. |
| 4 | `direction_right` | One-hot current heading. |
| 5 | `direction_down` | One-hot current heading. |
| 6 | `direction_left` | One-hot current heading. |
| 7 | `food_dx` | `(food_x - head_x) / (board_size - 1)`. |
| 8 | `food_dy` | `(food_y - head_y) / (board_size - 1)`. |
| 9 | `no_food_fraction` | `min(1, steps_since_food / max_steps_without_food)`. |

Food offsets are zero when food is absent. Coordinates increase rightward and
downward. Collision queries allow entering the departing tail when not eating.
The learning observation omits full body geometry, pixels, score, and snake length;
`get_state()` separately provides a diagnostic snapshot. Source:
`rl/snake_env.py`: `OBSERVATION_NAMES`, `_observation()`, `_collision()`, `get_state()`.

### 3. Action space

Python uses `Discrete(3)`: **0 = straight, 1 = relative left, 2 = relative right**.
`ACTION_TURNS=(0,-1,1)` acts on clockwise headings `(up,right,down,left)`; reversal
is unavailable. Source: `rl/snake_env.py`: `__init__()`, `_next_head()`, `step()`.

JavaScript accepts absolute `UP`, `DOWN`, `LEFT`, `RIGHT`; reversal requests continue
in the existing direction. DQN/Qwen adapters translate relative outputs to absolute
actions. Sources: `js/game.js:directionFor()`,
`js/dqn-agent.js:BrowserDQNAgent.chooseAction()`, `rl/web_server.py:LocalApp.action()`.

### 4. Reward function and episode endings

The default **classic** reward is **+10 for food, -10 for collision, -0.01 for an
ordinary successful move**. These are mutually exclusive; eating does not also
receive a step penalty. Game score increases by 10 per food. The default board is
20x20 with a three-segment snake facing right. Source: `rl/snake_env.py`: constants,
`reset()`, `step()`.

- `terminated=True`: wall collision, self-collision, or full-board win.
- `truncated=True`: no food for 400 consecutive moves by default, unless the move
  already terminated the game. Eating resets this counter.
- Classic truncation has no additional death penalty.
- Training/evaluation runners also impose a 10,000-step episode cap, treated as
  truncation.

Sources: `rl/snake_env.py:step()`, `rl/dqn/train.py:train()`,
`rl/dqn/evaluate.py:rollout()`.

The implemented **strategy_v1** reward adds:

```text
reward = classic_reward + gamma*Phi(next) - Phi(current)
       + turn_penalty + repeat_penalty + timeout_penalty
required = max(1, min(L + 1, N*N - L + 2))
Phi = -min(d, 2*N)/(2*N) + 0.25*min(1, A/required) + 0.25*T
```

Here `N` is board width, `L` snake length, `d` BFS food distance (`N*N` when
unreachable), `A` reachable area, and `T` tail reachability. BFS treats the tail as
passable. Nonterminal turns cost -0.005. Revisiting the same full-body coordinate
tuple without eating costs `-0.05*min(previous_visits,4)`, up to -0.20 per revisit.
No-food truncation adds -2. True terminal states have next potential zero;
truncated states retain their potential. Sources: `rl/strategy_reward.py`:
`geometry()`, `potential()`, `StrategyReward.reward()`.

**Ultimate is implemented as strategy reward plus a browser movement rule**, not
a third numeric reward. With assistance enabled, it attempts a row-by-row sweep
strictly above 50% occupancy, after checking body order or attempting a join.
Sources: `rl/model_profiles.py:training_reward(), inference_rules()`;
`js/safety.js:SafetyGuard.choose(), cycleSpan(), fillAction()`.

### 5. DQN neural-network architecture

```text
Linear(10,128) -> ReLU -> Linear(128,128) -> ReLU -> Linear(128,3)
```

There are **18,307 trainable parameters**, verified from checkpoint tensors.
Outputs are unrestricted Q-values with no softmax. Online and target networks have
the same architecture. Sources: `rl/dqn/model.py:QNetwork`,
`rl/dqn/agent.py:DQNAgent.__init__()`, the surviving classic checkpoint listed below.

This is vanilla DQN, with target:

```text
y = reward + gamma * (1 - terminated) * max_a Q_target(next_state, a)
```

Truncations bootstrap from the final observation; true terminal states do not.
Source: `rl/dqn/agent.py:bellman_targets(), train_batch()`.

### 6. Replay, optimization, exploration, and target updates

| Setting | Implemented and recorded value |
| --- | --- |
| Replay capacity | 50,000 transitions in a NumPy ring buffer. |
| Sampling | Uniform mini-batches without replacement. |
| Batch size | 64. |
| Optimizer / learning rate | Adam / 0.0003. |
| Gamma | 0.99. |
| Learning starts | 1,000 environment steps, with sufficient replay. |
| Update frequency | Every four environment steps. |
| Epsilon | Linear 1.0 to 0.05 over 100,000 environment steps, then constant. |
| Target synchronization | Hard copy every 500 optimizer updates. |
| Loss | Mean Smooth L1 / Huber loss. |
| Gradient clipping | Norm capped at 10. |
| Recorded execution | CPU, one PyTorch thread. |

Sources: `rl/dqn/agent.py:DQNConfig, epsilon, observe(), train_batch()`;
`rl/dqn/replay_buffer.py:ReplayBuffer`; `results/run_config.json`.

### 7. Recorded training episodes and time

| Run | Completed training | Recorded elapsed seconds | Source |
| --- | --- | ---: | --- |
| Original classic | 2,000 episodes | 39.863040 | `results/training_status.json` |
| Classic continuation | 300 additional; cumulative 2,300 | 12.737914 | `results/strategy_v1_experiment/classic/status.json` |
| Strategy continuation | 300 additional; cumulative 2,300 | 22.760687 | `results/strategy_v1_experiment/strategy_v1/status.json` |
| Later UI continuation | 100 additional; cumulative 2,400 | 8.565184 | `results/training_runs/20260912_020458_6e69a4/status.json` |

The original run recorded **170,682 environment steps**, **42,421 optimizer updates**,
final trailing-100 training mean score **108.3**, and best validation mean **287.5 at
episode 2000**. The CSV contains 2,000 training rows and validation JSON contains
20 records. Sources: `results/training.csv`, `results/validation.json`.

The original timer includes periodic validation and checkpoint/log writes, and stops
before plot generation (`rl/dqn/train.py:train()`). It is not isolated optimizer
compute time. Continuations are branches, not episodes to add into one model total.
The surviving ultimate model retains strategy episode-2300 weights; the episode-2400
job has records but its named model file was absent during inspection. Sources:
the checkpoint inventory below and the episode-2400 `status.json` above.

### 8. Model checkpoint/save/load system

Format 1 stores online/target state dictionaries, Adam state, configuration,
environment/update counters, and metadata. Format 2 additionally stores replay
contents/position and replay, exploration, Python, NumPy, and PyTorch RNG states.
Writes use a temporary file followed by replacement. Loading uses CPU mapping and
`weights_only=True`. Sources: `rl/dqn/agent.py:save(), load()`;
`rl/dqn/replay_buffer.py:state_dict(), load_state_dict()`.

Legacy format 1 restores weights/optimizer/counters with empty replay; it does not
support exact continuation. Format 2 supports episode-boundary resume.
`train.py:train()` selects the original best checkpoint by strictly improved
validation mean score and saves latest checkpoints periodically/on exit.
`train_session.py:train_session()` implements resume and stop/save separately.

Current session naming is:

```text
models/{classic|strategy|ultimate}/YYYY-MM-DD_HH-mm-ss-ffffff_epN.pt
```

Metadata includes cumulative episode, parent model, seed, recent scores, environment
configuration, profile, inference rules, and timezone-aware save time. Numeric
reward changes clear replay; compatible strategy/ultimate changes preserve it.
Source: `rl/dqn/train_session.py:train_session()` and its nested `save()`.

Historical `best_model.pt` paths are stale; its recorded hash matches the timestamped
classic model. Sources: `results/evaluation.json`,
`results/model-renames-2026-09-12.json`, and the surviving classic checkpoint.

### 9. Random and heuristic baselines

Python `RandomAgent` uniformly samples actions 0-2 with its seeded NumPy RNG and
does not filter danger. Python `HeuristicAgent` filters immediately dangerous
actions, minimizes the change in Manhattan food distance, prefers straight on ties,
then heading order up/down/left/right; when trapped it returns straight. Both use
only the observation interface. Source: `rl/dqn/evaluate.py` policy classes.

JavaScript Random samples non-reversing absolute actions; Heuristic uses the
engine collision query and Manhattan food distance with the same tie preference.
Source: `js/agents.js` policy classes. The separate early Python random evaluator
instead seeds `env.action_space` and food per episode, so its RNG protocol differs
from the comparison baseline (`rl/random_agent.py:evaluate()`).

### 10. Qwen agent, prompt, structured output, and fallback

The configured tag is **`qwen3.8:27b-q4_K_M`**. Recorded Ollama metadata identifies
**27.3B parameters**, **Q4_K_M quantization**, **GGUF**, family **`qwen35`**, and
Ollama **0.33.3**. These are the recorded tag and metadata, not independent proof of
an upstream architecture named Qwen3.8. Transformer layer/head counts are not
documented in this project. Source: `results/llm_experiment/config.json`.

`LLMAgent` makes a fresh two-message, text-only `/api/chat` request for each move,
with no conversation history, pixels, full body coordinates, or action cache.
Source: `rl/llm_agent.py:structured_state(), LLMAgent.choose_action()`.

Exact system prompt (`rl/llm_agent.py:SYSTEM_PROMPT`):

```text
Control Snake for one move. Return ONLY a JSON object with exactly one key:
{"action":"STRAIGHT"}, {"action":"LEFT"}, or {"action":"RIGHT"}.
Actions are RELATIVE to current_direction: STRAIGHT keeps heading, LEFT turns
90 degrees counterclockwise, RIGHT turns 90 degrees clockwise. Never reverse.
Danger flags describe collisions on the next move. Choose a non-dangerous action
when possible, then move toward food. Food direction is absolute on the screen:
upper means up, lower means down. Prefer STRAIGHT when equally good.
Do not explain. Do not include markdown or other fields.
```

User-message format (example, not an additional model input):

```json
{"danger_straight":true,"danger_left":false,"danger_right":false,"food_direction":"upper_left","current_direction":"right"}
```

Only these five fields are sent. Food direction uses offset signs; distance and
the no-food timer are omitted (`rl/llm_agent.py:structured_state()`).

Generation uses `stream=false`, `think=false`, `temperature=0`, a fixed seed,
`num_ctx=2048`, `num_predict=32`, and `keep_alive="5m"`. Benchmark seed: 300000.
The JSON schema requires exactly one `action` string from `STRAIGHT`, `LEFT`,
`RIGHT`, with additional properties forbidden. Sources:
`rl/llm_agent.py:ACTION_SCHEMA, choose_action()`; `results/llm_experiment/config.json`.

Strict parsing rejects extra/duplicate keys, wrong types/case, unknown actions,
markdown, trailing prose, and incomplete/token-limited responses. Invalid output or
request failure selects the first safe move in straight/left/right order; if all
are blocked, straight. A schema-valid dangerous action is executed unchanged by the
raw Python agent. Telemetry separates invalid responses, request errors, fallbacks,
dangerous actions, and latency. Sources: `rl/llm_agent.py:validate_action(),
safe_fallback(), choose_action()`.

The client requires installed local GGUF weights and literal-loopback HTTP, disables
proxies, and forbids redirects. Benchmark request timeout defaults to 120 seconds,
bounded by remaining budget; the browser backend constructs the agent with a
60-second timeout. Sources: `rl/llm_agent.py:OllamaClient`,
`rl/web_server.py:LocalApp.__init__()`. Optional browser assistance can separately
override actions (`js/safety.js:AssistedAgent.chooseAction()`).

### 11. Evaluation metrics and episode counts

| Evaluation | Episodes and seeds | Source |
| --- | --- | --- |
| Training validation | 20 every 100 training episodes; 100000-100019 | `results/run_config.json` |
| Original three-policy test | 100 per policy; 200000-200099 | `results/evaluation.json` |
| LLM comparison | Requested 50 per policy; seeds starting 300000; Qwen budget 600 seconds | `results/llm_experiment/config.json` |
| Strategy comparison | 100 per model; 400000-400099 | `results/strategy_v1_experiment/comparison.json` |
| Browser assistance | 20 per condition; 3,000-step cap | `results/browser_safe_food_path.json` |

Metrics include mean/median/maximum score, successful survival steps, reward,
termination/truncation, and end reasons. LLM metrics also include latency,
invalid-response, request-error, fallback, and dangerous-action rates, plus
complete/partial counts. Strategy evaluation records turn rate. Sources:
`rl/dqn/evaluate.py:summarize()`, `rl/evaluate_llm.py:summarize()`,
`rl/compare_strategy.py:evaluate()`.

Survival excludes fatal attempts; score is 10 per food. LLM score averages exclude
wall-time-interrupted episodes; latency includes all attempted decisions. Invalid
response rate divides invalid/incomplete responses by received responses, with
transport/API failures accounted separately. Sources: `rl/snake_env.py:step()`;
`rl/evaluate_llm.py:rollout(), summarize()`.

### 12. Verified numerical results

#### Original held-out Python test

| Policy | Episodes | Mean score | Median | Maximum | Mean survival steps |
| --- | ---: | ---: | ---: | ---: | ---: |
| Random | 100 | 1.4 | 0 | 10 | 65.67 |
| Heuristic | 100 | 279.0 | 285 | 580 | 417.98 |
| DQN | 100 | 306.3 | 300 | 640 | 519.65 |

These aggregates were recomputed from all 300 rows in
`results/evaluation_episodes.csv` and match `results/evaluation.json`. All episodes
ended in collisions: DQN 91 self/9 wall; Heuristic 98 self/2 wall; Random 100 wall.
There were no wins or truncations in this test (same CSV).

#### Separate Qwen comparison

| Agent | Complete episodes | Mean score | Median | Maximum | Mean survival | Mean decision ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Random | 50 | 2.0 | 0 | 20 | 77.70 | 0.002 |
| Heuristic | 50 | 264.8 | 285 | 530 | 385.94 | 0.005 |
| DQN | 50 | 283.4 | 265 | 560 | 488.60 | 0.024 |
| Qwen | 1 | 10.0 | 10 | 10 | 412.00 | 1307.118 |

Sources: `results/llm_experiment/episodes.csv`, `comparison.json`. Latencies are
rounded. This is a separate seed set from the original DQN test above.

Qwen completed one episode ending at the 400-move no-food limit. Its second episode
was interrupted at score 10 after 46 successful moves and excluded from averages.
There were 459 attempted calls, 458 valid responses, one timeout, and zero executed
fallback moves. The timeout selected a fallback but the budget prevented execution.
Sources: `results/llm_experiment/Qwen_episodes.json`, `Qwen_decisions.jsonl`.

For the single shared completed seed, 300000:

| Agent | Score | Survival steps |
| --- | ---: | ---: |
| Random | 0 | 242 |
| Heuristic | 70 | 79 |
| DQN | 230 | 366 |
| Qwen | 10 | 412 |

Source: `results/llm_experiment/comparison.json:matched_policies`. One matched
episode is insufficient for a reliable four-policy ranking.

#### Strategy reward comparison

| Model | Additional training | Mean score | Median | Mean turn rate |
| --- | ---: | ---: | ---: | ---: |
| Original DQN | 0 | 272.5 | 280 | 61.49% |
| Classic continuation | 300 | 269.0 | 260 | 61.90% |
| Strategy continuation | 300 | 297.2 | 290 | 40.21% |

All use classic evaluation reward and no browser assistance; none reached the
no-food limit. Source: `results/strategy_v1_experiment/comparison.json`. This uses
different test seeds from the original 306.3 result.

#### Browser-specific measurements

Safe-food assistance mean scores were 1,247 for Random and 1,237 for Heuristic;
both reached the 3,000-step cap in all 20 episodes. These are planner-assisted
scores, not learned DQN/Qwen performance. Source: `results/browser_safe_food_path.json`.

A separate headless-Edge throughput sample at target 6,000 steps/s measured 299.40
steps/s for HTTP DQN versus 5,776.87 for browser DQN, assistance off, over roughly
three seconds. This measures execution speed, not policy quality or guaranteed
throughput. Source: `results/dqn-speed/benchmark.json`.

### 13. Existing artifacts and tests

Surviving complete-project checkpoints inspected:

| File under `models/` | Verified contents |
| --- | --- |
| `classic/2026-09-10_21-39-17-351796_ep2000.pt` | Format 1, episode 2000; hash matches original evaluation. |
| `strategy/2026-09-11_00-27-06-910520_ep2300.pt` | Format 2, episode 2300, 50,000 replay entries; hash matches strategy evaluation. |
| `ultimate/2026-09-12_01-30-56-963414_ep2300.pt` | Format 2, same online tensors as Strategy, additional sweep metadata. |

Sources: the checkpoint payloads; `results/model-renames-2026-09-12.json`;
`results/evaluation.json`; `results/strategy_v1_experiment/comparison.json`.

Existing complete-project artifacts include:

- `results/training.csv` (2,000 rows), `run_config.json`, `training_status.json`,
  `validation.json`.
- `results/training_reward.png`, `training_score.png`, `moving_average_score.png`;
  generated by `rl/dqn/train.py:plot_training()`.
- `results/evaluation_episodes.csv` (300 rows) and `evaluation.json`.
- `results/llm_experiment/episodes.csv` (152 rows), policy decision JSONL logs,
  per-policy episode JSON, configuration, and JSON/Markdown comparisons.
- `results/strategy_v1_experiment/`: two 300-episode training CSVs, status files,
  and 300 evaluation records in `comparison.json`.
- `results/training_runs/`: request/status JSON, episode CSVs, worker logs.
- Browser assistance JSON, `results/dqn-speed/` benchmark and preview artifacts,
  `results/layout-review/` screenshots/checks, and `tests/` fixtures/appearance hashes.

Historical log paths do not all identify surviving files. The classic episode-2300
control and episode-2400 output were absent from the inspected model directory.
Failed Windows replacement jobs also remain in the logs; requested budgets must not
be treated as completed training. Sources: `results/strategy_v1_experiment/classic/status.json`,
`results/training_runs/20260912_020458_6e69a4/status.json`,
`results/training_runs/20260911_002705_e9f1d9/worker.log`.

**Fresh verification during this inspection: 64 Python and 87 JavaScript tests passed.**

| Python suite | Tests |
| --- | ---: |
| `rl/test_env.py` | 24 |
| `rl/dqn/test_dqn.py` | 7 |
| `rl/test_llm_agent.py` | 12 |
| `rl/test_strategy_reward.py` | 8 |
| `rl/test_web_training.py` | 6 |
| `rl/test_browser_dqn.py` | 3 |
| `rl/test_model_profiles.py` | 4 |

| JavaScript suite | Tests |
| --- | ---: |
| `tests/game.test.cjs` | 7 |
| `tests/agents.test.cjs` | 9 |
| `tests/snake.test.cjs` | 49 |
| `tests/local-ai.test.cjs` | 8 |
| `tests/dqn-agent.test.cjs` | 6 |
| `tests/fill-rule.test.cjs` | 8 |

Commands used from the complete project:

```powershell
.\.venv\Scripts\python.exe -B -m unittest rl.test_env rl.dqn.test_dqn rl.test_llm_agent rl.test_strategy_reward rl.test_web_training rl.test_browser_dqn rl.test_model_profiles
node --test --test-reporter=dot tests/game.test.cjs tests/agents.test.cjs tests/snake.test.cjs tests/local-ai.test.cjs tests/dqn-agent.test.cjs tests/fill-rule.test.cjs
```

Coverage includes Gymnasium checks, transition parity, replay, Bellman targets,
checkpointing, exact resume, LLM validation/accounting, reward shaping, model
profiles, gameplay, asynchronous responses, and sweep rules. The cross-language
DQN test compares observations, Q-values, and actions over 1,000 states
(`rl/test_browser_dqn.py:test_javascript_observations_q_values_and_actions_match_pytorch`).
LLM tests use offline mocks; this rerun was not a new live Qwen benchmark
(`rl/test_llm_agent.py`). Earlier test counts elsewhere in this README describe
historical stages, not the current full suite.

### 14. Reproducibility

- Python/NumPy/PyTorch seeds, independent exploration/replay RNGs, deterministic
  PyTorch algorithms, and one CPU thread: `rl/dqn/agent.py:seed_everything(), __init__()`.
- Original food seeds 42-2041; separate validation/test seeds:
  `rl/dqn/train.py:train()`, `results/run_config.json`.
- Resume restores RNG/replay state and source seed; food seed is
  `seed + episode - 1`: `rl/dqn/train_session.py:train_session()`.
- JavaScript uses FNV-1a hashing and Mulberry32 with independent episode/agent
  seeds: `js/game.js:randomGenerator()`, `js/episode.js:runEpisodes()`.
  Python and JavaScript food streams differ for the same numeric seed
  (`rl/snake_env.py:get_state()` documentation).
- Dependencies pinned to Gymnasium 1.3.0, NumPy 2.5.3, PyTorch 2.14.0, matplotlib
  3.11.1 in `rl/requirements.txt`; training Python 3.12.14 is recorded in
  `results/run_config.json`.
- Experiment configuration records seeds, options, prompt, model identity,
  software versions, and checkpoint hashes: `results/run_config.json`,
  `results/evaluation.json`, `results/llm_experiment/config.json`.

### 15. JavaScript/browser versus Python

| JavaScript/browser/Node | Python |
| --- | --- |
| Browser Snake engine and human gameplay | Separate Gymnasium environment |
| Canvas/audio/input/shop/local storage | Numeric rewards and strategy shaping |
| Browser Random/Heuristic policies | Observation-only benchmark baselines |
| Loaded DQN forward pass | DQN optimization, replay, training, checkpoints |
| Optional full-board planning assistance | Raw policy evaluation |
| Asynchronous Qwen frontend bridge | Ollama requests, prompts, validation, telemetry |
| Node headless evaluation | CSV/JSON reporting and matplotlib plots |

Sources: `js/` modules listed in section 1, `scripts/headless.cjs`, and `rl/` modules
listed above. The browser engine itself has no 400-step no-food truncation:
`SnakeGame.step()` ends on collision/full-board win. Browser adapters calculate the
no-food observation feature; bounded Node evaluation supplies a separate cap.
Sources: `js/game.js:step()`, `js/dqn-agent.js:observation()`, `js/episode.js:run()`.

### Implemented versus planned: limits on resume claims

- **Future suggestions, not completed experiments:** Double DQN, added occupancy
  features/memory, multiple independent training-seed studies, alternative
  exploration schedules, smaller LLMs, and LLM action caching. Sources: historical
  README sections "Measured DQN results" and "Suitability for real-time control";
  current `rl/dqn/model.py`, `agent.py`, and `rl/llm_agent.py`.
- **Not implemented:** prioritized replay or dueling DQN; current replay is uniform
  and the Q-network is a plain MLP (`rl/dqn/replay_buffer.py`, `model.py`).
- **Not performed by this project:** Snake-specific Qwen fine-tuning; Qwen is
  inference-only (`rl/llm_agent.py`, `rl/evaluate_llm.py`).
- **Requested but not completed:** 50 Qwen episodes. Actual: one complete, one
  partial (`results/llm_experiment/Qwen_episodes.json`).
- **Already implemented despite older future-looking text:** asynchronous browser
  control/stale-response handling, resumable training, and strategy shaping
  (`js/local-ai.js`, `rl/dqn/train_session.py`, `rl/strategy_reward.py`).
- **Unsupported claims:** "DQN solved Snake" or "ultimate learned a guaranteed
  board-filling policy." Raw DQN evaluation had no wins; ultimate's surviving
  learned tensors equal Strategy and its sweep is explicit browser assistance
  (`results/evaluation_episodes.csv`, surviving ultimate/strategy checkpoints,
  `js/safety.js`). One training seed does not establish robust superiority.

## DQN browser speed and actual throughput

DQN now loads the selected checkpoint's inference weights once through the local
`POST /api/dqn/model` endpoint. `js/dqn-agent.js` evaluates the same three Linear
layers and two ReLUs in JavaScript, without exploration. The 10 float32 observations,
relative action order, and no-food normalization match the existing Python browser
bridge. It still uses `agent.chooseAction(state)` -> `Game.step(action)` and the same
optional safety assistance. Python remains responsible for training and checkpoints;
Qwen continues using the local Ollama request path.

Previously each DQN action required an HTTP round trip and a later animation frame.
Both 600 and 6,000 targets could therefore hit the same bottleneck. The selector now
says **target** speed, and each AI board displays **actual** completed steps/second,
sampled over approximately one second of active wall time, including inference waits.
Pausing displays zero. Multiple episodes can contribute to one measurement window.

Local timing check: Edge in Playwright headless mode, rendering disabled, `best_model.pt`,
JS seed 42, automatic restarts, a 0.5-second warmup followed by a 3-second sample:

| Inference | Safety assistance | Target 600: actual steps/s | Target 6,000: actual steps/s |
|---|---|---:|---:|
| Previous HTTP path | off | 261 | 299 |
| Previous HTTP path | on | 300 | 300 |
| Browser network | off | 597 | 5,777 |
| Browser network | on | 600 | 6,003 |

These short timing samples are not policy-quality evaluations or guaranteed speeds.
Small overshoots are possible at frame/sample boundaries. Rendering, longer snakes,
safety searches, two boards, browser throttling, and hardware can reduce throughput.
Work is limited to 128 ticks per board and a shared approximately 12 ms simulation
budget per frame (an individual step is not interrupted); the next frame continues.
No frame reuses a stale action to fake additional steps.

Model switches reject stale downloads. Round resets reuse loaded weights; **Connect /
refresh models** invalidates them so an overwritten checkpoint can be reloaded. Only
inference weights are exported, never the optimizer or replay buffer. JavaScript and
PyTorch may differ by floating-point rounding, particularly for almost tied Q values.
The cross-language regression compares all observations, Q values within tolerance,
and greedy actions over 1,000 states; the same check also passed for the trained
`best_model.pt` checkpoint. Speed samples are saved in
`results/dqn-speed/benchmark.json`.

Validation:

```powershell
node --test tests/game.test.cjs tests/agents.test.cjs tests/snake.test.cjs tests/local-ai.test.cjs tests/dqn-agent.test.cjs
.\.venv\Scripts\python.exe -m unittest rl.test_browser_dqn rl.test_web_training
```

## Current model schemes and training files

The current UI offers exactly three schemes:

| Scheme | Training reward | Browser behavior with assistance enabled |
| --- | --- | --- |
| classic | Food +10, collision -10, step -0.01 | Existing safety assistance |
| strategy | Classic plus food/space/tail potential, turn and repeat penalties, timeout penalty | Existing safety assistance |
| ultimate | Same numeric training reward as strategy | Shortest safe food paths up to 50%; row-by-row sweep above 50% |

The internal reward name `strategy_v1` is a compatibility alias for strategy.
Ultimate is a combined training-and-movement scheme, not a third learned numeric
reward. It preserves `inference_rules.dense_board_sweep_above_half` across training
and resume. Switching ultimate to strategy disables that rule. Switching between
classic and strategy-based rewards clears incompatible replay data; weights and
cumulative episodes are retained. Other switches preserve compatible replay.

Models are saved automatically to `models/classic/`, `models/strategy/`, or
`models/ultimate/`, based on the selected scheme, including intermediate and
stop-and-save checkpoints. Names follow `YYYY-MM-DD_HH-mm-ss-ffffff_epN.pt`, where
N is the cumulative episode count. The date/time is local; `saved_at` metadata
includes its timezone offset. Microseconds and a collision suffix prevent
same-second saves overwriting each other. The three supplied models were renamed
using their existing modification times; their weights and file hashes are intact.
The rename manifest records their previous paths for reference.

Seed controls initial weights, exploration and food randomness. Keeping the same
seed, settings, and software environment helps reproduce a training run. It is
not a difficulty level; 42 is a reasonable default. For resume, the source seed
and saved RNG state are used; the UI disables seed editing. Selecting a source
model defaults the scheme selector to that model's category, which can then be
changed explicitly before starting training.

Ultimate starts its sweep at length 201 on a 20x20 board (strictly more than 50%).
It checks the whole body's order before following the fixed row-by-row route;
if the body is not aligned, it attempts a safe join. Recovery from arbitrary
body shapes remains best effort. The gradient `YOU WIN, 100%` overlay remains
visible on a full-board win. Refresh and restart a round after upgrading.

Older experiment sections below retain their historical checkpoint names and
commands; use the current UI and naming rules above for new training.

## Page layout

The desktop demo places the board on the left and the game controls and collapsible
AI settings on the right. Episode statistics sit below each board. Training has its
own full-width, collapsible panel below the play area; rules are collapsed by default.
On narrow screens, the board comes first and the controls stack beneath it.

`css/layout.css` contains the responsive layout and the subdued dark background,
static grid, and soft accent lighting. It loads after the original `css/style.css`,
which retains the base game and shop styles. `index.html` and `PixelSnake.html` remain
identical entry points. This visual update does not change the engine, agents,
training settings, or checkpoint format.

## Strategy reward v1: reducing unnecessary turns and loops

**How to use it:** Refresh the local page and select
`strategy_v1/2300_model.pt` from the DQN model list to try the evaluated model.
The **Training reward** selector offers three choices: inherit from model, classic
reward, and strategy reward v1 (experimental). Selecting an older model with the
strategy reward allows fine-tuning. Changing the reward clears the old replay
buffer while preserving the Q network, target network, Adam state, exploration
progress, and cumulative episode count. Inheriting from a strategy model keeps its
strategy reward instead of reverting to classic. The new reward configuration and
discount factor are stored in the model's `metadata.env_config`.

```powershell
.\.venv\Scripts\python.exe -m rl.dqn.train_session --episodes 300 --checkpoint models/best_model.pt --reward-profile strategy_v1 --job-dir results/training_runs/my_strategy_run --save-every 100
```

### Strategies reviewed and the parts adopted

- [John Tapsell's Hamiltonian cycle and safe shortcuts](https://johnflux.com/2015/05/02/nokia-6110-part-3-algorithms/): follow a cycle covering the board to preserve head-to-tail order, then consider shortcuts. This project adopts the principle of preserving an escape route. It does not replace the DQN with a fixed traversal path or claim that every existing snake shape can safely join such a cycle.
- [Snake graph-search strategy](https://github.com/chynl/snake): first find a path to food, then simulate whether the tail remains reachable after eating. The browser assistance uses this check. When a safe path to food exists, it takes priority even if a DQN detour is temporarily collision-free.
- [Potential-based reward shaping by Ng, Harada, and Russell](https://people.eecs.berkeley.edu/~pabbeel/cs287-fa09/readings/NgHaradaRussell-shaping-ICML1999.pdf): use the discounted difference in potential instead of simply rewarding one move closer to food, preventing repeated movement from earning the same progress reward again and again.

### Reward details

`rl/strategy_reward.py` implements the reward. `SnakeEnv(reward_profile="classic")`
retains the original default reward and 10-dimensional observation exactly.
`reward_profile="strategy_v1"` uses:

| Component | Value or formula |
|---|---|
| Base reward for eating food | +10 |
| Base collision reward | -10 |
| Base reward for an ordinary move | -0.01 |
| Geometric potential difference | `gamma * Phi(s_next) - Phi(s)` |
| Surviving turn action | -0.005 (even necessary turns have a small cost) |
| Repeated full-snake state without eating new food | -0.05 on the first revisit, increasing to at most -0.20 per revisit |
| Exhausting the no-food step limit | An additional -2, still handled as Gymnasium truncation |

Let `N` be the board width, `L` the snake length, `d` the BFS distance to food
while avoiding the body (`N*N` when unreachable), `A` the number of cells reachable
from the head, and `T` indicate whether the tail is reachable:

```text
required = max(1, min(L + 1, N*N - L + 2))
Phi(s) = -min(d, 2*N)/(2*N) + 0.25*min(1, A/required) + 0.25*T
reward = base + gamma*Phi(next) - Phi(current) + turn + repeat + timeout
```

BFS treats the rest of the body as obstacles and the tail cell as a cell that is
about to become free, making this a static and slightly optimistic estimate. The
capacity denominator does not require an open region larger than the remaining
board space when the snake is long. The potential of a true terminal state is zero;
a truncated state retains its terminal potential, matching the DQN's continued
bootstrapping on truncation. The discount factor stays synchronized with the model's
gamma. A newly spawned food item after eating is part of the next state, so the
potential term is not silently cancelled. `info.reward_components` reports every
component per step, and the training CSV records turn ratio, total repeat penalty,
and total potential reward.

The potential term has the discounted telescoping-sum property, but the additional
turn, repeat, and timeout penalties change the optimization objective. This project
does not claim that the entire reward preserves the optimal policy. The network sees
only the original 10 numeric values rather than the full body shape; reward shaping
cannot fully compensate for this partial observability and cannot guarantee that the
snake will never become trapped.

### Measured results: same starting point, training budget, and test seeds

Two models were each trained for 300 additional episodes from the original
`best_model.pt` (2,000 episodes), using training seeds 2042–2341. Both were evaluated
in the classic environment on the same 100 independent seeds, 400000–400099, with
exploration and browser assistance disabled. These results therefore measure the
models themselves rather than the assistance planner:

| Model | Additional training | Mean score | Median score | Mean turn ratio |
|---|---:|---:|---:|---:|
| Original DQN | 0 | 272.5 | 280 | 61.49% |
| Continued training with classic reward | 300 | 269.0 | 260 | 61.90% |
| Continued training with strategy reward | 300 | 297.2 | 290 | 40.21% |

The turn ratio is the per-episode average of non-straight actions divided by attempted
steps, including fatal actions. None of the three groups reached the no-food limit;
this does not prove that the reported trap was reproduced or completely eliminated.
The state trajectory for that episode was unavailable. With this training seed, the
new reward reduced turning and improved the mean score. Multiple training seeds are
still required to establish robustness. The reward parameters were not repeatedly
tuned against these test results.

Complete per-episode data and checksums are in the
[experiment report](results/strategy_v1_experiment/comparison.md) and
[comparison.json](results/strategy_v1_experiment/comparison.json).
`models/2300_model.pt` is the classic-reward control;
`models/strategy_v1/2300_model.pt` is the strategy-reward experimental model. The
`2301_model.pt` generated later by a browser smoke test was not part of this
evaluation. `rl/compare_strategy.py` preserves the comparison procedure and refuses
to overwrite an existing experiment report.

### Seed behavior and verification

A seed is the starting point of a pseudorandom sequence. New models use it to
initialize weights, exploration, and replay sampling; food seeds are derived from
the cumulative episode number. The same seed, configuration, actions, and runtime
environment support reproducibility, but the seed does not represent difficulty,
quality, or the number of training episodes. The new checkpoint format restores
random state and inherits the seed when training resumes. Older models did not save
random state, so their first resumed run can only approximate a continuation.
Changing reward profiles intentionally rebuilds the replay buffer, so that run is no
longer an exact continuation of the original training process.

Tests cover reward decomposition, obstacle-aware distance, loop penalties, terminal
boundaries, discounted sums, replay clearing after a reward change, and post-eating
traps. All 57 Python and 70 JavaScript tests passed. Browser testing verified resumed
training after a reward change and control with the new strategy model. A Windows
issue was also fixed in which brief reads of the progress file could prevent an
atomic replacement: file locks now trigger bounded retries, and if an exception
occurs at a complete episode boundary, the model for that boundary is saved when
possible. Previously failed and unsaved training state cannot be recovered from logs.

## DQN, Qwen, and Training in the browser (2026-09-11)

The full feature set requires opening the page through the local service rather than
double-clicking the HTML file:

```powershell
# Run from the project directory and keep this terminal open
.\start-local.ps1
# Or:
.\.venv\Scripts\python.exe -m rl.web_server
```

Open **http://127.0.0.1:8765**. Opening `index.html` directly still supports Human,
Random, and Heuristic play, but DQN, Qwen, and Training require the local service.
The service listens only on 127.0.0.1. It provides no cloud inference, rejects
training API calls from remote origins, and exposes only DQN inference weights to the
same-origin page rather than full checkpoints or private project files.

### Controllers and anti-trap assistance

Both boards let you choose Human, Random, Heuristic, DQN, or Qwen as the controller.
Select a `.pt` file under **DQN model**; changing the selection resets the current
episode. Qwen uses the existing local Ollama installation:

```powershell
& 'D:\isaac-lab\Qwen\start.ps1'
```

Qwen receives only the original five structured fields, with no screenshots or raw
pixels. The model must already be installed locally. The page shows waiting state,
decision latency, and fallback messages. If the service is offline, it waits and
reports the error instead of pretending that the model acted. Qwen requests run
serially, so two Qwen-controlled boards wait for the shared model. AI speed is a
target; inference latency determines actual speed, and Qwen currently runs at about
one step per second. Asynchronous inference does not block the page. Pausing,
restarting, or changing controllers cancels pending requests and discards stale
responses. Every final action still passes through `SnakeGame.step(action)`.

**Anti-trap assistance** is enabled by default for every AI controller and does not
affect human control. It simulates candidate next moves, uses flood fill to check
reachable space and paths to the tail, and prefers candidates with an escape route
and more room. The latest version first finds the shortest path to food, simulates
the entire route, and checks tail reachability after eating. When the route leaves an
escape path, it takes priority; equally short routes prefer continuing straight, and
the plan is cached to prevent left-right oscillation between steps. If no safe food
route exists, it falls back to space, tail, and repeated-position checks. The UI shows
the number of adjustments. At high speeds, each frame processes at most 128 steps so
the controls remain responsive.

**This is an assistance planner with access to the complete board. It does not mean
that the DQN learned to plan or that Qwen's reasoning improved.** Disable the toggle
to observe the raw model. The planner cannot guarantee survival: the tail and body
move, and a one-step space estimate is not a complete search of future states. The
existing Python Random, Heuristic, DQN, and Qwen benchmarks and the DQN training
environment's default classic reward retain their original behavior. The strategy
reward is an optional experimental configuration.

Baseline from an earlier spatial-assistance version (20 fixed seeds, at most 3,000
steps per episode):

| Policy | Anti-trap assistance | Mean score | Mean steps | Collision endings | Step-limit endings |
|---|---|---:|---:|---:|---:|
| Random | Off | 1.5 | 83.15 | 20 | 0 |
| Random | On | 119.0 | 3000 | 0 | 20 |
| Heuristic | Off | 282.5 | 431.3 | 20 | 0 |
| Heuristic | On | 1109.5 | 3000 | 0 | 20 |

Reaching the limit does not mean completing the board. These results cover only the
Random and Heuristic spatial-assistance comparison and are not DQN/Qwen performance
statistics. The raw record is in
[browser_safety.json](results/browser_safety.json). Results for the current safe-food
path version on the same seeds are in
[browser_safe_food_path.json](results/browser_safe_food_path.json): Random with
assistance averaged 1,247, Heuristic with assistance averaged 1,237, and both reached
the 3,000-step limit in all 20 episodes. Reproduce the current version with
`node scripts/evaluate-safety.cjs 20 3000`.

### Training: select a model and continue training

Expand **Training · DQN**:

1. Select **Start from scratch**, or choose an existing model as the starting point.
2. Enter the number of **additional** episodes for this run (1–10000), the save interval, and a random seed for a new model.
3. Select **Start training** to view the cumulative episode count, score, moving average, epsilon, and saved files.
4. **Stop and save** waits for the current episode to finish before stopping, so a partial episode is never included in the filename.
5. After completion or stopping, the model list refreshes automatically; select the new model to play or continue training.

Files are named `models/<cumulative_episode>_model.pt`. For example, adding 500
episodes to `2000_model.pt` produces `2500_model.pt`; it does not restart numbering
at 500. Intermediate checkpoints are created at the save interval, and the last
completed episode is always saved when the run ends. A file with an existing name is
not overwritten; it is placed at `models/<run_id>/2500_model.pt`, and the selector
shows the full relative path. The older `best_model.pt` and `latest_model.pt` remain
available. The cumulative episode count **is not a quality ranking**; more training
does not guarantee a higher score.

New checkpoints save the Q network, target network, Adam state, replay buffer,
exploration progress, random state, and cumulative episode count, allowing training
to resume at an episode boundary. Older checkpoint formats lack the replay buffer and
random state, so the first resumed run explicitly reports that the old model must
rebuild its replay buffer. Checkpoints saved afterward support complete resumption.
Resumed training inherits the original model's seed and training parameters instead
of replacing them with the new-model seed field.

Training runs in a separate Python subprocess, so the page remains usable. Only one
training job can run at a time. State and CSV files are stored in
`results/training_runs/<run_id>/`, including `request.json`, `status.json`,
`training.csv`, and `worker.log`. Browser feature testing produced `2_model.pt` from
scratch, the resumed-training chain `2001_model.pt`, `2002_model.pt`, and
`2003_model.pt`, and `2036_model.pt`, which tested stop-and-save after continuing
from episode 2003. These are feature-validation artifacts and did not undergo a new
100-episode quality evaluation. Their numbers do not imply that they outperform the
original `best_model.pt`. Training applies only to DQN and does not fine-tune Qwen.

The same workflow is available from the command line; use a different job directory
for each run:

```powershell
.\.venv\Scripts\python.exe -m rl.dqn.train_session --episodes 500 --checkpoint models/2003_model.pt --job-dir results/training_runs/my_run --save-every 100
```

### Added modules and validation

| File | Responsibility |
|---|---|
| `start-local.ps1` | Starts the local service |
| `rl/web_server.py` | Serves page resources, validated inference endpoints, the model catalog, and training-process management |
| `rl/dqn/train_session.py` | Handles additional training, cumulative checkpoint numbering, stopping, and status logs |
| `js/local-ai.js` | Provides asynchronous model proxies, request waiting, and stale-response rejection |
| `js/safety.js` | Provides optional reachable-space, tail-path, and repeated-position assistance |
| `rl/test_web_training.py` | Tests resume equivalence, replay restoration, local endpoints, and file paths |
| `tests/local-ai.test.cjs` | Tests contracts for asynchronous actions, anti-trap logic, pause, and reset |

All 49 Python and 68 JavaScript tests passed. Testing in a real headless Edge browser
covered DQN control, new-model loading, real local Qwen actions, training from scratch,
two resumed runs, stop-and-save, pause, and controller switching. The layout had no
horizontal overflow at 390px. The original page body's visual baseline remained
unchanged; the appearance test normalizes Windows line endings, and the CSS baseline
records normalized text. New controls continue to use the existing page styles.

```powershell
.\.venv\Scripts\python.exe -m unittest rl.test_env rl.dqn.test_dqn rl.test_llm_agent rl.test_web_training -v
node --test tests/game.test.cjs tests/agents.test.cjs tests/snake.test.cjs tests/local-ai.test.cjs
```

## Run the browser demo

Open `index.html` in a modern browser. No installation, build, server, or external
dependencies are required. Keep the `css/` and `js/` directories beside the HTML.

The renamed `PixelSnake.html` file is also a working entry point. It contains
the same markup and loads the same shared files, preserving the original file URL
for users with browser-local saves. Keep its markup in sync with `index.html`;
the test suite checks that they match. Saved data still uses the existing
`pixel-snake-best`, `pixel-snake-language`, and `pixel-snake-shop` keys. Browser
storage depends on the URL/origin, so a different entry URL may have separate saves.

## Python RL quick start

From the project root, with Python 3.12 or newer:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r rl/requirements.txt
.\.venv\Scripts\python.exe -m unittest rl.test_env -v
.\.venv\Scripts\python.exe -m rl.random_agent --episodes 100 --seed 42
```

On macOS/Linux use `.venv/bin/python` instead of `.\.venv\Scripts\python.exe`.
An isolated `.venv` was created for validation on this Windows workspace. Python
was not on PATH here; the initial venv was created using the available bundled
Python runtime. The commands using `.venv` work without activating it. Dependencies
are pinned to Gymnasium 1.3.0, NumPy 2.5.3, PyTorch 2.14.0, and matplotlib 3.11.1; tests use Python's
standard-library `unittest` and require no test framework installation.

```python
from rl.snake_env import SnakeEnv

env = SnakeEnv(max_steps_without_food=400, render_mode="ansi")
observation, info = env.reset(seed=42)
observation, reward, terminated, truncated, info = env.step(0)
print(env.render())
env.close()
```

Importing `rl` also registers `PixelSnake-v0`, so
`gymnasium.make("PixelSnake-v0")` works after `import rl`. Use the compact observation
as the policy input; `info` contains score, survival/food counters, and end reasons
for diagnostics. `get_state()` provides a detached, JSON-serializable board snapshot
with JavaScript-style field names for future demo integration.

## PyTorch DQN: training and evaluation

The DQN is implemented directly in PyTorch, without Stable Baselines, TorchRL, or
another high-level RL trainer. The existing SnakeEnv rules, observations, rewards,
and browser gameplay are unchanged. Run from the project root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r rl/requirements.txt
# The supplied run already occupies models/ and results/. Preserve it with a new root:
.\.venv\Scripts\python.exe -m rl.dqn.train --episodes 2000 --seed 42 --output-root runs/reproduction
.\.venv\Scripts\python.exe -m rl.dqn.evaluate --checkpoint models/best_model.pt --episodes 100 --seed 200000
.\.venv\Scripts\python.exe -m unittest rl.test_env rl.dqn.test_dqn -v
```

`python -m rl.dqn.evaluation` is an alias for `python -m rl.dqn.evaluate`, supporting
both requested filenames. These entry points are package modules; use `-m` from
the project root. On a fresh project, omitting `--output-root` saves directly to
`models/` and `results/`. Training refuses to overwrite existing checkpoints or
training CSVs. Evaluation writes the named output directory (default `results/`);
use `--output-dir results/recheck` to retain separate evaluation reports.

### Interview walkthrough: how one DQN update works

1. **Approximate Q values.** `model.py` defines a fully connected network with
   dimensions `10 -> 128 -> 128 -> 3` and ReLU hidden activations (18,307 trainable
   parameters). Each output estimates the discounted future return of one relative
   action. The output is linear, without softmax: Q values are not probabilities.
2. **Explore.** `agent.py` chooses a uniformly random action with probability epsilon;
   otherwise it selects the largest online-network Q value. Epsilon decays linearly
   from 1.0 to 0.05 across the first 100,000 environment ticks and then stays at 0.05.
   There is no safety mask or heuristic intervention in DQN decisions.
3. **Store experience.** `replay_buffer.py` copies `(state, action, reward,
   next_state, terminated, truncated)` into a 50,000-transition ring buffer. Uniform
   random mini-batches of 64 break the strong correlation between consecutive moves
   and reuse earlier experience. A full buffer overwrites the oldest transition.
4. **Construct the Bellman target.** The target network is a frozen copy of the
   online network. For each sampled transition:

   `y = reward + gamma * (1 - terminated) * max_a Q_target(next_state, a)`

   `gamma = 0.99`. True terminal states (wall/body death or full-board win) contribute
   only their immediate reward. Truncations stop the rollout but still bootstrap
   from the final observation before reset. This follows SnakeEnv's treatment of
   no-food exhaustion as an external cutoff. Storing separate flags avoids silently
   treating every cutoff as death. The observation's capped no-food fraction can
   still make bootstrapping near that cutoff an approximation worth investigating.
5. **Fit the selected action value.** `gather()` extracts `Q_online(state, action)`
   for actions actually taken. Mean Smooth L1 (Huber) loss compares those predictions
   with targets computed under `torch.no_grad()`. Backpropagation updates only the
   online network through Adam, learning rate 0.0003. Gradient norm is clipped at 10.
6. **Stabilize the target.** Every 500 optimizer updates, online weights are copied
   into the target network. This reduces the speed at which the regression target
   changes. Learning starts after 1,000 ticks and runs every fourth environment tick.

This is vanilla DQN: the target network both selects and evaluates the maximum
next-action value. It is not Double DQN, prioritized replay, or a dueling network.
The code exposes each operation instead of wrapping them in an RL library. For
background, see the official [PyTorch DQN tutorial](https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html).

### Files and experiment artifacts

| File | Responsibility |
| --- | --- |
| `rl/dqn/model.py` | Neural-network Q function. |
| `rl/dqn/replay_buffer.py` | Bounded replay storage and seeded uniform sampling. |
| `rl/dqn/agent.py` | Epsilon-greedy actions, Bellman targets, mini-batch optimization, target synchronization, checkpoint I/O. |
| `rl/dqn/train.py` | Episode loop, logging, validation selection, checkpoints, matplotlib plots. |
| `rl/dqn/evaluate.py` | Greedy held-out evaluation and RandomAgent/HeuristicAgent comparison. |
| `rl/dqn/evaluation.py` | Alias entry point for evaluation. |
| `rl/dqn/test_dqn.py` | DQN unit tests and a small training/artifact smoke test. |
| `models/best_model.pt` | Highest validation mean-score checkpoint; ties retain the earlier checkpoint. |
| `models/latest_model.pt` | Most recent saved weights; saved at validation intervals and when training exits. |
| `results/training.csv` | Every training episode, including poor episodes and warm-up. |
| `results/run_config.json` | Hyperparameters, environment settings, seed protocol, software versions. |
| `results/training_status.json` | Completed episodes, environment ticks, optimizer updates, elapsed time. |
| `results/validation.json` | All periodic validation metrics, not just the best result. |
| `results/evaluation.json` | Held-out aggregate comparison, checkpoint identity/hash, and settings. |
| `results/evaluation_episodes.csv` | All 300 individual comparison episodes. |

Training logs episode, episode reward, score, epsilon at episode end, mean training
loss across that episode's updates, and trailing 100-episode mean score. Before
100 episodes the average uses all available episodes. Loss is blank in CSV when no
update occurred (warm-up), rather than pretending an update achieved zero loss.
It also logs attempted/survived steps, food, end reason, end flags, and update counts.
Console summaries appear at validation intervals; CSV rows are flushed every episode.
A 10,000-tick total cap additionally bounds each training/evaluation episode.

### Checkpoints and reproducibility

Checkpoints store online and target `state_dict`s, optimizer state, architecture and
hyperparameters, environment-step/update counters, and experiment metadata. Writes
use a temporary file followed by replacement. Loading explicitly uses CPU mapping
and `weights_only=True`; it does not deserialize a saved model class. Example:

```python
from rl.dqn.agent import DQNAgent
from rl.snake_env import SnakeEnv

agent, metadata = DQNAgent.load("models/best_model.pt")
agent.online.eval()
env = SnakeEnv(**metadata["env_config"])
observation, info = env.reset(seed=200000)
action = agent.choose_action(observation, explore=False)
observation, reward, terminated, truncated, info = env.step(action)
env.close()
```

The original format-1 checkpoints support inference and restore optimizer/counter state.
They do not contain replay or RNG states. The new Training panel accepts these legacy
files with an empty replay buffer, and writes format-2 numbered checkpoints with full
episode-boundary resume state. The original `train.py` experiment still has no resume
CLI claiming otherwise. Evaluation always calls `explore=False` regardless of the
checkpoint's training epsilon and never updates the model or replay buffer.
See [PyTorch serialization guidance](https://docs.pytorch.org/docs/stable/generated/torch.load.html).

Python, NumPy, PyTorch, epsilon exploration, and replay sampling are seeded.
The supplied run uses CPU, one PyTorch thread, and deterministic algorithms.
Matching software/hardware and seeds are needed for reproducibility; results are
not promised bit-identical across PyTorch releases or devices.

Training used seeds **42–2041**. Every 100 episodes, the current greedy network was
validated on the same 20 separate seeds **100000–100019**; that mean score selected
`best_model.pt`. The final test used **200000–200099**, never used for model selection.
The best checkpoint was episode 2000, also the final checkpoint in this run.

For fair comparison all three policies run in the same Python SnakeEnv with the
same 100 reset seeds, relative action space, 400-tick no-food limit, and 10,000-tick
absolute cap. Each sees the same 10-feature vector. RandomAgent samples all three
actions uniformly. HeuristicAgent ports the browser's nearest-food/immediate-danger
rule using observation features only (including its direction tie order), not
privileged snake-body state. Action RNG streams are independent of food RNGs.
Different trajectories can still produce different later food positions from the
same reset seed because the set of occupied cells differs.

### Measured DQN results

One 2,000-episode run at seed 42 completed **170,682 environment ticks** and
**42,421 optimizer updates** in about **39.9 seconds** of measured training time on
this machine (excluding dependency installation). Final trailing training mean
score was **108.3** with exploration epsilon **0.05**. The final validation mean
score was **287.5**. Greedy test scores are not directly interchangeable with
exploratory training scores.

Held-out evaluation: **100 episodes per policy**, exploration disabled for DQN:

| Policy | Mean score | Median score | Maximum score | Mean survival steps |
| --- | ---: | ---: | ---: | ---: |
| DQN | 306.3 | 300.0 | 640 | 519.65 |
| RandomAgent | 1.4 | 0.0 | 10 | 65.67 |
| HeuristicAgent | 279.0 | 285.0 | 580 | 417.98 |

Survival counts successful moves, excluding the fatal attempt. Scores are points,
so a DQN mean score of 306.3 represents an average of 30.63 fruits. All 300 test
rollouts terminated in collisions; none won or reached a time limit. DQN's deaths
were **91 self-collisions and 9 wall collisions**. HeuristicAgent had 98 self and
2 wall collisions; RandomAgent had 100 wall collisions.

The DQN substantially exceeded random play in this run and had a higher mean than
the heuristic on this test set. This is **one training seed and one test set**,
not evidence of consistent superiority across seeds, convergence, or solving Snake.
No post-test hyperparameter tuning or replacement of the original run was performed.
Reloading the saved checkpoint reproduced the reported DQN aggregate metrics exactly.

The early policy performed poorly: most episodes scored zero through much of the
run. Validation was unstable (for example, 73.0 at episode 1600 fell to 33.5 at
1700). Improvement came late as exploration decreased and useful food transitions
became more common. Training losses grew as the data distribution and value targets
changed, so a lower TD loss alone should not be interpreted as better play.
Likely remaining limitations and experiments to try next:

- The compact observation hides most of the body layout. This helps explain the
  dominant self-collision failure mode; test local occupancy features or memory.
- Sparse food rewards and high early exploration produce few useful successes.
  Evaluate longer runs and multiple exploration schedules without adding reward
  shaping first.
- Vanilla max-based targets can overestimate values. Compare Double DQN and target
  update schedules as separate, logged experiments.
- Run several independent training seeds and report uncertainty on a larger held-out
  set before making a robust DQN-versus-heuristic claim.
- Preserve this run and use new output roots for future changes; do not select models
  by repeatedly inspecting the held-out test set.

### Training plots

The plots contain the actual logged episodes, including failed episodes, without
filtering or replacing low scores. They are generated with matplotlib's headless
Agg backend; only the third plot applies the explicitly labeled moving average.

![Training reward vs episode](results/training_reward.png)
![Training score vs episode](results/training_score.png)
![Trailing 100-episode mean score](results/moving_average_score.png)

The DQN tests cover Bellman terminal masking, seeded replay and overwrite behavior,
exploration-free greedy actions, online/target updates, checkpoint round trips,
seeded optimization, baselines, rollout limits, and training artifact creation.
All **7 DQN tests**, **24 environment tests** (including Gymnasium checker), and
**62 browser/JavaScript tests** passed. A stale test reference to the old Chinese
HTML filename was corrected to `PixelSnake.html` after the existing project rename.

## Experimental local Qwen agent

This experiment uses the installed `qwen3.8:27b-q4_K_M` (27.3B, Q4_K_M) through
Ollama at `http://127.0.0.1:11434`. It runs headlessly against `SnakeEnv`; the original benchmark does not change DQN training. The newer local service also exposes Qwen as a browser controller. No screenshots, pixels,
full board, conversation history, or cloud API are used. No new dependencies are
needed beyond the existing requirements and your running local Ollama deployment.

```powershell
# Start the existing local deployment if needed.
& 'D:\isaac-lab\Qwen\start.ps1'
.\.venv\Scripts\python.exe -m unittest rl.test_llm_agent -v
.\.venv\Scripts\python.exe -m rl.evaluate_llm --episodes 50 --budget-seconds 600
```

The default output is `results/llm_experiment/`. The runner refuses to overwrite a
nonempty output directory; use `--output-dir results/llm_another_run` for a new run.
To allow a much longer attempt at 50 episodes, set a larger `--budget-seconds`.
The budget applies to Qwen rollouts, including inference, after model metadata
verification. The three baselines still run the requested number of episodes.
Each request also has a `--timeout` (120 seconds by default), limited by the
remaining run budget. There are no automatic retries, model downloads, or cloud
fallbacks. An unavailable/missing model fails verification before evaluation.

### LLM interface and action validation

`rl/llm_agent.py` exposes `LLMAgent.choose_action(observation) -> int`, using the
same relative action mapping as DQN: `STRAIGHT=0`, `LEFT=1`, `RIGHT=2`.

```python
from rl.llm_agent import LLMAgent
from rl.snake_env import SnakeEnv

agent = LLMAgent(seed=42)
agent.verify()  # Require installed local GGUF weights before inference.
env = SnakeEnv()
observation, info = env.reset(seed=42)
action = agent.choose_action(observation)
observation, reward, terminated, truncated, info = env.step(action)
print(agent.last_decision)  # State, raw reply, action, latency, errors/fallback.
env.close()
```

Only five fields are sent, derived from the existing numeric observation:

```json
{"danger_straight":true,"danger_left":false,"danger_right":false,"food_direction":"upper_left","current_direction":"right"}
```

Danger uses the environment's existing next-step collision queries. Food direction
uses the signs of food offsets: upper/lower, left/right, or their combination.
Current direction is absolute; LEFT and RIGHT actions are relative to it. Distance
to food and the no-food timer are omitted, so Qwen receives less detail than DQN's
10-number observation. The heuristic also uses only immediate danger, heading,
and food-offset signs. All policies have no access to the full body through their
observation interface.

Ollama receives a JSON schema requiring exactly `{"action":"LEFT"}` (or one of
the other allowed enums), `think:false`, `temperature:0`, a fixed seed, a 2,048-token
context, and a 32-token output limit. Each move is a fresh two-message request.
There is no state/action cache or multi-move batching. Strict parsing rejects
extra keys, duplicate keys, markdown, trailing prose, wrong types/case, unknown
actions, and incomplete/token-limited responses. Output is never executed as code.

Invalid responses and request failures choose the first immediately safe move in
STRAIGHT, LEFT, RIGHT order. When all three moves are dangerous, straight is a valid
fallback but cannot prevent death. **A schema-valid dangerous action is executed
unchanged.** This avoids silently giving Qwen the heuristic's collision avoidance.
Fallbacks, API failures, malformed responses, and dangerous actions are recorded
separately. A failed call therefore cannot masquerade as a successful Qwen move.

The client permits only HTTP literal loopback hosts (`127.0.0.1` or `[::1]`),
disables system proxies and HTTP redirects, checks the installed model tag and
local GGUF metadata, and rejects cloud/remote models. Your deployment's existing
`OLLAMA_NO_CLOUD=1` setting provides an additional server-side restriction.

### Benchmark accounting and artifacts

`rl/evaluate_llm.py` loads the existing best DQN with exploration disabled and
reuses the RandomAgent/HeuristicAgent implementations from DQN evaluation. Default
seeds are 300000 onward, separate from training/validation/prior DQN test seeds.
It preserves the checkpoint's board/no-food configuration and uses a common
10,000-step evaluation cap. Environment steps wait for each policy decision;
latency is measured, not converted into artificial in-game deaths.

- `config.json`: model tag/digest, Ollama version, full prompt/options, seeds,
  environment settings, time limits, and DQN checkpoint hash.
- `Qwen_decisions.jsonl` and baseline decision logs: each attempted action and
  latency; Qwen also includes the structured input, raw reply, and validation result.
- Per-policy episode JSON and `episodes.csv`: scores, successful survival steps,
  food, end reasons, termination/truncation, and budget-interrupted partial episodes.
- `comparison.json` and `comparison.md`: full results plus a comparison restricted
  to the episode seeds Qwen completed.

Mean/median/max score and mean survival use completed episodes only. Score is
10 points per food. No-food and evaluation-step truncations count as finished
evaluations; wall-time-interrupted episodes do not. Latency is per attempted
`choose_action` call and includes HTTP, inference, parsing, failed calls, and any
cold loading. Invalid-action rate is invalid/incomplete action responses divided
by received responses; transport/API errors are a separate rate over all calls.
Fallback rate includes both categories. Logs mark whether a timed-out decision was
actually executed; no move is executed after the wall-time budget has expired.

Seeds and temperature zero make runs more reproducible but do not guarantee
bit-identical LLM outputs across Ollama versions, quantization, hardware, or kernels.
Baselines and Qwen may finish different numbers of episodes: use the shared-seed
table for direct comparisons, and avoid strong rankings from a tiny sample.

Offline verification covers strict parsing, all food/heading mappings, local-only
routing, invalid/failing requests, unsafe valid actions, incomplete output, and
partial-episode/deadline accounting. All 12 LLM tests, 24 environment tests, seven
DQN tests, and 62 browser regression tests passed after this addition.

### Measured local-Qwen results (2026-09-10)

Run: `--episodes 50 --seed 300000 --budget-seconds 600`, default 20x20 board,
400-step no-food cutoff, and 10,000-step evaluation cap. Ollama 0.33.3 served the
local Q4_K_M model; DQN used the existing episode-2000 best checkpoint unchanged.
The preliminary three-request pilot warmed the model before this benchmark.
Its first request took 11.76 seconds; the next two took about 1.33 seconds each.
The table below measures the benchmark, not those pilot calls.

| Agent | Completed episodes | Mean score | Median | Max | Mean survival steps | Decision ms | Invalid response % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Random | 50 | 2.000 | 0.000 | 20.000 | 77.700 | 0.002 | 0.000 |
| Heuristic | 50 | 264.800 | 285.000 | 530.000 | 385.940 | 0.005 | 0.000 |
| DQN | 50 | 283.400 | 265.000 | 560.000 | 488.600 | 0.024 | 0.000 |
| Qwen | 1 | 10.000 | 10.000 | 10.000 | 412.000 | 1307.118 | 0.000 |

**Qwen did not complete 50 episodes within the runtime budget.** It completed one
episode (seed 300000), collecting one food and then making repeated RIGHT turns in
a four-move loop. It ended with score 10 and 412 successful moves because 400 moves
had elapsed without another food. This was a no-food truncation, not a collision.
The second episode stopped at the wall-time budget with score 10 and 46 successful
moves; it is saved but excluded from episode averages. At roughly nine minutes per
episode like the first, 50 episodes would take about 7.5 hours.

There were 459 attempted Qwen decisions: 458 complete responses, all valid, and
one request timeout caused by the remaining wall-time budget. The request-error
and fallback-selection rates are therefore 1/459 = 0.218%; that final fallback was
**not executed**. No executed move used a fallback. Invalid-action rate was 0/458.
The measured mean latency (including the final shortened timeout) was 1307.118 ms.
At this latency Qwen makes about 0.77 decisions/second, versus about 0.024 ms per
DQN decision on this machine. Survival alone would conceal Qwen's lack of progress.

The full table has unequal sample counts. For the one seed completed by all agents:

| Agent | Completed episodes | Mean score | Median | Max | Mean survival steps | Decision ms | Invalid response % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Random | 1 | 0.000 | 0.000 | 0.000 | 242.000 | 0.001 | 0.000 |
| Heuristic | 1 | 70.000 | 70.000 | 70.000 | 79.000 | 0.007 | 0.000 |
| DQN | 1 | 230.000 | 230.000 | 230.000 | 366.000 | 0.024 | 0.000 |
| Qwen | 1 | 10.000 | 10.000 | 10.000 | 412.000 | 1307.106 | 0.000 |

One shared episode is insufficient for a reliable performance ranking. These
results demonstrate a concrete loop failure and substantial inference latency;
they do not establish that all prompts or LLMs will behave the same way. The current
prompt is preserved in `results/llm_experiment/config.json`. No prompt tuning,
state caching, or DQN retraining was performed during the evaluation.

See [the complete comparison](results/llm_experiment/comparison.md),
[metric JSON](results/llm_experiment/comparison.json), and
[episode CSV](results/llm_experiment/episodes.csv). Raw Qwen states/replies are in
`results/llm_experiment/Qwen_decisions.jsonl`.

### Suitability for real-time control

An LLM can interpret rules and produce structured actions without Snake-specific
training. However, a 27B language model requires far more computation per move than
a small DQN or a few heuristic rules. Valid JSON does not establish spatial
reasoning, collision avoidance, or loop avoidance. The compact observation hides
body geometry and, for Qwen, distance/time information; a deterministic stateless
policy can repeatedly choose the same action in an indistinguishable situation.

This experiment keeps the game paused while waiting for inference. Real-time
play would also need a latency budget and an asynchronous controller with a policy
for stale decisions. A smaller model or cached decisions could reduce cost, but
those should be measured as separate variants. LLMs may be more useful for episode
analysis, explanations, or high-level planning while a fast policy controls moves.

## Python environment design

`rl/snake_env.py` implements `SnakeEnv(gymnasium.Env)` using the modern
`reset() -> (observation, info)` and
`step() -> (observation, reward, terminated, truncated, info)` interfaces.
`render()` returns a text board when `render_mode="ansi"` and returns `None` with
the default headless mode. `close()` is idempotent; there are no windows or external
processes to clean up. Call `reset()` before stepping and after either end flag;
otherwise `step()` raises `ResetNeeded`. These conventions follow the
[Gymnasium environment API](https://gymnasium.farama.org/api/env/).

The default 20 × 20 board starts with the same three-segment snake as the JavaScript
engine: head `(9, 10)`, body `(8, 10), (7, 10)`, facing right. Food is uniformly chosen
from unoccupied cells. Eating grows the snake by one and adds 10 score points.
Walls and body collisions end the game; entering the departing tail cell is legal
when not eating. Filling the board is a win. `board_size` can be configured to an
integer of at least 6 for smaller experiments. One step is one grid move, without
browser timing, boosting, particles, sound, skins, or shop state.

### Relative action space

The action space is `Discrete(3)`:

| Value | Action | Example when facing right |
| --- | --- | --- |
| `0` | Continue straight | Right |
| `1` | Turn left, then move | Up |
| `2` | Turn right, then move | Down |

Every action advances one tick. No action can reverse direction instantaneously.
Out-of-range values, absolute direction strings, floats, and booleans raise
`ValueError` before changing game state. NumPy integer actions are accepted.

### Numeric observation space

Observations are fresh NumPy `float32` arrays of shape `(10,)`, declared with a
bounded Gymnasium `Box`. The feature order is also available as
`SnakeEnv.OBSERVATION_NAMES`:

| Indices | Features | Range and interpretation |
| --- | --- | --- |
| `0–2` | Danger straight, left, right | `0` or `1`, using the same wall/body/tail rules as `step()`. |
| `3–6` | Current direction: up, right, down, left | Four one-hot values, each `0` or `1`. |
| `7` | Food x offset | `(food_x - head_x) / (board_size - 1)`, from `-1` to `1`. Positive means food to the right. |
| `8` | Food y offset | `(food_y - head_y) / (board_size - 1)`, from `-1` to `1`. Positive means food below. |
| `9` | No-food budget used | `steps_since_food / max_steps_without_food`, bounded to `[0, 1]`; reset to `0` by eating. |

This vector gives a small policy immediate hazards, orientation, food location,
and progress toward the loop cutoff without learning from raw pixels. Direction
uses one-hot values to avoid imposing a false numeric distance between headings.
Food offsets provide both direction and normalized distance. At a full-board win,
food offsets are zero because no food remains.

The observation is deliberately **partially observed**: it omits the full body
layout and absolute head position. Different boards can produce identical vectors,
so these features do not guarantee enough information for a perfect memoryless
policy. A later stage can add occupancy features or agent memory if needed.

### Reward and episode endings

Rewards are mutually exclusive, rather than combined with a step penalty:

| Transition | Reward |
| --- | --- |
| Eats food, including the final food of a full-board win | `+10.0` |
| Hits a wall or its own body | `-10.0` |
| Any other successful move, including a no-food cutoff | `-0.01` |

The small movement cost discourages long loops while food/death remain the dominant
signals. There is no distance-to-food bonus, additional win bonus, or other reward
shaping. Score is always 10 points per food and is distinct from cumulative reward.

`max_steps_without_food` defaults to `board_size ** 2` (400 on the default board).
It counts attempted ticks since the last fruit and resets immediately on eating.
Reaching that limit on a non-eating move ends the episode with `truncated=True`
and `info["end_reason"] == "no_food_limit"`. This is a finite no-progress cutoff,
not proof that a repeated path was detected. It prevents endless runs without
marking the snake as dead. Collision or a full-board win returns `terminated=True`;
collision/win takes precedence over the cutoff on the same tick. The distinction
matches Gymnasium's termination/truncation semantics in its
[API reference](https://gymnasium.farama.org/api/env/).

`info` includes `score`, `steps` (including a fatal attempt), `steps_survived`
(successful moves), `food_collected`, `snake_length`, `steps_since_food`,
`cause_of_death` (`wall`, `self`, or `None`), `end_reason`, and `won`.
Episode numbering is kept by the evaluator, outside the environment's deterministic
state. No-food truncation has no death cause; a win uses `end_reason="board_full"`.

### Seeding and relationship to the browser

`reset(seed=n)` calls `super().reset(seed=n)` and food spawning uses only
`self.np_random`. Repeating a seed and action sequence reproduces Python states,
observations, rewards, and end flags. `reset(seed=None)` continues the existing
random stream rather than rewinding it. To reproduce random policies, also seed
`env.action_space`; it has an independent RNG. The evaluation script seeds both
streams with `base_seed + episode_index`.

The browser files remain unchanged and continue to serve as the interactive
visualization/demo. Python implements matching grid rules independently, so RL
rollouts do not require Node.js or a browser. The test suite compares transitions
between Python and the actual JavaScript engine for movement, food, growth, walls,
body collisions, and departing-tail cases. NumPy and JavaScript's Mulberry32 use
different random streams: equal seeds do **not** imply identical food sequences
across languages. The new local service bridges browser snapshots to Python policy inference; the original offline environment does not require browser playback
integration in this step; `get_state()` is a compatible data boundary for that work.

### Python validation and random baseline

`rl/test_env.py` calls Gymnasium's `check_env()` without skipping render checks.
It provides an environment spec so the checker can recreate the supported render
mode. Its 24 tests cover the checker, observations, invalid/reverse actions,
collisions, eating/growth, resets, multi-food seed replay, loop cutoff boundaries,
full-board wins, rendering, and a repeated 100-episode baseline. The JS parity test
runs when Node.js is available; the environment and other tests do not depend on it.
See the official [environment checker documentation](https://gymnasium.farama.org/api/utils/#gymnasium.utils.env_checker.check_env).

Run the random baseline with `python -m rl.random_agent --episodes 100 --seed 42`.
Add `--details` to include every episode record in its JSON output. No action
masking or learning is applied: it samples uniformly from the three relative actions.
Episodes stop on either end flag. The reported survival length is the number of
successful moves, not the snake's body length; total attempted ticks are reported
separately as `mean_episode_steps`.

Verified using Python 3.12.14, Gymnasium 1.3.0, and NumPy 2.5.3:

| Metric | 100 episodes, base seed 42 |
| --- | ---: |
| Mean score | 1.3 |
| Median score | 0.0 |
| Mean survival length (successful moves) | 64.15 |
| Mean attempted steps per episode | 65.15 |
| Terminated / truncated episodes | 100 / 0 |

All 24 Python tests and the 62 existing JavaScript tests pass. These results are a
reproducible random-policy baseline, not training results or a claim of good play.

## Controls and preserved behavior

- Single player: WASD or arrow keys.
- Two players: player 1 uses WASD; player 2 uses arrow keys on a separate board.
- Space pauses/resumes or starts a round. Buttons also start, pause, and restart.
- Touch: swipe a board or press its direction buttons.
- Hold the current direction for 0.5 seconds to boost to 10 cells/second.
  Release or turn to return to the earned speed.
- The board is 20 × 20. The snake starts with 3 segments, facing right.
- Fruit adds one segment, 10 points, and 5 shared shop coins.
- Base speed starts at 4 cells/second, increases by 0.1 per fruit, and caps at 10.
- Walls and the snake's body end that board. Moving into the departing tail cell
  is legal when not eating. Filling the board wins.
- Players have independent movement clocks and scores. One can continue after
  the other finishes. The round ends when all active players finish.
- Neon styling, interpolation, particles, sound, skins, records, three languages,
  reduced-motion behavior, and pause-on-focus-loss behavior are retained.

## Structure

```text
index.html                 Page markup and ordered script loading
PixelSnake.html            Compatibility entry with identical markup
css/
  style.css                Original styles plus agent/statistics controls
js/
  game.js                  SnakeGame, abstract actions, shared collision queries
  agents.js                HumanAgent, RandomAgent, HeuristicAgent
  episode.js               EpisodeRunner and headless batch evaluation
  safety.js                Optional browser space/loop avoidance assistance
  local-ai.js              Asynchronous local Qwen bridge / HTTP reference agent
  dqn-agent.js             Browser DQN network and observation adapter
  renderer.js              Canvas drawing, interpolation, particles, and sound
  input.js                 Keyboard, pointer, swipe, and held-input handling
  main.js                  Human-play controller, timing, HUD, shop, and saves
scripts/
  headless.cjs              Command-line episode evaluation with JSON output
rl/
  __init__.py               SnakeEnv export and optional PixelSnake-v0 registration
  snake_env.py              Python Gymnasium environment with numeric observations
  web_server.py             Loopback frontend, inference and training service
  test_web_training.py      API and exact resume regression tests
  test_env.py               Environment checker and Python unit/parity tests
  random_agent.py           Reproducible random-policy evaluation and reporting
  llm_agent.py               Text-only local Ollama policy, strict validation and fallback
  evaluate_llm.py            Independent timed Qwen/DQN/baseline comparison
  test_llm_agent.py          Offline action, local routing, and accounting tests
  requirements.txt          Pinned Gymnasium, NumPy, PyTorch, and matplotlib dependencies
  dqn/                      Explicit PyTorch model, replay, agent, training, evaluation, tests
models/                     Best and latest saved PyTorch checkpoints
results/                    Training/evaluation CSV and JSON, matplotlib plots
tests/
  agents.test.cjs          Agent contracts, decisions, and headless statistics
  game.test.cjs            Public engine API, reproducibility, and appearance checks
  snake.test.cjs           Existing browser regression scenarios and integration checks
  appearance-baseline.json SHA-256 hashes of original CSS and page body
README.md
```

The scripts use small scoped factories and browser globals (`SnakeEngine`,
`SnakeAgents`, `SnakeEpisodes`, `createSnakeRenderer`, `createSnakeInput`) rather than ES-module imports so opening
the HTML directly still works. `game.js`, `agents.js`, and `episode.js` also export
CommonJS APIs for Node.js. Load those three in that order before `main.js`.
There is no bundler or package dependency.

## Inspection of the original project

Before changes, the entire application lived in a single HTML file whose name
translates to `Pixel-Style-Snake.html` (1,225 lines),
with inline CSS and one script at lines 550–1223. The only other project
file was `tests/snake.test.cjs`, containing 39 passing regression tests. There was
no README, package manifest, or build configuration.

These references describe the original file, before extraction:

| Responsibility | Original location and behavior | Current location |
| --- | --- | --- |
| Snake state | `players` at line 726 mixed snake, direction, food, turns, score, alive/win flags with canvas, touch, boost, and animation data. `resetPlayers()` at line 859 initialized them. | Private state in each `SnakeGame`; `main.js` keeps a copied `player.model` and separate human-play/presentation fields. |
| Movement | `step(player)` at line 1101 advanced one grid cell. `frame()` at line 1131 scheduled ticks with independent clocks. | Grid movement in `SnakeGame.step(action)`; clocks remain in `main.js`. |
| Food | `spawnFood()` at line 851 enumerated empty cells and chose one with `Math.random()`. | Private `SnakeGame.#spawnFood()`, with the same empty-cell selection and an optional seeded stream. |
| Collisions | `step()` checked walls and body; it excluded the departing tail when not eating. | `SnakeGame.step()`, retaining those rules. |
| Score and game over | `step()` added 10 points, updated best score/storage, awarded coins, and detected a filled board. `finish()` at line 1085 ended a board and updated round status; `renderStatus()` at line 1010 displayed results. | Engine owns points, alive/win flags, and terminal detection. Controller reacts to score/state changes to award coins, save records, and display results. |
| Keyboard input | Handlers at lines 1176–1201 mapped WASD/arrows to `turn()`, prevented reversal and duplicate turns, and buffered at most two turns. Key repeat only maintained held-input highlighting/boost. Space controlled start/pause. | `input.js` translates hardware events to `Actions`; `HumanAgent` buffers human turns; the engine independently rejects reversals. |

## Architecture and state ownership

`game.js` has no DOM, Canvas, audio, local storage, timer, or keyboard dependency.
Each engine owns only the grid state and its random stream. Engine methods are
synchronous, so callers decide when to advance. The same engine runs in a browser
or in Node.js without rendering anything.

`input.js` converts keys, virtual buttons, and swipes into `UP`, `DOWN`, `LEFT`, or
`RIGHT` actions and calls the controller. It also tracks held input for highlighting
and boosting. It never modifies snake state or calls the engine directly.

`main.js` owns two engines, their agents and episode runners, and the
ready/running/paused/over round status. `HumanAgent` queues at most two human turns
per player. The controller schedules ticks and replaces `player.model` with the
snapshot returned by the runner. Every runner step calls
`game.step(agent.chooseAction(game.getState()))`. It retains the existing boost and speed
timing, including interpolation retiming on boost release. Boost changes how often
the controller calls `step`; it does not change what one engine step means.

The controller also retains the existing HUD, translations, shop, and persistence
code. An increase in engine score triggers the existing coin award, record save,
score animation, and fruit feedback. Engine terminal state triggers result overlays.
There is no second copy of collision, growth, or food-selection rules in the UI.

`renderer.js` consumes snapshots plus presentation data. It retains the original
drawing/interpolation algorithms, skin rendering, particles, and sound. Particle
randomness is cosmetic and cannot advance a seeded engine's random stream.

## Engine API

In Node.js, from the project directory:

```js
const {SnakeGame, Actions} = require('./js/game.js');

const game = new SnakeGame({seed:42});
const initial = game.getState();
const next = game.step(Actions.UP);
console.log(next.snake[0], next.score, game.isGameOver());

game.reset();       // Replays seed 42 from the beginning.
game.reset('run');  // Selects and remembers a new seed.
```

In the browser, use `const {SnakeGame, Actions} = window.SnakeEngine` after loading
`js/game.js`. The normal human-play controller creates unseeded engines.

| Method | Contract |
| --- | --- |
| `new SnakeGame({seed} = {})` | Creates and resets a 20 × 20 game. Optional seed is a finite number or string, including `0` or an empty string. |
| `reset()` | Restores initial snake, direction, score, and alive/win flags. Rewinds the configured seed and returns a snapshot. |
| `reset(seed)` | Configures a new seed and resets. Explicit `reset(undefined)` returns to unseeded randomness. |
| `step(action)` | Advances exactly one grid tick and returns a snapshot. Accepts the four exported `Actions` values. |
| `step()` | Continues in the current direction for one grid tick. |
| `getState()` | Returns a detached snapshot; changing it cannot mutate the engine. |
| `isGameOver()` | Returns true after a collision or a full-board win. |

A snapshot contains `size`, `snake` (head first, `{x, y}` cells), `direction`
(`{x, y}` unit vector), `food` (`{x, y}` or `null`), `score`, `alive`, `won`,
`steps`, `stepsSurvived`, `foodCollected`, and `causeOfDeath`.
Coordinates start at `(0, 0)` in the upper-left; x increases right and y down.

Opposite-direction actions are ignored and movement continues forward. Unknown
actions throw `TypeError`; keyboard names such as `KeyW` are not engine actions.
After game over, valid `step()` calls return the unchanged terminal state.
`getState()` is an observation, not a serialization of RNG state for mid-run restore.

For reproduction, use the same seed and action sequence with the same engine
version. Seeds are hashed with FNV-1a and feed a per-instance Mulberry32 stream.
Food is chosen from empty cells in row-major order. `reset()` rewinds this stream;
other players, render frames, and cosmetic random calls cannot consume it. The
guarantee applies to grid states, food, scores, and terminal outcomes, rather than
the real-time schedule of human keystrokes or cosmetic particle positions.

## Agents and browser controls

Each board has a **Human / Random AI / Heuristic AI** selector. In two-player mode,
you can mix controllers independently. Changing a controller resets both boards to
Ready; press Start to begin. Changing speed or rendering does not start a new episode.
The selected controller is session-only and defaults to Human on reload.

- **Human:** the original WASD/arrows, swipe, virtual buttons, two-turn buffer, and
  hold-to-boost controls. Hardware events only enqueue abstract actions.
- **Random AI:** uniformly samples the three non-reversing actions. “Valid” means a
  recognized, non-reversing direction; it may choose a wall/body collision. Its
  optional seed is independent of the engine's food seed.
- **Heuristic AI:** filters out immediate collisions using the engine's shared
  collision query, then minimizes Manhattan distance to food. Ties prefer going
  straight, then the stable UP/DOWN/LEFT/RIGHT order. It takes a safe detour when
  possible. If trapped, it continues forward. This greedy policy can trap itself
  later or circle indefinitely; it does not plan a guaranteed winning route.

**AI speed** offers Normal, 60, 600, and 6,000 steps/second. Normal follows the
existing 4–10 cell/second growth speed and animations. Faster options batch multiple
engine steps in each animation frame and draw the latest board once per frame;
interpolation, fruit particles, and eating sounds are skipped for those AI boards.
Human boards keep their original speed. Catch-up time is capped at 250 ms, with
at most 128 steps per board and an approximately 12 ms shared simulation budget per
frame. Actual throughput is measured separately from the target and depends on the
browser, policy, assistance, snake length, and machine.

**Disable board rendering (headless)** turns off Canvas drawing, interpolation,
particles, and game sound for both boards. The page keeps its controls, overlays,
and statistics live. It can run even when Canvas is unavailable. Select an AI and
higher AI speed for fast browser simulation. Unchecking restores the latest board.
This browser option still uses animation frames; use the Node runner below to remove
browser/frame scheduling entirely.

**Auto-restart AI episodes** starts a new round after all active boards finish,
only when every active controller is AI. It never automatically restarts mixed
human/AI rounds. Space/pause, opening the shop, and backgrounding still pause play.
The UI shows the current/latest episode; use batch results for a record of every
completed episode. AI points and coins use the existing shared browser records/shop.
Node headless evaluation has no storage or shop side effects.

### Agent interface

The required method is synchronous:

```js
const action = agent.chooseAction(state);
```

It receives a detached engine snapshot and returns `Actions.UP`, `Actions.DOWN`,
`Actions.LEFT`, or `Actions.RIGHT`. Built-in agents return `undefined` on terminal
states, which the runner does not advance. For a custom live agent, `undefined`
means continue straight, as in the engine API. Agents must not return keyboard
events, modify the engine, render, or wait on a timer. An optional `reset()` method
clears agent memory at an episode boundary.

`HumanAgent.queueAction(action, state)` accepts keyboard/touch actions without
advancing the game. `chooseAction(state)` consumes one queued action or returns the
current direction. `reset()` clears the queue. `RandomAgent({seed})` owns a seeded
random stream and `reset()` rewinds it. `HeuristicAgent` is stateless and deterministic.
All three remain independent of DOM and keyboard event objects.

The engine exports `getLegalActions(state)` (non-reversing directions),
`getCollisionCause(state, action)` (`null`, `wall`, or `self`), and
`randomGenerator(seed)`. Agents use these shared rules instead of maintaining a
second implementation of collision detection. A departing tail is safe unless the
step eats food.

### Episode runner and statistics

`EpisodeRunner({game, agent})` connects any agent to the engine with no rendering.
It initially represents a Ready board (episode number 0). Call `reset()` to start
an episode, then `step()` to ask the agent and advance exactly one tick.

| API | Behavior |
| --- | --- |
| `reset({seed?, countEpisode?} = {})` | Resets game and optional agent memory, increments the episode number, and returns a snapshot. Omitted seed reuses the engine seed. The browser uses `countEpisode:false` for Ready previews. |
| `step()` | Calls the chosen agent and the same `game.step(action)` API; terminal games stay unchanged. |
| `setAgent(agent)` | Validates and replaces the agent; caller chooses when to reset. |
| `getStatistics()` | Returns a detached plain object containing the fields below. |
| `run(maxSteps = 10000)` | Runs synchronously until game over or the episode's total attempted-step limit; returns statistics plus `truncated`. Call `reset()` first. |

| Statistic | Meaning |
| --- | --- |
| `episodeNumber` | Runner-owned counter, starting at 1 on the first real reset/start; not part of deterministic engine state. Browser counters are per board and exclude inactive-board previews. |
| `score` | Engine points: 10 per fruit. Shown in the existing score panel. |
| `steps` | All executed live ticks, including a fatal collision attempt. |
| `stepsSurvived` | Successful grid moves, excluding the fatal tick. Shown in the new statistics panel. |
| `foodCollected` | Number of fruits eaten this episode. |
| `causeOfDeath` | `wall`, `self`, or `null`. Live games and full-board wins have no death cause. |
| `terminated` / `won` | Whether the engine has ended, and whether it filled the board. |
| `truncated` | Returned by bounded runs when the step limit stops a still-live episode. It is not recorded as a death. |

Movement/food/death counters live in the engine, so direct `game.step(action)`
callers get identical statistics. Pausing, rendering, invalid actions, and attempts
to step an already-terminal game do not increment them. A full-board win counts its
last successful movement and fruit.

## Headless evaluation

Run from the project directory with Node.js, without opening a browser:

```sh
node scripts/headless.cjs heuristic 1000 10000 42
node scripts/headless.cjs random 1000 10000 42
```

Arguments are **agent**, **episodes**, **maximum attempted steps per episode**, and
**base seed**. Defaults are `heuristic 100 10000 42`. The command emits JSON with
all episode records, elapsed time, total steps, and measured throughput. CLI seeds
are strings. Invalid modes/counts fail with a nonzero exit code. The step cap bounds
heuristic loops; those outcomes have `truncated:true` and `causeOfDeath:null`.

Programmatic use:

```js
const {SnakeGame} = require('./js/game.js');
const {HumanAgent, RandomAgent, HeuristicAgent} = require('./js/agents.js');
const {EpisodeRunner, runEpisodes} = require('./js/episode.js');

const runner = new EpisodeRunner({
  game: new SnakeGame({seed:42}),
  agent: new HeuristicAgent()
});
runner.reset();
const state = runner.step();
console.log(runner.getStatistics());

const records = runEpisodes({
  episodes:1000,
  maxSteps:10000,
  seed:42,
  agentFactory: ({seed}) => new RandomAgent({seed})
});
```

`runEpisodes` requires `agentFactory({episodeNumber, seed})`, creates fresh agent
memory per episode, and returns an array of results. Defaults are 100 episodes,
10,000 steps, and base seed 0. It derives distinct food and agent seeds from the
base seed's type/value and episode number. The same options/factory reproduce the
same episode records; wall-clock performance fields are naturally variable.
For a single replay, reset the same game and seeded agent together via the runner.

These JavaScript modules provide synchronous demo/evaluation APIs. The new Python
component is described above and adds its own Gymnasium observation/reward contract.
The local service exports DQN inference weights for browser execution and provides Qwen control through local Ollama; Python training and evaluation remain separately runnable.

## Verification

Run with Node.js (verified with v24.19.0):

```sh
node --test tests/game.test.cjs tests/agents.test.cjs tests/snake.test.cjs
```

All 62 tests pass, including the original 39 gameplay regressions, engine/appearance
checks, and new agent, episode, UI switching, fast-clock, headless, and auto-restart
tests. The original CSS and markup are checked against their saved hashes after
excluding the explicitly added controls/styles.

The original scenarios use an in-memory fixture adapter to arrange board states
with a stub DOM, Canvas, and manual clock. The adapter is not shipped with the game.
New engine/agent tests import the unmodified modules, and production-controller
tests exercise the UI without state-fixture hooks. Canvas checks inspect drawing
commands, not browser screenshots. A local-file browser preview was blocked by the
browser tool's URL policy, so live visual inspection was unavailable.

A headless smoke run of 1,000 episodes per agent (base seed string `42`, limit
10,000) completed 428,037 heuristic steps and 69,447 random steps. On this machine,
the measured simulation times were approximately 622 ms and 32 ms respectively;
these are observations, not performance guarantees.
