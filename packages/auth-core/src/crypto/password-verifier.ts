import { argon2id, hash as argon2Hash, needsRehash, verify as argon2Verify, type HashOptions } from 'argon2';
import { AuthPasswordPolicyError } from '../errors';
import type { StoredCredential } from '../ports/auth-store';
import { ARGON2_OPTIONS } from './argon2-options';

export interface PasswordVerifier {
  verify(cred: StoredCredential, presented: string): Promise<{ ok: boolean; rehash?: string }>;
  hash(password: string): Promise<string>;
  verifyDummy(presented: string): Promise<void>;
}

// Beyond this a password is a request-size problem, not a credential.
const MAX_PASSWORD_BYTES = 1024;

const { memoryCost, timeCost, parallelism } = ARGON2_OPTIONS;
const options: HashOptions = { type: argon2id, memoryCost, timeCost, parallelism };

const tooLong = (value: string): boolean => Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES;

export function createPasswordVerifier(opts: { bcrypt?: boolean } = {}): PasswordVerifier {
  let dummyHash: Promise<string> | undefined;
  const dummy = (): Promise<string> => (dummyHash ??= argon2Hash('constant-time dummy', options));

  const hash = async (password: string): Promise<string> => {
    if (tooLong(password)) throw new AuthPasswordPolicyError({ reason: 'password exceeds the maximum length' });
    return argon2Hash(password, options);
  };

  const verifyDummy = async (presented: string): Promise<void> => {
    if (tooLong(presented)) return;
    await argon2Verify(await dummy(), presented).catch(() => false);
  };

  return {
    hash,
    verifyDummy,
    async verify(cred, presented) {
      if (tooLong(presented)) return { ok: false };

      if (cred.algo === 'argon2id') {
        // A stored hash of another argon2 variant or another scheme is refused, not downgraded.
        if (!cred.hash.startsWith('$argon2id$')) return { ok: false };

        let ok: boolean;
        try {
          ok = await argon2Verify(cred.hash, presented);
        } catch {
          return { ok: false };
        }
        if (!ok) return { ok: false };
        // A hash below the pinned parameters is upgraded on a successful login.
        return needsRehash(cred.hash, options) ? { ok: true, rehash: await hash(presented) } : { ok: true };
      }

      // The bcrypt path is for imported hashes only: presence is the migration switch.
      if (cred.algo === 'bcrypt' && opts.bcrypt === true) {
        const { compare } = await import('bcrypt');
        let ok: boolean;
        try {
          ok = await compare(presented, cred.hash);
        } catch {
          return { ok: false };
        }
        return ok ? { ok: true, rehash: await hash(presented) } : { ok: false };
      }

      // A refused scheme must cost the same as a real verify, or it leaks the stored scheme.
      await verifyDummy(presented);
      return { ok: false };
    },
  };
}
