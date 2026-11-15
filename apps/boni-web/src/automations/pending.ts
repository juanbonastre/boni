/**
 * The mark of a seam of «Automatizaciones» that F14b has declared and not built yet (docs/automatizaciones.md §8):
 * the first PR of the phase brings the contracts and one pending test per rule, and the PRs after it fill them in.
 */
export function notBuilt(what: string): never {
  throw new Error(`automations: ${what} is not built yet (F14b)`);
}
