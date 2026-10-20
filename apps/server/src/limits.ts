/**
 * Limits on logging in (phase 6, before the server is reachable from the internet): failed attempts per
 * user and per address, and attempts overall. A user who is locked out keeps every session already
 * open (devices that are logged in go on working); only new logins wait. Kept in memory: a restart
 * forgets them, which is fine (an attacker cannot restart the server).
 */
export interface LoginLimits {
  /** Failed logins of one user before new ones wait. */
  perUser: number;
  /** Failed logins from one address before new ones wait. */
  perAddress: number;
  /** Over this window (ms) failures are counted, and for this long a locked name or address waits. */
  windowMs: number;
  /** Login attempts per minute from anyone (a brake on spraying many names). */
  perMinute: number;
}

export const DEFAULT_LIMITS: LoginLimits = {
  perUser: 5,
  perAddress: 10,
  windowMs: 15 * 60_000,
  perMinute: 30,
};

export class LoginGuard {
  private failures = new Map<string, number[]>();
  private attempts: number[] = [];
  private readonly limits: LoginLimits;
  private readonly now: () => number;

  constructor(limits: LoginLimits = DEFAULT_LIMITS, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  private recent(key: string): number[] {
    const since = this.now() - this.limits.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > since);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Whether a login for `user` from `address` may be tried now (it also counts the attempt). */
  allow(user: string, address: string): boolean {
    const now = this.now();
    this.attempts = this.attempts.filter((t) => t > now - 60_000);
    if (this.attempts.length >= this.limits.perMinute) return false;
    this.attempts.push(now);
    return (
      this.recent(`u:${user.toLowerCase()}`).length < this.limits.perUser &&
      this.recent(`a:${address}`).length < this.limits.perAddress
    );
  }

  failed(user: string, address: string): void {
    const now = this.now();
    for (const key of [`u:${user.toLowerCase()}`, `a:${address}`]) {
      this.failures.set(key, [...this.recent(key), now]);
    }
  }

  /** A good login clears that user's failures (not the address's: one good guess is not a pass). */
  succeeded(user: string): void {
    this.failures.delete(`u:${user.toLowerCase()}`);
  }
}

/**
 * The client's address. Behind Tailscale serve (and Funnel) every request comes from loopback, and the
 * proxy says who it was for in X-Forwarded-For; a header from anyone else is not trusted, unless it comes
 * from one of `proxies` (BONI_TRUSTED_PROXIES: the public node's sidecar reaching the public entry over an
 * internal Docker network, docs/nucleo.md 11).
 */
export function clientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  proxies: ReadonlySet<string> = new Set(),
): string {
  const direct = socketAddress ?? "unknown";
  const plain = direct.startsWith("::ffff:") ? direct.slice(7) : direct;
  const fromProxy =
    direct === "127.0.0.1" ||
    direct === "::1" ||
    direct === "::ffff:127.0.0.1" ||
    proxies.has(direct) ||
    proxies.has(plain);
  const first = forwardedFor?.split(",")[0]?.trim();
  return fromProxy && first ? first : direct;
}
