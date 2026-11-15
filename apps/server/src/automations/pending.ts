/**
 * What a contract of phase F14b of «Automatizaciones» answers until it is built (docs/automatizaciones.md §8): the
 * first PR of the phase brings the types, the signatures and one pending test per rule; the builder replaces each
 * call of this and deletes the file with the last one.
 */
export function notBuilt(what: string): never {
  throw new Error(`automations: ${what} is not built yet (F14b)`);
}
