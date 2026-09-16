"""Small, auditable path/space shaping; no action override or hidden planner policy.

References: Ng et al. (1999) potential shaping; tail-escape Snake graph search.
The potential term telescopes. Explicit turn/revisit penalties change the objective.
"""
from collections import deque
from functools import lru_cache


@lru_cache(maxsize=16)
def neighbors(size):
    return tuple(tuple(ny * size + nx for nx, ny in ((x,y-1),(x+1,y),(x,y+1),(x-1,y))
                       if 0 <= nx < size and 0 <= ny < size)
                 for y in range(size) for x in range(size))


def geometry(snake, food, size):
    """Static, optimistic tail-vacating geometry; not a future survival guarantee."""
    cells=[y*size+x for x,y in snake]
    blocked=set(cells[1:-1])
    queue=deque([cells[0]]); distances={cells[0]:0}; adjacent=neighbors(size)
    while queue:
        point=queue.popleft()
        for other in adjacent[point]:
            if other not in blocked and other not in distances:
                distances[other]=distances[point]+1;queue.append(other)
    distance=distances.get(food[1]*size+food[0]) if food is not None else 0
    return {"food_distance":distance,"reachable_area":len(distances),"tail_reachable":cells[-1] in distances}


def potential(snake, food, size):
    data=geometry(snake,food,size)
    distance=data['food_distance']
    # Bound distance contribution in [-1,0], retain more resolution close to food.
    food_term=-min(distance if distance is not None else size*size,2*size)/(2*size)
    free=size*size-len(snake)+2
    required=max(1,min(len(snake)+1,free))
    space=min(1.,data['reachable_area']/required)
    return food_term + .25*space + .25*data['tail_reachable']


class StrategyReward:
    def __init__(self, gamma=.99):
        self.gamma=gamma
        self.visits={}

    def reset(self, env):
        self.visits={tuple(env.snake):1}

    def reward(self, env, action, base_reward, before_potential, ate):
        # True terminal absorbing states have Phi=0. Time-limit truncations bootstrap
        # in DQN, so keep their final-state potential instead of erasing it.
        after=0. if env._terminated else potential(env.snake,env.food,env.board_size)
        shaping=self.gamma*after-before_potential
        turn=-.005 if action != 0 and not env._terminated else 0.
        signature=tuple(env.snake)
        if ate:self.visits={}
        count=self.visits.get(signature,0)
        repeat=-.05*min(count,4) if count and not env._terminated and not ate else 0.
        self.visits[signature]=count+1
        timeout=-2. if env._truncated else 0.
        parts={"base":float(base_reward),"potential":shaping,"turn":turn,"repeat":repeat,"timeout":timeout}
        return sum(parts.values()),parts
