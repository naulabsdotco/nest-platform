import { Injectable, type Type } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthInvalidTokenError } from '../errors';
import type { Principal } from '../ports/auth-store';
import { assertSigningKeys, keyByKid } from '../tokens/jwt-keys';

export interface JwtStrategyOptions {
  keys: Record<string, string>;
  activeKid: string;
  issuer: string;
  audience: string;
}

interface AccessPayload {
  sub?: unknown;
  typ?: unknown;
}

// The pinned options are the mechanism: passport-jwt verifies a token signed by the right key for
// anyone unless iss, aud and alg are named, so all of them are required rather than defaulted.
export function createJwtStrategy(opts: JwtStrategyOptions): Type<unknown> {
  assertSigningKeys(opts);

  @Injectable()
  class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        // A rotated kid must still verify while its key is in the map, so the key is chosen per token.
        secretOrKeyProvider: (_request, rawJwtToken, done) => {
          const key = keyByKid(opts.keys, String(rawJwtToken));
          if (key === undefined) done(new AuthInvalidTokenError());
          else done(null, key);
        },
        algorithms: ['HS256'],
        issuer: opts.issuer,
        audience: opts.audience,
        ignoreExpiration: false,
      });
    }

    // Returning the subject alone drops every other claim, so nothing a token carries is trusted.
    validate(payload: AccessPayload): Principal {
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new AuthInvalidTokenError();
      }
      return { sub: payload.sub };
    }
  }

  return JwtStrategy;
}
