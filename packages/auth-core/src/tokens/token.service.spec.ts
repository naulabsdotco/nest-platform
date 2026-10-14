import jwt, { type Jwt, type JwtHeader, type SignOptions } from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AuthConfigError, AuthInvalidTokenError } from '../errors';
import { createTokenService, type TokenConfig } from './token.service';

const SECRET = '0123456789abcdef'.repeat(2);
const OTHER_SECRET = 'fedcba9876543210'.repeat(2);

const config = (overrides: Partial<TokenConfig> = {}): TokenConfig => ({
  keys: { 'kid-1': SECRET },
  activeKid: 'kid-1',
  issuer: 'https://issuer.example',
  audience: 'example-app',
  accessTtlSeconds: 900,
  ...overrides,
});

const signWith = (payload: object, options: SignOptions = {}): string =>
  jwt.sign(payload, SECRET, {
    algorithm: 'HS256',
    keyid: 'kid-1',
    issuer: 'https://issuer.example',
    audience: 'example-app',
    expiresIn: 900,
    ...options,
  });

const headerOf = (token: string): JwtHeader => (jwt.decode(token, { complete: true }) as Jwt).header;

const payloadOf = (token: string): Record<string, unknown> => jwt.decode(token) as Record<string, unknown>;

const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('createTokenService', () => {
  it('issueAccess signs a token whose payload keys are exactly sub, typ and the registered claims', () => {
    const service = createTokenService(config());

    const { accessToken } = service.issueAccess('subject-1');
    const payload = payloadOf(accessToken);

    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub', 'typ']);
    expect(payload.sub).toBe('subject-1');
    expect(payload.typ).toBe('access');
  });

  it('the signed header pins alg HS256 and the active kid', () => {
    const header = headerOf(createTokenService(config()).issueAccess('subject-1').accessToken);

    expect(header.alg).toBe('HS256');
    expect(header.kid).toBe('kid-1');
  });

  it('a token the service signed verifies back to its subject', () => {
    const service = createTokenService(config());

    const { accessToken } = service.issueAccess('subject-1');

    expect(service.verifyAccess(accessToken)).toEqual({ sub: 'subject-1' });
  });

  it('expiresIn equals the configured access TTL', () => {
    const service = createTokenService(config({ accessTtlSeconds: 120 }));

    expect(service.issueAccess('subject-1').expiresIn).toBe(120);
  });

  it('verifying rejects a token with a foreign issuer', () => {
    const service = createTokenService(config());
    const foreign = createTokenService(config({ issuer: 'https://other.example' }));

    expect(() => service.verifyAccess(foreign.issueAccess('subject-1').accessToken)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token with a foreign audience', () => {
    const service = createTokenService(config());
    const foreign = createTokenService(config({ audience: 'other-app' }));

    expect(() => service.verifyAccess(foreign.issueAccess('subject-1').accessToken)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token signed by another key', () => {
    const service = createTokenService(config());
    const foreign = createTokenService(config({ keys: { 'kid-1': OTHER_SECRET } }));

    expect(() => service.verifyAccess(foreign.issueAccess('subject-1').accessToken)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token whose typ is not access', () => {
    const service = createTokenService(config());

    expect(() => service.verifyAccess(signWith({ sub: 'subject-1', typ: 'refresh' }))).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token with an unknown kid', () => {
    const service = createTokenService(config());
    const other = createTokenService(config({ keys: { 'kid-9': SECRET }, activeKid: 'kid-9' }));

    expect(() => service.verifyAccess(other.issueAccess('subject-1').accessToken)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token with no kid', () => {
    const service = createTokenService(config());
    const token = jwt.sign({ sub: 'subject-1', typ: 'access' }, SECRET, {
      algorithm: 'HS256',
      issuer: 'https://issuer.example',
      audience: 'example-app',
      expiresIn: 900,
    });

    expect(() => service.verifyAccess(token)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token with a kid that shadows an inherited key', () => {
    const service = createTokenService(config());

    expect(() => service.verifyAccess(signWith({ sub: 'subject-1', typ: 'access' }, { keyid: 'constructor' }))).toThrow(
      AuthInvalidTokenError,
    );
  });

  it('verifying rejects an alg none token', () => {
    const service = createTokenService(config());
    const token = `${base64url({ alg: 'none', typ: 'JWT', kid: 'kid-1' })}.${base64url({
      sub: 'subject-1',
      typ: 'access',
      iss: 'https://issuer.example',
      aud: 'example-app',
      exp: Math.floor(Date.now() / 1000) + 900,
    })}.`;

    expect(() => service.verifyAccess(token)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a token signed with another HS algorithm', () => {
    const service = createTokenService(config());

    for (const algorithm of ['HS384', 'HS512'] as const) {
      expect(() => service.verifyAccess(signWith({ sub: 'subject-1', typ: 'access' }, { algorithm }))).toThrow(
        AuthInvalidTokenError,
      );
    }
  });

  it('verifying rejects an expired token', () => {
    const service = createTokenService(config());

    expect(() => service.verifyAccess(signWith({ sub: 'subject-1', typ: 'access' }, { expiresIn: -10 }))).toThrow(
      AuthInvalidTokenError,
    );
  });

  it('verifying rejects a token that is not yet valid', () => {
    const service = createTokenService(config());

    expect(() => service.verifyAccess(signWith({ sub: 'subject-1', typ: 'access' }, { notBefore: 3600 }))).toThrow(
      AuthInvalidTokenError,
    );
  });

  it('verifying rejects a token that has no expiry', () => {
    const service = createTokenService(config());
    const token = jwt.sign({ sub: 'subject-1', typ: 'access' }, SECRET, {
      algorithm: 'HS256',
      keyid: 'kid-1',
      issuer: 'https://issuer.example',
      audience: 'example-app',
    });

    expect(() => service.verifyAccess(token)).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a subject that is not a non-empty string', () => {
    const service = createTokenService(config());

    expect(() => service.verifyAccess(signWith({ sub: '', typ: 'access' }))).toThrow(AuthInvalidTokenError);
    expect(() => service.verifyAccess(signWith({ sub: 42, typ: 'access' }))).toThrow(AuthInvalidTokenError);
  });

  it('verifying rejects a string that is not a JWT', () => {
    const service = createTokenService(config());

    expect(() => service.verifyAccess('not-a-token')).toThrow(AuthInvalidTokenError);
  });

  it('construction rejects an active kid that is absent from the key map', () => {
    expect(() => createTokenService(config({ activeKid: 'kid-2' }))).toThrow(AuthConfigError);
  });

  it('construction rejects a low-diversity secret', () => {
    expect(() => createTokenService(config({ keys: { 'kid-1': 'k'.repeat(64) } }))).toThrow(AuthConfigError);
  });

  it('rotating the active kid signs with the new kid and old tokens still verify', () => {
    const original = createTokenService(config());
    const { accessToken: oldToken } = original.issueAccess('subject-1');

    const rotated = createTokenService(config({ keys: { 'kid-1': SECRET, 'kid-2': OTHER_SECRET }, activeKid: 'kid-2' }));
    const { accessToken: newToken } = rotated.issueAccess('subject-1');

    expect(headerOf(newToken).kid).toBe('kid-2');
    expect(rotated.verifyAccess(oldToken)).toEqual({ sub: 'subject-1' });
  });
});
