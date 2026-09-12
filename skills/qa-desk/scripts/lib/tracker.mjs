import { createGithubTracker } from './tracker-github.mjs';
import { createBeadsTracker } from './tracker-beads.mjs';

const FACTORIES = { github: createGithubTracker, beads: createBeadsTracker };

export function createTracker(config, deps) {
  const factory = FACTORIES[config.tracker];
  if (!factory) throw new Error(`unknown tracker ${config.tracker}`);
  return factory(deps);
}
