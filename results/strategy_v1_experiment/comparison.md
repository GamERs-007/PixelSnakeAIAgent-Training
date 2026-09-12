# Strategy reward ablation

Both continuations start from the same original 2000-episode checkpoint and train
300 further episodes using seeds 2042–2341. Evaluation uses 100 identical held-out
seeds 400000–400099, greedy actions, the classic evaluation environment, and no
browser assistance. Weights, replay counters and old experiment outputs are preserved.

| Policy | Additional episodes | Mean score | Median score | Mean attempted steps | Mean turn rate |
|---|---:|---:|---:|---:|---:|
| Original DQN | 0 | 272.5 | 280 | 475.28 | 61.49% |
| Classic continuation | 300 | 269.0 | 260 | 415.54 | 61.90% |
| Strategy v1 continuation | 300 | 297.2 | 290 | 473.08 | 40.21% |

All three sets had zero no-food truncations. This therefore supports fewer turns
and higher mean score on these seeds, but does not prove elimination of the user's
specific trap. There was no board trace of that episode. A single training seed,
partially observed 10-number policy input, and finite evaluation limit the result.

Evaluated candidate: `models/strategy_v1/2300_model.pt`.
Control: `models/2300_model.pt`. Later UI smoke output `2301_model.pt` comes from
the classic control with one strategy episode and is NOT the evaluated candidate.
See comparison.json for all 300 episode records and checkpoint hashes. Each training
folder contains training.csv with turn rates and reward component totals.

## Strategy and rewards

Inspired by [safe food paths followed by tail escape](https://github.com/chynl/snake)
and [Hamiltonian cycles with safe shortcuts](https://johnflux.com/2015/05/02/nokia-6110-part-3-algorithms/).
The browser now simulates the shortest food path through eating and checks tail
reachability afterward; it prefers straight movement when shortest path ties allow
it. This is explicit planning assistance, not a change in the DQN weights.

The experimental reward adds `gamma * Phi(next) - Phi(current)` to classic rewards,
using BFS distance around the body, reachable space and tail connectivity. This
form follows [Ng, Harada and Russell (1999)](https://people.eecs.berkeley.edu/~pabbeel/cs287-fa09/readings/NgHaradaRussell-shaping-ICML1999.pdf).
Additional small turn/repetition penalties deliberately change the objective;
we do not claim policy invariance for the whole reward or for this partial observation.
