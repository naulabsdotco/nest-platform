import { type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { AuthInvalidTokenError } from '../errors';
import { JwtAuthGuard } from './jwt-auth.guard';
import { createJwtStrategy, type JwtStrategyOptions } from './jwt-strategy.factory';
import { Public } from './route-metadata';

const SECRET = '0123456789abcdef'.repeat(2);
const OTHER_SECRET = 'fedcba9876543210'.repeat(2);
const ACTIVE_KID = 'kid-1';

const options: JwtStrategyOptions = {
  keys: { [ACTIVE_KID]: SECRET },
  activeKid: ACTIVE_KID,
  issuer: 'https://issuer.example',
  audience: 'example-app',
};

// Instantiating the factory's class is what registers the strategy with passport under `jwt`.
new (createJwtStrategy(options))();

const sign = (payload: object, overrides: jwt.SignOptions = {}, secret: string = SECRET): string =>
  jwt.sign(payload, secret, {
    algorithm: 'HS256',
    keyid: ACTIVE_KID,
    issuer: 'https://issuer.example',
    audience: 'example-app',
    expiresIn: 900,
    ...overrides,
  });

const untrusted = (header: object, payload: object): string =>
  [header, payload, { sig: 'c2ln' }]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .join('.');

class OpenController {
  @Public()
  open(): void {}
}

class GuardedController {
  guarded(): void {}
}

interface Request {
  headers: Record<string, string>;
  principal?: unknown;
}

const contextFor = (request: Request, controller: Type<unknown>, handler: () => void): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

const guard = new JwtAuthGuard(new Reflector());

const bearer = (token: string): Request => ({ headers: { authorization: `Bearer ${token}` } });

const activate = (
  request: Request,
  controller: Type<unknown> = GuardedController,
  handler: () => void = GuardedController.prototype.guarded,
): Promise<boolean> => guard.canActivate(contextFor(request, controller, handler));

const rejection = async (request: Request): Promise<void> => {
  await expect(activate(request)).rejects.toBeInstanceOf(AuthInvalidTokenError);
};

describe('JwtAuthGuard', () => {
  it('a token with the active kid and correct iss/aud/alg verifies and yields { sub } only', async () => {
    const request = bearer(sign({ sub: 'subject-1', typ: 'access', role: 'admin' }));

    await expect(activate(request)).resolves.toBe(true);
    expect(request.principal).toEqual({ sub: 'subject-1' });
  });

  it('@Public skips token verification', async () => {
    await expect(activate({ headers: {} }, OpenController, OpenController.prototype.open)).resolves.toBe(true);
  });

  it('an alg:none token is refused', async () => {
    await rejection(
      bearer(
        untrusted(
          { alg: 'none', typ: 'JWT', kid: ACTIVE_KID },
          {
            sub: 'subject-1',
            typ: 'access',
            iss: 'https://issuer.example',
            aud: 'example-app',
            exp: Math.floor(Date.now() / 1000) + 900,
          },
        ),
      ),
    );
  });

  it('an RS256 token handed to the HS strategy is refused', async () => {
    await rejection(
      bearer(
        untrusted(
          { alg: 'RS256', typ: 'JWT', kid: ACTIVE_KID },
          {
            sub: 'subject-1',
            typ: 'access',
            iss: 'https://issuer.example',
            aud: 'example-app',
            exp: Math.floor(Date.now() / 1000) + 900,
          },
        ),
      ),
    );
  });

  it('a token signed by another key is refused', async () => {
    await rejection(bearer(sign({ sub: 'subject-1', typ: 'access' }, {}, OTHER_SECRET)));
  });

  it('a wrong issuer is refused', async () => {
    await rejection(bearer(sign({ sub: 'subject-1', typ: 'access' }, { issuer: 'https://other.example' })));
  });

  it('a wrong audience is refused', async () => {
    await rejection(bearer(sign({ sub: 'subject-1', typ: 'access' }, { audience: 'other-app' })));
  });

  it('an expired token is refused', async () => {
    await rejection(bearer(sign({ sub: 'subject-1', typ: 'access' }, { expiresIn: -10 })));
  });

  it('a token whose typ is not access is refused', async () => {
    await rejection(bearer(sign({ sub: 'subject-1', typ: 'refresh' })));
  });

  it('a missing Authorization header is refused', async () => {
    await rejection({ headers: {} });
  });

  it('every pinned option is required at the type level', () => {
    expectTypeOf<Parameters<typeof createJwtStrategy>[0]>().toEqualTypeOf<JwtStrategyOptions>();
    expectTypeOf<{ keys: Record<string, string>; activeKid: string; issuer: string }>().not.toMatchTypeOf<JwtStrategyOptions>();
  });
});
