import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Minimum password policy enforced server-side. Returns null when acceptable,
 * otherwise a human-readable reason.
 */
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 8) return 'Password must be at least 8 characters';
  if (plain.length > 200) return 'Password must be at most 200 characters';
  if (!/[a-zA-Z]/.test(plain)) return 'Password must contain a letter';
  if (!/[0-9]/.test(plain)) return 'Password must contain a number';
  return null;
}
