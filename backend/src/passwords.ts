import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

// Passwords for the people who sign in on /signin: bus owners, their staff and route syndicates.
// Kept only as scrypt hashes, each with its own salt, so a copy of the owners file does not give
// the passwords away. A number without an account costs the same work as one with, so the time an
// answer takes does not tell which numbers have accounts.

const N = 16384;
const R = 8;
const P = 1;
const LENGTH = 32;

function derive(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Normalised, so the same password typed on another keyboard still matches.
    scrypt(password.normalize('NFKC'), salt, LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** "scrypt$N$r$p$salt$hash", the salt and hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

let dummy: Promise<string> | null = null;

/** Whether the password matches. With no stored hash, the same work is done and the answer is no. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const hash = stored ?? (await (dummy ??= hashPassword(randomBytes(12).toString('base64url'))));
  const [scheme, n, r, p, salt, key] = hash.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const got = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return stored !== undefined && got.length === expected.length && timingSafeEqual(got, expected);
}

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'password123', 'passw0rd', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abcd1234',
  'abc12345', 'welcome1', 'admin123', 'kolkata1', 'kolkata123', 'whereismybus',
]);

/** What is wrong with a new password, in words for the person choosing it; null when it will do. */
export function passwordProblem(password: unknown, phone?: string): string | null {
  if (typeof password !== 'string' || !password) return 'Choose a password.';
  if (password.length < 8) return 'Choose a password of at least 8 characters.';
  if (password.length > 128) return 'Keep the password to 128 characters.';
  const plain = password.toLowerCase().replace(/\s+/g, '');
  // The number itself, however it is written: "9830012345", "+91 98300-12345".
  const digits = phone?.replace(/\D/g, '').slice(-10);
  if (digits && /^[\d+()-]+$/.test(plain) && plain.replace(/\D/g, '').endsWith(digits)) return 'Do not use your mobile number as the password.';
  if (COMMON.has(plain) || /^(.)\1+$/.test(plain)) return 'That password is too easy to guess. Choose another.';
  return null;
}

// No 0 and O, no 1, l and i: a temporary password is read out or copied by hand.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** For the admin to give someone: ten letters and digits, about 50 bits. It works only to choose a new one. */
export function makeTempPassword(): string {
  return Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
