/**
 * Human formatting for the numbers the health screen draws.
 *
 * These live in a module of their own rather than inline in the screen for one
 * reason: a byte formatter that divides by 1000 where it should divide by 1024
 * is invisible on screen. Every size still looks like a size, the units still
 * look right, and the panel simply reports a database 2.4% larger than it is -
 * a lie nobody catches by looking. So the arithmetic sits somewhere a
 * self-check can reach it (`format.check.ts`), and the screen only calls it.
 *
 * The divisor is 1024, and the unit labels are the short ones (KB, MB, GB)
 * rather than the pedantic ones (KiB, MiB). That is deliberately what
 * `pg_size_pretty` does, and the database section of this screen is read
 * side-by-side with `psql` output often enough that agreeing with it matters
 * more than being right about the IEC spelling.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Bytes as an operator reads them: `1.4 GB`, `812 KB`, `0 B`.
 *
 * Precision shrinks as the unit grows, because "1.44 GB" carries information
 * that "144.32 KB" does not - the second decimal of a kilobyte figure is noise
 * that makes a column of numbers harder to scan.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const negative = bytes < 0;
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Bytes are whole things; a fractional byte is a rounding artefact, not data.
  const decimals = unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${negative ? '-' : ''}${value.toFixed(decimals)} ${UNITS[unit] ?? 'B'}`;
}

/**
 * Seconds as a duration: `6d 4h`, `3h 12m`, `48s`.
 *
 * Two units at most. An uptime of "6 days, 4 hours, 11 minutes and 3 seconds"
 * is answering a question nobody asked - the reason anybody reads an uptime is
 * to know whether the process restarted recently, and two units settle that.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${whole}s`;
}

/**
 * A count with thousands separators. Row estimates and socket counts run into
 * seven figures on a busy deployment and are unreadable without them.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

/**
 * A share of a whole, as a percentage string, safe at zero.
 *
 * Written out because the two places that need it - the connection gauge and
 * the per-table bars - both divide by a number the server supplies, and a
 * deployment reporting `maxConnections: 0` would otherwise paint every bar
 * `NaN%` wide, which CSS reads as "as wide as you like".
 */
export function percentOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
