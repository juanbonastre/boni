/**
 * Small named JSON files on the device: offline queue, last chart answers, the widget list. On the desktop they
 * are files in `~/.local/share/boni/store/` written by the main process (the same files the first Boni client
 * used, so nothing is lost when it is replaced); in a browser, localStorage.
 */
export interface TextStore {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export class MemoryStore implements TextStore {
  files = new Map<string, string>();
  async read(name: string) {
    return this.files.get(name) ?? null;
  }
  async write(name: string, text: string) {
    this.files.set(name, text);
  }
  async remove(name: string) {
    this.files.delete(name);
  }
}

export async function readJson<V>(store: TextStore, name: string): Promise<V | null> {
  const text = await store.read(name);
  if (text == null) return null;
  try {
    return JSON.parse(text) as V;
  } catch {
    return null;
  }
}

/** Runs async jobs one after the other (read-modify-write of one file must never interleave). */
export class Serial {
  private last: Promise<unknown> = Promise.resolve();
  run<V>(job: () => Promise<V>): Promise<V> {
    const next = this.last.then(job, job);
    this.last = next.catch(() => undefined);
    return next;
  }
}
