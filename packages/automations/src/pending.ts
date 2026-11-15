/**
 * What a contract of phase F14b answers until it is built: the first PR of the phase brings the types, the signatures
 * and one pending test per rule (docs/automatizaciones.md §8); the builder replaces each call of this and deletes the
 * file with the last one.
 */
export function notBuilt(what: string): never {
  throw new Error(`@boni/automations: ${what} is not built yet (F14b)`);
}
