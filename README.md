# PixelSnake

Browser Snake, a numeric Gymnasium environment, a from-scratch PyTorch DQN, Strategy reward shaping, optional full-board safety assistance, Ultimate dense-board control, and a local Ollama/Qwen experiment. The implementation and evidence are separated below; every numerical result links to its experiment source.

## Current fresh re-evaluation

**CURRENT FRESH RE-EVALUATION - experiment started 2026-09-15.** Frozen checkpoints, no retraining. Raw policies: 1,200 episodes total. Browser assistance: 160 episodes. Ultimate: 20 before + 20 after, using the same seeds. The fixed Ultimate controller won 20/20 tested episodes; this is planner-assisted regression evidence, not a learned guarantee. [Sources: [results/full_recheck_2026_09_15/summary.json](results/full_recheck_2026_09_15/summary.json), [protocol](results/full_recheck_2026_09_15/protocol.json).]

| Policy | n | Mean score | SD | Median | Min / max | 95% mean CI | Survival | Turn % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Random | 300 | 1.23 | 3.68 | 0.00 | 0 / 20 | [0.83, 1.67] | 68.48 | 65.17 |
| Heuristic | 300 | 279.97 | 106.29 | 280.00 | 60 / 610 | [268.77, 292.43] | 422.74 | 13.52 |
| Classic | 300 | 276.07 | 103.47 | 270.00 | 20 / 550 | [264.73, 287.43] | 477.37 | 62.45 |
| Strategy | 300 | 291.90 | 115.48 | 290.00 | 20 / 670 | [278.80, 305.17] | 455.32 | 40.33 |

Raw Gymnasium seeds are 500000-500099, 501000-501099 and 502000-502099, 100 per policy per block. All use classic evaluation reward, 400 no-food limit and 10,000 attempted-step cap. Score is 10 per food; survival counts successful moves. Strategy minus Classic mean score is **15.83**, paired bootstrap 95% CI **[-1.80, 33.83]**; the interval includes zero. Do not infer universal superiority. [Source: [raw episode CSV](results/full_recheck_2026_09_15/raw_episodes.csv); `scripts/recheck_raw.py`; `scripts/generate_report_figures.py`, `stats`, `ci`.]

![Fresh raw-policy score confidence intervals](results/full_recheck_2026_09_15/figures/13_raw_confidence_intervals.png)

Full technical report: [PDF](reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.pdf) / [editable Markdown](reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.md). [Experiment amendments and negative results](results/full_recheck_2026_09_15/experiment_notes.json). [Pre-recheck README, preserved verbatim](results/full_recheck_2026_09_15/baseline/README.md).

## Portable startup / 移动文件夹与换电脑

Windows: double-click **[Start-PixelSnake.cmd](Start-PixelSnake.cmd)** in the extracted project folder. It checks Python, prepares `.venv` if needed, and opens the local game page. Keep the startup terminal open while playing. If already running from the same folder, it opens that server instead. [Source: `start-local.ps1`; `run_local.py`, `prepare_environment`, `existing_server`, `main`; `rl/web_server.py`, `main`.]

Windows 用户请双击项目目录内的 **Start-PixelSnake.cmd**，在自动打开的页面中选择模型；游玩期间保持启动窗口打开。直接双击 HTML 或使用普通静态网页服务器，无法读取 Python 模型接口。

- Install Python **3.12 or newer** with PATH enabled on a new computer; 3.12 is the tested version. First dependency installation needs internet. The launcher installs `rl/requirements.txt` when required modules are missing. Qwen additionally needs its separately installed local Ollama model. [Source: `start-local.ps1`; `run_local.py`, `python_works`, `prepare_environment`; `rl/llm_agent.py`, `OllamaClient`.]
- Copy the complete project, including `models/` and its `.pt` files. Omit `.venv` when making a ZIP: virtual environments contain machine-specific Python paths. A broken copied environment is preserved as `.venv-backup-*` and rebuilt using an available Python installation. No model files are moved or replaced by setup. [Source: `run_local.py`, `prepare_environment`.]
- Startup, model discovery, static files and training outputs resolve from the project location, independent of folder name, drive letter or launch working directory. Model selections use paths relative to `models/`. [Source: `start-local.ps1`, `$PSScriptRoot`; `run_local.py`, `ROOT`, `main`; `rl/web_server.py`, `ROOT`, `LocalApp`, `model_path`, `start_training`, `Handler.do_GET`.]
- If port 8765 is occupied by another service or another project copy, run `powershell -ExecutionPolicy Bypass -File .\start-local.ps1 -Port 8766`. To skip opening a browser, add `-NoBrowser`. A Python entry point is also available: `python run_local.py --port 8766 --no-browser`. [Source: `start-local.ps1`; `run_local.py`, `main`.]

## Architecture and language boundaries

| Source | Implemented responsibility |
| --- | --- |
| `index.html`, `PixelSnake.html`, `css/` | Browser entry points and appearance; matching HTML entry files. |
| `js/game.js`: `SnakeGame`, `getCollisionCause`, `randomGenerator` | Rendering-independent 20x20 engine, state snapshots, food, collision, score and seeded PRNG. |
| `js/agents.js`: `HumanAgent`, `RandomAgent`, `HeuristicAgent` | Queued human input and baseline action policies. |
| `js/episode.js`: `EpisodeRunner`, `runEpisodes` | Shared episode lifecycle and headless execution. |
| `js/safety.js`: `SafetyGuard.choose`, `safeFoodPath`, `joinPlan` | Optional full-board planner and Ultimate recovery / ordered traversal. |
| `js/dqn-agent.js`: `DenseQNetwork`, `BrowserDQNAgent` | Float32 browser forward pass using exported PyTorch weights; no per-move HTTP after loading. |
| `js/local-ai.js`, `js/main.js`, `js/input.js`, `js/renderer.js` | Local-service requests, controller/UI integration, input and Canvas drawing. |
| `rl/snake_env.py`: `SnakeEnv` | Gymnasium numeric environment with classic or Strategy reward. |
| `rl/dqn/model.py`, `agent.py`, `replay_buffer.py` | PyTorch network, vanilla DQN training, uniform replay and checkpoints. |
| `rl/dqn/train.py`, `train_session.py`, `evaluate.py`, `evaluation.py` | Original training, resumable UI jobs, raw baseline evaluation and evaluation helpers. |
| `rl/strategy_reward.py`, `rl/model_profiles.py`, `rl/compare_strategy.py` | Reward shaping, scheme mapping and historical continuation comparison. |
| `rl/llm_agent.py`, `rl/evaluate_llm.py` | Local Ollama text policy, strict output validation and budgeted LLM experiment. |
| `rl/web_server.py`: `LocalApp` | Loopback HTTP server, model exports, Python inference, training subprocesses and status. |
| `scripts/recheck_raw.py`, `evaluate-browser.cjs` | Fresh frozen-model evaluation and browser-protocol telemetry. |
| `scripts/generate_report_figures.py`, `build_recheck_documents.py`, `render_recheck_report.py` | Regenerate statistics, figures, documentation and report from saved data. |
| `tests/`, `rl/test_*.py`, `rl/dqn/test_dqn.py` | JavaScript engine/UI/planner and Python environment/training/API/parity tests. |
| `models/`, `results/`, `archive/`, `reports/` | Active checkpoints, recorded experiments, preserved earlier files and this report. |

JavaScript owns browser gameplay, input/rendering, local dense-network inference, baseline controllers and full-board assistance. Python owns Gymnasium, PyTorch training/evaluation/checkpointing, reward shaping, Ollama integration, HTTP serving and scientific reporting. There is no Python training running inside the browser. [Sources: files/functions in the table above.]

## Environment and exact state features

The default board is 20 x 20. Reset creates a three-cell snake with head (9,10), facing right; food is sampled uniformly from empty cells. Score increases by 10 per food, independently of training reward. A full board therefore has length 400, 397 foods and score 3,970. [Source: `rl/snake_env.py`, `SnakeEnv.reset`, `_spawn_food`, `step`; `js/game.js`, `SnakeGame`.]

Gymnasium uses `Discrete(3)`: 0 = straight, 1 = left, 2 = right, relative to the current direction. JavaScript uses absolute `UP`, `DOWN`, `LEFT`, `RIGHT`; reversal is excluded from legal policy actions and ignored by the engine when supplied directly. [Source: `SnakeEnv.ACTION_TURNS`; `js/game.js`, `getLegalActions`, `directionFor`.]

The observation is a float32 `Box` of shape (10,). Lower bounds are [0,0,0,0,0,0,0,-1,-1,0]; all upper bounds are 1. Features, in exact order:

| Index | Feature | Definition |
| --- | --- | --- |
| 0 | danger_straight | Next straight move collides, including correct departing-tail handling |
| 1 | danger_left | Next relative-left move collides |
| 2 | danger_right | Next relative-right move collides |
| 3 | direction_up | One-hot current direction |
| 4 | direction_right | One-hot current direction |
| 5 | direction_down | One-hot current direction |
| 6 | direction_left | One-hot current direction |
| 7 | food_dx | (food.x - head.x) / (board_size - 1), or 0 without food |
| 8 | food_dy | (food.y - head.y) / (board_size - 1), or 0 without food |
| 9 | no_food_fraction | min(1, steps_since_food / max_steps_without_food) |

[Source: `rl/snake_env.py`, `SnakeEnv.__init__`, `OBSERVATION_NAMES`, `_observation`; browser equivalent: `js/dqn-agent.js`, `observation`.]

Classic rewards are +10 on food, -10 on collision and -0.01 on ordinary successful movement. They are mutually exclusive on each tick. Wall/self collision or board-full completion is `terminated`; 400 consecutive no-food moves is `truncated` on the default board. Training/raw evaluation runners additionally cap episodes at 10,000 attempted moves. Collisions increment attempted steps but not successful survival steps. Moving into the departing tail is legal on a non-eating step. [Source: `SnakeEnv.step`, `_collision`, `_info`; `rl/dqn/train.py`, `train`; `scripts/recheck_raw.py`, `main`.]

The browser engine has no intrinsic no-food cutoff. Safety evaluation applies a 3,000-step external cap; Ultimate applies a 100,000-step cap and 10,000 no-food cutoff, with a separate 400-step no-food assertion after genuine lock. These different protocols must not be pooled. [Source: `js/game.js`, `SnakeGame.step`; `scripts/evaluate-browser.cjs`, `run`; `protocol.json`.]


## DQN and checkpoint system

The network is `Linear(10,128) -> ReLU -> Linear(128,128) -> ReLU -> Linear(128,3)`, with 18,307 trainable parameters. This is vanilla DQN, not Double DQN, dueling DQN or a recurrent model. The input has no pixels, body coordinates, recurrent memory or image encoder. [Source: `rl/dqn/model.py`, `QNetwork`; `rl/dqn/agent.py`, `DQNAgent.train_batch`.]

| Setting | Actual default | Source |
| --- | --- | --- |
| Replay | 50,000 transitions; uniform sample without replacement | `ReplayBuffer`, `sample` |
| Batch | 64 | `DQNConfig.batch_size` |
| Optimizer | Adam, learning rate 0.0003 | `DQNAgent.__init__` |
| Discount | 0.99 | `DQNConfig.gamma` |
| Exploration | epsilon 1.0 to 0.05, linear over 100,000 environment steps, then fixed | `DQNAgent.epsilon` |
| First learning | at least 1,000 environment steps and sufficient replay | `DQNAgent.observe` |
| Training interval | every 4 environment steps | `DQNConfig.train_every` |
| Target network | hard copy every 500 optimizer updates | `DQNAgent.train_batch` |
| Loss | SmoothL1Loss / Huber | `DQNAgent.__init__` |
| Gradient clipping | global norm 10 | `DQNAgent.train_batch` |
| Device / threads | CPU, one PyTorch thread | `seed_everything` |

The target is `y = r + gamma * (1 - terminated) * max_a Q_target(next_state,a)`. Only the chosen action's online Q-value enters the loss. Truncation continues to bootstrap. Greedy evaluation calls `choose_action(..., explore=False)`. [Source: `rl/dqn/agent.py`, `bellman_targets`, `train_batch`, `choose_action`.]

Checkpoint format 1 stores config, online/target state dicts, optimizer state, counters and metadata. Format 2 additionally stores replay arrays and replay RNG, agent RNG, Torch/Python/NumPy RNG states. `torch.load(..., map_location="cpu", weights_only=True)` restores supported formats; saving uses a temporary file followed by replacement. Format 1 cannot provide exact replay/RNG resume. [Source: `DQNAgent.save`, `load`; `ReplayBuffer.state_dict`, `load_state_dict`.]

UI jobs save dated, microsecond-resolved filenames under `models/classic`, `models/strategy` or `models/ultimate`, including cumulative episodes. Resuming inherits the source training seed; numeric reward changes reset replay. The original trainer saves best validation and latest checkpoints; original filenames are preserved in `archive/github-original-models/`. Browser exports include only supported dense weights and the allowed inference flag. [Source: `rl/dqn/train_session.py`, `train_session.save`; `rl/dqn/train.py`, `train`; `rl/web_server.py`, `LocalApp.browser_model`.]


### Frozen model files

**Classic**: `models/classic/2026-09-10_21-39-17-351796_ep2000.pt`

SHA-256: `14defd74f5b5907cfd6317989754526f735a743211d3944082f6df6eba69a95b`

**Strategy**: `models/strategy/2026-09-11_00-27-06-910520_ep2300.pt`

SHA-256: `42a4c255456ffd5285b04fd2c7dacd582e9e4cd50d9022e347e8043ea16f3141`

**Ultimate**: `models/ultimate/2026-09-12_01-30-56-963414_ep2300.pt`

SHA-256: `a407513272f41a31566ca0acb4ff64aca17bdf016d7132c2a95e44de4cd2f524`

[Source: `results/full_recheck_2026_09_15/metadata.json`; byte hashes checked against actual files.]

## Classic, Strategy and Ultimate

**Classic** uses the classic rewards and the 2,000-episode frozen checkpoint. **Strategy** maps to `strategy_v1` numeric rewards and the 2,300-episode checkpoint, continued for 300 episodes from the original model. **Ultimate** maps to the same Strategy numeric reward, adding `dense_board_sweep_above_half` at browser inference. The inspected Strategy and Ultimate online tensors are identical; the different checkpoint hashes do not imply independently trained policies. [Source: `rl/model_profiles.py`, `training_reward`, `inference_rules`; checkpoint inspection in `metadata.json`; historical `results/strategy_v1_experiment/comparison.json`.]

Strategy adds `gamma * Phi(next) - Phi(current)` to the base reward. Its potential is `-min(d,2N)/(2N) + 0.25*min(1,A/R) + 0.25*T`, where N is board width, d is static BFS food distance (N*N if unreachable), A is reachable area, T indicates reachable tail and `R=max(1,min(length+1,N*N-length+2))`. Geometry treats the tail as vacating. True terminal next potential is zero; truncated next potential is retained. Additional penalties are -0.005 for a nonterminal turn, -0.05 times min(previous exact-body visits,4) for repeats without eating, and -2 for timeout. Eating resets visit memory. These extra penalties change the objective; the whole reward is not a policy-invariant shaping guarantee. [Source: `rl/strategy_reward.py`, `geometry`, `potential`, `StrategyReward.reward`.]


## Anti-trap assistance and Ultimate traversal

Assistance sees the entire snake and board. It is privileged planning, separate from the ten-feature learned policy. `safeFoodPath` runs BFS with straight-first tie breaking, simulates the full route against the moving snake, and verifies tail reachability after eating. Cached actions are accepted only while the snake signature and food match. Without a plan, `assess` checks immediate collision, reachable space and tail access; ordinary assistance also uses recent head visits. [Source: `js/safety.js`, `safeFoodPath`, `assess`, `SafetyGuard.choose`.]

Ultimate requests dense control strictly above half occupancy: length >200 on this board. The intended cycle traverses rows while reserving column zero for the return. `cycleSpan` sums forward modular index differences from tail to head. A span below 400 establishes cyclic body order. Once ordered, the controller uses the exact successor (`advance = 1 mod 400`), never overtakes the tail, and preserves ordering on both normal movement and growth. Requesting dense control is distinct from successfully locking. [Source: `fillAction`, `cycleIndex`, `cycleSpan`, `orderedCycleAction`, `SafetyGuard.choose`.]

**Reproduced bug and fix.** The old controller's one-step winding preference and 80-position head window could settle into long tail-following recovery cycles. The measured failures never reached true ordered lock. The fixed `joinPlan` searches moving-body configurations for up to 400 depths, retaining at most 128 candidates per depth and suppressing duplicate bodies. Plans are ranked by cycle span. Lookahead after known food does not assume a new spawn: execution stops at that food and immediately replans against the actual next spawn. Each cached move is checked against the real snake. Recovery records complete body visits for up to four board laps before falling back to one-step safety. Search exhaustion remains recovery, never a claimed lock. This is bounded beam search, not a complete solver. [Source: `js/safety.js`, `joinPlan`, `SafetyGuard.reset`, `choose`; old source: `results/full_recheck_2026_09_15/baseline/js/safety.js`.]

Telemetry reports food/recovery/ordered/terminal mode, traversal index, intended forward advance, repeated ordered state, unexpected fallback, food count, board-full status and collision. The evaluator independently checks actual index advancement and full-state recurrences, and records first request/lock, recovery and ordered moves, collision/no-food outcomes and completion. [Source: `SafetyGuard.telemetry`; `scripts/evaluate-browser.cjs`, `run`.]


### Fresh browser assistance results

| Policy | Assist | n | Mean score | SD | Survival | Wins | Step caps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Random | OFF | 20 | 1.50 | 3.66 | 82.15 | 0 | 0 |
| Random | ON | 20 | 1247.00 | 59.39 | 3000.00 | 0 | 20 |
| Heuristic | OFF | 20 | 282.50 | 106.86 | 430.30 | 0 | 0 |
| Heuristic | ON | 20 | 1237.00 | 47.36 | 3000.00 | 0 | 20 |
| Classic | OFF | 20 | 311.50 | 124.36 | 552.40 | 0 | 0 |
| Classic | ON | 20 | 1273.00 | 51.51 | 3000.00 | 0 | 20 |
| Strategy | OFF | 20 | 281.00 | 91.47 | 443.70 | 0 | 0 |
| Strategy | ON | 20 | 1288.00 | 63.13 | 3000.00 | 0 | 20 |

Each row uses seeds `safety-0` through `safety-19`, and action seeds `agent-0` through `agent-19`; cap 3,000. Assistance ON is the same full-board guard for each base policy. This experiment does not activate Ultimate. [Source: [results/full_recheck_2026_09_15/safety_episodes.csv](results/full_recheck_2026_09_15/safety_episodes.csv); `scripts/evaluate-browser.cjs`.]

![Assistance score comparison](results/full_recheck_2026_09_15/figures/07_safety_scores.png)

### Fresh Ultimate results and failure analysis

| Metric | Old controller | Fixed controller |
| --- | --- | --- |
| Episodes | 20 | 20 |
| Reached >50% | 20 | 20 |
| Genuinely locked | 9 | 20 |
| Full-board wins | 9 | 20 |
| Mean score | 3847.00 | 3970.00 |
| Mean maximum occupancy (%) | 96.92 | 100.00 |
| Mean attempted moves | 25956.45 | 16838.15 |
| Ordered moves (total) | 54234 | 198316 |
| Recovery moves (total) | 333626 | 7178 |
| Repeated states (total) | 102144 | 0 |
| Largest detected recurrence period | 388 | 0 |
| Repeated ordered states | 0 | 0 |
| Ordered progress errors | 0 | 0 |
| Unexpected ordered fallbacks | 0 | 0 |
| Collisions after >50% | 0 | 0 |
| No-food endings after >50% | 11 | 0 |
| Mean >50%-to-win moves, winners only | 9695.67 | 10274.70 |

The 20 integer seeds are 0-19. Maximum episode length is 100,000, with a 10,000 no-food cutoff. Ordered moves must advance one traversal index; 400 moves without food after lock is treated as a bug. Before/after refer to the controller, not different learned weights. [Source: [before episodes](results/full_recheck_2026_09_15/ultimate_before_episodes.csv), [after episodes](results/full_recheck_2026_09_15/ultimate_after_episodes.csv), `scripts/evaluate-browser.cjs`.]

![Ultimate outcomes](results/full_recheck_2026_09_15/figures/10_ultimate_outcomes.png)
![Actual seed 10 progression](results/full_recheck_2026_09_15/figures/11_ultimate_progression.png)

## Baselines

Python `RandomAgent` samples one of three relative actions uniformly, including unsafe choices. Python `HeuristicAgent` filters immediate dangers and chooses the action reducing Manhattan food distance, preferring straight then up/down/left/right. It uses only the ten features. JavaScript Random samples legal non-reversing absolute actions; JavaScript Heuristic checks immediate collision and ranks Manhattan distance with the same straight/stable-order preference. Neither baseline learns. [Source: `rl/dqn/evaluate.py`, `RandomAgent`, `HeuristicAgent`; `js/agents.js`, corresponding classes.]

## Local Qwen agent

The implemented agent is a local, text-only Ollama client, not a locally implemented transformer architecture. The configured tag is `qwen3.8:27b-q4_K_M`; saved Ollama metadata identifies family `qwen35`, 27.3B parameters and Q4_K_M quantization. The repository does not establish the underlying transformer's layer architecture or validate the tag as an official model release name. [Source: `rl/llm_agent.py`, `LLMAgent`; `results/llm_experiment/config.json`, saved model metadata.]

`structured_state` converts the numeric observation into three boolean danger flags, an absolute food-direction category, and the current direction. It omits food distance magnitude, no-food fraction, full body, pixels and history. The system prompt requests one relative move, explains left/right/straight and dangers, and prefers straight when tied. The user message is compact JSON; for example `{"danger_straight":false,"danger_left":true,"danger_right":false,"food_direction":"upper_right","current_direction":"right"}` illustrates the schema, not a measured decision. Output must be exactly `{"action":"STRAIGHT"}`, `{"action":"LEFT"}` or `{"action":"RIGHT"}`. [Source: `structured_state`, `SYSTEM_PROMPT`, `ACTION_SCHEMA`, `LLMAgent.choose_action`.]

Requests use `/api/chat`, no streaming, `think:false`, temperature 0, seed, 32 generated-token limit, context 2,048 and keep-alive 5 minutes. The client checks installed local GGUF weights, loopback-only addresses, no redirects/proxy and no automatic download. Validation rejects duplicate/extra keys, invalid enum/type, malformed JSON, incomplete or token-limited responses. Request failures or invalid outputs fall back to the first safe relative action in straight/left/right order, then straight if all blocked. A valid but dangerous model action executes unchanged. [Source: `OllamaClient`, `validate_action`, `safe_fallback`, `LLMAgent.choose_action`.]

**HISTORICAL / ORIGINAL EXPERIMENT only:** the 600-second Qwen budget completed one episode and part of another. The completed episode scored 10 with 412 successful moves and a no-food ending. Across 459 attempted decisions, average latency was 1,307.12 ms; 458 were valid and one request failed. The failed final request's fallback was recorded but not stepped after budget expiry. Baselines completed 50 episodes each (seeds 300000-300049): Random mean 2.00, Heuristic 264.80, DQN 283.40. On the single matched completed seed, their scores were 0, 70 and 230 versus Qwen's 10. This is insufficient for a reliable ranking of Qwen. No fresh Qwen inference was performed in this recheck. [Source: `results/llm_experiment/comparison.json`, `episodes.csv`, `Qwen_decisions.jsonl`; `rl/evaluate_llm.py`.]


## Historical / original experiment

Original training completed 2,000 episodes, 170,682 environment steps and 42,421 optimizer updates in **39.8630 seconds** on the recorded setup. The time is the trainer's recorded elapsed field, not a new timing measurement. Strategy continuation added 300 episodes; the historical combined train-and-evaluate duration was 24.0879 seconds, not training-only time. No separate Ultimate training run is evidenced by its identical online weights. [Sources: `results/training_status.json`; `results/strategy_v1_experiment/comparison.json`; `DQNAgent.load`.]

Original evaluation used seeds 200000-200099, 100 episodes per policy: DQN mean 306.30, median 300, maximum 640; Heuristic mean 279.00, median 285, maximum 580; Random mean 1.40, median 0, maximum 10. These historical figures are not the new 300-episode results. [Source: `results/evaluation.json`, `results/evaluation_episodes.csv`.]

Historical continuation comparison (100 seeds 400000-400099): original checkpoint 272.50 mean score; Classic plus 300 episodes 269.00; Strategy plus 300 episodes 297.20. Turn rates were 61.49%, 61.90%, 40.21%, respectively. The extra Classic continuation checkpoint is not present among the three active models, so it was not silently substituted into the fresh comparison. [Source: `results/strategy_v1_experiment/comparison.json`.]

Original training CSVs/plots, validation, Qwen decisions, failed/interrupted training jobs and earlier browser evaluations remain under `results/`. Earlier working variants remain under `archive/development-variants/`, with their migration manifest. Original GitHub model paths are preserved as files in `archive/github-original-models/` and in Git history. [Source: directory inventory; `results/full_recheck_2026_09_15/historical_hashes.json`.]

## Reproducibility and commands

```powershell
# From the repository root; Python 3.12 and Node 24 were used.
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r rl/requirements.txt
.venv/Scripts/python.exe -m rl.web_server --port 8765
# Open http://127.0.0.1:8765 ; select DQN + checkpoint and optional assistance.

# Reproduce frozen evaluation into a NEW directory (existing data is protected).
$run = 'results/my_recheck'
New-Item -ItemType Directory -Force $run
Copy-Item results/full_recheck_2026_09_15/protocol.json $run
Copy-Item results/full_recheck_2026_09_15/metadata.json $run
Copy-Item results/full_recheck_2026_09_15/*_weights.json $run
.venv/Scripts/python.exe -B scripts/recheck_raw.py $run
node scripts/evaluate-browser.cjs $run safety final
node scripts/evaluate-browser.cjs $run ultimate final
# Before-controller comparison uses the preserved source, not git checkout.
$env:SNAKE_SAFETY_SOURCE=(Resolve-Path results/full_recheck_2026_09_15/baseline/js/safety.js).Path
node scripts/evaluate-browser.cjs $run ultimate before_verified
Remove-Item Env:SNAKE_SAFETY_SOURCE

# Test commands (the recorder additionally saves separate per-pass logs).
.venv/Scripts/python.exe -B -m unittest discover -s rl -p 'test_*.py'
node --test tests/*.test.cjs
node --test tests/ultimate-regression.test.cjs
node scripts/headless.cjs heuristic 20 3000 recheck-smoke

# Regenerate the checked-in figures, summary, README and editable report.
.venv/Scripts/python.exe -B scripts/generate_report_figures.py
.venv/Scripts/python.exe -B scripts/build_recheck_documents.py
# PDF rendering uses reportlab==4.4.9; verification uses pypdf==6.10.0.
.venv/Scripts/python.exe -m pip install reportlab==4.4.9 pypdf==6.10.0
.venv/Scripts/python.exe scripts/render_recheck_report.py
.venv/Scripts/python.exe scripts/verify_report_pdf.py
.venv/Scripts/python.exe -B scripts/audit_recheck.py
```


Baseline Git commit: `5c956389ba349739b861e8d7970809a28cf6571f`. Implementation commit: `0f443f177ee00b666b17906aca6a9b41b69f1672`. Repository: `https://github.com/GamERs-007/PixelSnakeAIAgent-Training.git`, branch `main`. At the start the project root had no `.git`; the existing upload clone was recovered, and its Git history was copied to this root. Existing local profile/UI changes preceded this recheck; the exact starting source hashes are in `metadata.json`. [Source: `results/full_recheck_2026_09_15/metadata.json`; recorded Git inspection.]

Environment: Python 3.12.14, Node v24.19.0, PyTorch 2.14.0+cpu, NumPy 2.5.3, Gymnasium 1.3.0, matplotlib 3.11.1; Windows 11, AMD Ryzen 7 9800X3D, CPU inference, one Torch thread. Training seeds Python/NumPy/Torch, enables deterministic Torch algorithms, and uses episode-specific environment seeds. JavaScript seeded engines own separate streams; unspecified seeds use `Math.random`. [Sources: metadata; `rl/dqn/agent.py:seed_everything`; `train`; `js/game.js:randomGenerator`.]

### Independent evaluation blocks

| Policy | 500000-500099 | 501000-501099 | 502000-502099 | SD of 3 block means |
| --- | --- | --- | --- | --- |
| Random | 1.10 | 1.90 | 0.70 | 0.61 |
| Heuristic | 276.50 | 291.40 | 272.00 | 10.15 |
| Classic | 286.70 | 282.50 | 259.00 | 14.93 |
| Strategy | 295.60 | 294.00 | 286.10 | 5.09 |

These are independent evaluation seed blocks for the same checkpoints, not three independent training runs. The figures use sample SD and 2,000 deterministic bootstrap resamples (seed 9152026). [Source: `scripts/generate_report_figures.py`; summary JSON.]

### Additional raw metrics

| Policy | Food mean | Attempts mean | Terminated | Truncated | Wall | Self | No food | Wins |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Random | 0.12 | 69.48 | 300 | 0 | 297 | 3 | 0 | 0 |
| Heuristic | 28.00 | 423.74 | 300 | 0 | 3 | 297 | 0 | 0 |
| Classic | 27.61 | 478.37 | 300 | 0 | 29 | 271 | 0 | 0 |
| Strategy | 29.19 | 456.32 | 300 | 0 | 20 | 280 | 0 | 0 |

All metrics and individual records are retained in the [machine-readable summary](results/full_recheck_2026_09_15/summary.json) and CSV files. [Source: `results/full_recheck_2026_09_15/raw_episodes.csv`.]

## Tests and verification

Three consecutive full passes each completed **64 Python tests and 97 JavaScript tests**, with no failures. Two additional deterministic runs each passed all 10 Ultimate regression tests. A fourth final full pass also passed 64 Python and 97 JavaScript tests, recorded separately in `tests_final.json`. The JavaScript suite includes DOM/Canvas-stub integration tests for the shipped browser scripts; the shipped headless runner also executed 20 heuristic episodes. [Source: `results/full_recheck_2026_09_15/tests_main.json`, `tests_final.json`, `logs/regression-extra-1.log`, `logs/regression-extra-2.log`, `headless_smoke.json`; `scripts/recheck_tests.py`.]

A separate real-browser smoke test discovered the three models, loaded Ultimate, played with assistance in headless mode, displayed a full-board win (score 3,970, length 400, 397 foods, 17,175 successful moves), and restored board rendering. No console warnings/errors were captured. This unseeded UI check is excluded from fixed-seed experiment statistics. [Source: `results/full_recheck_2026_09_15/browser_smoke.json`, observed browser UI.]

The new tests cover 2,500 aligned food placements (lengths 201,250,300,350,399; five head indices; every unoccupied food cell), 25 growth-to-full-board trajectories, legal tail departure, wraparound, reset/pending behavior and safe recovery without a false lock. The production-engine seed-10 regression **fails on the preserved old implementation and passes on the fixed implementation**. Failed development tests and evaluator corrections are retained in `logs/` and `experiment_notes.json`. [Source: `tests/ultimate-regression.test.cjs`; `logs/regression-old-final.log`; final suite logs.]

All three actual trained checkpoints were compared on 1,000 identical snapshots each: observations and greedy actions matched exactly. Maximum absolute Q differences were 0.00000191 (Classic) and 0.00000572 (Strategy/Ultimate). The trained-model check uses rtol=1e-5, atol=1e-5; the original random-network unit test retains its stricter atol=1e-6. [Source: `scripts/recheck_raw.py`, `parity`; `trained_parity.json`; `rl/test_browser_dqn.py`.]


## Artifacts

- [All fresh raw results and logs](results/full_recheck_2026_09_15/)
- [Figure manifest: 13 PNGs plus 13 vector PDFs](results/full_recheck_2026_09_15/figure_manifest.json)
- [Machine-readable summary](results/full_recheck_2026_09_15/summary.json)
- [Historical file/checkpoint hash manifest](results/full_recheck_2026_09_15/historical_hashes.json)
- [Supervisor report PDF](reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.pdf) and [editable source](reports/Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report.md)
- [Audit script](scripts/audit_recheck.py), [test recorder](scripts/recheck_tests.py), [plot generator](scripts/generate_report_figures.py)

## Limitations and planned work

The DQN input is partially observed; distant body geometry is absent. Full-board planner results cannot be credited to learned reasoning. Only one original training seed and its continuation are represented, and evaluation blocks are not independent training replications. Classic has 2,000 training episodes while Strategy has 2,300, so this frozen-checkpoint comparison does not isolate reward shaping from extra training. [Source: `SnakeEnv._observation`; checkpoint metadata; `protocol.json`.]

The 20 Ultimate seeds were used during development and are regression evidence, not an untouched holdout estimate. Although all final episodes won, there is no universal recovery guarantee: 9 of 11 already near-full old loop snapshots did not eat within a 1,600-step diagnostic, while all stayed collision-free. The bounded search may fail, its body-only deduplication sacrifices search completeness, and its synchronous execution can delay rendering. Maximum measured decision latency was 1,671.22 ms in the final 20 episodes under concurrent test workload; this is an observed run maximum, not a platform performance guarantee. [Source: `logs/fixture-probe-final.log`; `scripts/probe-fixtures.cjs`; `ultimate_final.json`; `joinPlan`.]

Python uses NumPy food RNG; JavaScript uses FNV-1a seed hashing followed by Mulberry32. Equal numeric seed values do not produce equal cross-language episodes. The parity test compares identical snapshots, not independent food streams. Qwen has only historical, budget-limited evidence. Asynchronous planner execution, broader untouched Ultimate seed sets, independent training replications and guaranteed recovery from arbitrary dense bodies are future work, **not implemented or demonstrated** here. [Source: `SnakeEnv._spawn_food`, `js/game.js:randomGenerator`; `trained_parity.json`; `experiment_notes.json`.]


## Resume-ready factual summary

Implemented a browser Snake platform and a Gymnasium/PyTorch vanilla DQN with a 10-feature observation, a 10-128-128-3 network, replay and target-network training; evaluated frozen policies on 1,200 fresh held-out episodes. Added full-board planning and moving-body recovery for Ultimate, validated with 2,500 aligned food placements and 20 fixed-seed full-board completions; maintained Python/JavaScript inference parity and repeated automated testing. These claims describe implemented components and measured runs; they do not claim that the raw DQN solved Snake. [Sources: source files, fresh CSVs and test logs cited above.]
