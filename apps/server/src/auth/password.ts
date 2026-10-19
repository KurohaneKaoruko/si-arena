import {
  randomBytes,
  scrypt as scryptWithCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { createConcurrencyLimiter } from "../concurrency";

const SCRYPT_OPTIONS: ScryptOptions = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SALT_BYTES = 16;
const DIGEST_BYTES = 64;

export interface ScryptHashParts {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  digest: Buffer;
}

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptWithCallback(password, salt, DIGEST_BYTES, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function encodeScryptHash(salt: Buffer, digest: Buffer, options: ScryptOptions): string {
  return `scrypt$N=${options.N}$r=${options.r}$p=${options.p}$${salt.toString("base64")}$${digest.toString("base64")}`;
}

export function parseScryptHash(stored: string | null): ScryptHashParts | null {
  if (stored === null) return null;
  const match =
    /^scrypt\$N=(\d+)\$r=(\d+)\$p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/.exec(
      stored,
    );
  if (match === null) return null;
  const [n = "", r = "", p = "", salt = "", digest = ""] = match.slice(1);
  const saltBuffer = Buffer.from(salt, "base64");
  const digestBuffer = Buffer.from(digest, "base64");
  if (saltBuffer.length === 0 || digestBuffer.length !== DIGEST_BYTES) return null;
  return { N: Number(n), r: Number(r), p: Number(p), salt: saltBuffer, digest: digestBuffer };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const digest = await scryptAsync(password, salt, SCRYPT_OPTIONS);
  return encodeScryptHash(salt, digest, SCRYPT_OPTIONS);
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  const parts = parseScryptHash(storedHash);
  if (parts === null) return false;
  const digest = await scryptAsync(password, parts.salt, {
    N: parts.N,
    r: parts.r,
    p: parts.p,
    maxmem: 256 * 1024 * 1024,
  });
  return digest.length === parts.digest.length && timingSafeEqual(digest, parts.digest);
}

/** Fixed per-process digest so missing users burn the same scrypt cost as real verifications. */
export const dummyPasswordHash: string = encodeScryptHash(
  randomBytes(SALT_BYTES),
  randomBytes(DIGEST_BYTES),
  SCRYPT_OPTIONS,
);

export interface HashLimiter {
  acquire(): boolean;
  release(): void;
}

export const createHashLimiter = createConcurrencyLimiter;

/** At most 2 password hashes run per process; excess requests fail fast instead of queueing. */
export const passwordHashLimiter: HashLimiter = createConcurrencyLimiter(2);
