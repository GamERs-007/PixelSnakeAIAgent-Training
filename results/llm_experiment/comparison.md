# Local Ollama Snake experiment

Scores use completed episodes only; budget-interrupted episodes remain in episodes.csv. Latency includes all attempted decisions, failed calls and any cold loading. Invalid rate is malformed/incomplete action responses divided by received responses; transport/API failures and fallback rates are separate in comparison.json. Different episode counts are not a matched performance comparison.

| Agent | Completed episodes | Mean score | Median | Max | Mean survival steps | Decision ms | Invalid response % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Random | 50 | 2.000 | 0.000 | 20.000 | 77.700 | 0.002 | 0.000 |
| Heuristic | 50 | 264.800 | 285.000 | 530.000 | 385.940 | 0.005 | 0.000 |
| DQN | 50 | 283.400 | 265.000 | 560.000 | 488.600 | 0.024 | 0.000 |
| Qwen | 1 | 10.000 | 10.000 | 10.000 | 412.000 | 1307.118 | 0.000 |

## Shared completed episode seeds

| Agent | Completed episodes | Mean score | Median | Max | Mean survival steps | Decision ms | Invalid response % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Random | 1 | 0.000 | 0.000 | 0.000 | 242.000 | 0.001 | 0.000 |
| Heuristic | 1 | 70.000 | 70.000 | 70.000 | 79.000 | 0.007 | 0.000 |
| DQN | 1 | 230.000 | 230.000 | 230.000 | 366.000 | 0.024 | 0.000 |
| Qwen | 1 | 10.000 | 10.000 | 10.000 | 412.000 | 1307.106 | 0.000 |

A compact state does not describe the full body or a route to safety. An LLM can follow language rules but needs a request for every move; DQN and heuristic policies make much cheaper local decisions. Schema-valid output does not guarantee a safe move or escape from loops. The LLM may be more useful for explaining episodes or selecting high-level goals. Small completed samples and one seed sequence cannot establish a reliable ranking.

## Observed behavior and runtime limit

Qwen completed seed 300000 with score 10 and 412 successful moves, then hit the 400-step no-food cutoff after repeating RIGHT turns in a four-move loop. Its second episode stopped at 46 moves and score 10 when the 600-second wall-time budget expired. This partial episode is excluded from score/survival averages.

Of 459 attempted requests, 458 returned complete, valid actions. The last request timed out at the budget boundary; its fallback was logged but not executed. Request-error/fallback-selection rates are 0.218%, and no executed move used fallback. The model was warm from a three-request pilot. Fifty episodes of similar length to the first would require about 7.5 hours; the single completed episode cannot establish a reliable ranking.
