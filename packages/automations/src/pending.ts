/**
 * What a contract of phase F14c answers until it is built: the first PR of the phase brings the types, the signatures,
 * the limits and one pending test per rule (docs/automatizaciones.md §8); the builders replace each call of this and
 * delete the file with the last one.
 */
export function notBuilt(what: string): never {
  throw new Error(`@boni/automations: ${what} is not built yet (F14c)`);
}
