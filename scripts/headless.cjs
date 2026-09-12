// Usage: node scripts/headless.cjs heuristic 1000 10000 42
const {RandomAgent, HeuristicAgent} = require('../js/agents.js');
const {runEpisodes} = require('../js/episode.js');
const [mode = 'heuristic', count = '100', limit = '10000', seed = '42'] = process.argv.slice(2);
if (!['random', 'heuristic'].includes(mode)) {
  console.error('Agent must be random or heuristic.');
  process.exitCode = 1;
} else {
  try {
    const started = performance.now();
    const results = runEpisodes({episodes:Number(count), maxSteps:Number(limit), seed,
      agentFactory:({seed}) => mode === 'random' ? new RandomAgent({seed}) : new HeuristicAgent()});
    const steps = results.reduce((total, result) => total + result.steps, 0);
    const elapsedMs = performance.now() - started;
    console.log(JSON.stringify({agent:mode, seed, episodes:results.length, steps,
      elapsedMs:Math.round(elapsedMs), stepsPerSecond:Math.round(steps * 1000 / elapsedMs),
      results}, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
