import { argon2i, argon2id, hash as argon2Hash } from 'argon2';
import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';
import { AuthPasswordPolicyError } from '../errors';
import { ARGON2_OPTIONS } from './argon2-options';
import { createPasswordVerifier } from './password-verifier';

const weakArgon2id = (password: string): Promise<string> =>
  argon2Hash(password, { type: argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 });

describe('ARGON2_OPTIONS', () => {
  it('pins argon2id parameters rather than taking consumer defaults', () => {
    expect(ARGON2_OPTIONS).toEqual({ type: 'argon2id', memoryCost: 19456, timeCost: 2, parallelism: 1 });
  });
});

describe('createPasswordVerifier', () => {
  it('argon2id hashes a password and verifies it', async () => {
    const verifier = createPasswordVerifier();

    const hash = await verifier.hash('correct horse battery staple');
    const result = await verifier.verify(
      { subjectId: 'subject-1', algo: 'argon2id', hash },
      'correct horse battery staple',
    );

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('the produced hash carries the pinned m/t/p parameters', async () => {
    const hash = await createPasswordVerifier().hash('correct horse battery staple');

    expect(hash).toContain('m=19456,p=1,t=2');
  });

  it('verify returns false, never throws, on a wrong password or an unusable hash', async () => {
    const verifier = createPasswordVerifier();
    const hash = await verifier.hash('right');

    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash }, 'wrong')).resolves.toEqual({ ok: false });
    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash: 'not-a-hash' }, 'right')).resolves.toEqual({
      ok: false,
    });
  });

  it('two argon2id hashes of one password differ (salted)', async () => {
    const verifier = createPasswordVerifier();

    const first = await verifier.hash('same');
    const second = await verifier.hash('same');

    expect(first).not.toBe(second);
    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash: first }, 'same')).resolves.toEqual({ ok: true });
    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash: second }, 'same')).resolves.toEqual({ ok: true });
  });

  it('a stored hash that is not argon2id is refused', async () => {
    const verifier = createPasswordVerifier();
    const argon2iHash = await argon2Hash('pw', { type: argon2i, memoryCost: 1024, timeCost: 1, parallelism: 1 });

    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash: argon2iHash }, 'pw')).resolves.toEqual({
      ok: false,
    });
  });

  it('a hash stored with weaker argon2id parameters verifies and returns a rehash', async () => {
    const verifier = createPasswordVerifier();

    const result = await verifier.verify({ subjectId: 's', algo: 'argon2id', hash: await weakArgon2id('pw') }, 'pw');

    expect(result.ok).toBe(true);
    expect(result.rehash?.startsWith('$argon2id$')).toBe(true);
    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash: result.rehash ?? '' }, 'pw')).resolves.toEqual({
      ok: true,
    });
  });

  it('a bcrypt credential is refused when the provider is off', async () => {
    const verifier = createPasswordVerifier();
    const hash = await bcrypt.hash('imported', 10);

    await expect(verifier.verify({ subjectId: 's', algo: 'bcrypt', hash }, 'imported')).resolves.toEqual({ ok: false });
  });

  it('an unknown algorithm is refused when the provider is off', async () => {
    const verifier = createPasswordVerifier();
    const cred = { subjectId: 's', algo: 'scrypt' as const, hash: '$scrypt$n=16384' } as unknown as Parameters<
      typeof verifier.verify
    >[0];

    await expect(verifier.verify(cred, 'anything')).resolves.toEqual({ ok: false });
  });

  it('verifyDummy resolves for an unknown subject so the timing matches a real verify', async () => {
    const verifier = createPasswordVerifier();

    await expect(verifier.verifyDummy('anything')).resolves.toBeUndefined();
  });

  it('a presented password beyond the maximum length is refused', async () => {
    const verifier = createPasswordVerifier();
    const hash = await verifier.hash('short');

    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash }, 'x'.repeat(1025))).resolves.toEqual({
      ok: false,
    });
  });

  it('hashing a password beyond the maximum length is refused', async () => {
    await expect(createPasswordVerifier().hash('x'.repeat(1025))).rejects.toBeInstanceOf(AuthPasswordPolicyError);
  });

  it('with bcrypt enabled, a valid bcrypt credential verifies and returns an argon2id rehash', async () => {
    const verifier = createPasswordVerifier({ bcrypt: true });
    const hash = await bcrypt.hash('imported', 10);

    const result = await verifier.verify({ subjectId: 's', algo: 'bcrypt', hash }, 'imported');

    expect(result.ok).toBe(true);
    expect(result.rehash?.startsWith('$argon2id$')).toBe(true);
    await expect(verifier.verify({ subjectId: 's', algo: 'argon2id', hash: result.rehash ?? '' }, 'imported')).resolves.toEqual({
      ok: true,
    });
  });

  it('with bcrypt enabled, a wrong password still returns false and no rehash', async () => {
    const verifier = createPasswordVerifier({ bcrypt: true });
    const hash = await bcrypt.hash('imported', 10);

    const result = await verifier.verify({ subjectId: 's', algo: 'bcrypt', hash }, 'wrong');

    expect(result.ok).toBe(false);
    expect(result.rehash).toBeUndefined();
  });

  it('with bcrypt enabled, a malformed bcrypt hash is refused', async () => {
    const verifier = createPasswordVerifier({ bcrypt: true });

    await expect(verifier.verify({ subjectId: 's', algo: 'bcrypt', hash: '$2b$10$truncated' }, 'pw')).resolves.toEqual({
      ok: false,
    });
  });

  it('with bcrypt enabled, an argon2 hash stored under the bcrypt algo is refused', async () => {
    const verifier = createPasswordVerifier({ bcrypt: true });
    const argon2HashOfPassword = await verifier.hash('pw');

    await expect(
      verifier.verify({ subjectId: 's', algo: 'bcrypt', hash: argon2HashOfPassword }, 'pw'),
    ).resolves.toEqual({ ok: false });
  });

  it('with bcrypt enabled, a bcrypt credential still cannot be hashed to bcrypt', async () => {
    const verifier = createPasswordVerifier({ bcrypt: true });

    const hash = await verifier.hash('imported');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash.startsWith('$2')).toBe(false);
  });
});
