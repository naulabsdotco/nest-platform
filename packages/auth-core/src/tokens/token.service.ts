import jwt, { type JwtPayload } from 'jsonwebtoken';
import { AuthConfigError, AuthInvalidTokenError } from '../errors';
import { assertSigningKeys, keyByKid } from './jwt-keys';

export interface TokenConfig {
  keys: Record<string, string>;
  activeKid: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
}

export interface TokenService {
  issueAccess(sub: string): { accessToken: string; expiresIn: number };
  verifyAccess(token: string): { sub: string };
}

const ALGORITHM = 'HS256';

// A hand-built config bypasses the schema, so the factory refuses a config it cannot sign safely with.
const assertUsable = (config: TokenConfig): void => {
  if (!config.issuer || !config.audience) throw new AuthConfigError({ reason: 'issuer and audience are required' });
  assertSigningKeys(config);
};

export function createTokenService(config: TokenConfig): TokenService {
  assertUsable(config);

  return {
    issueAccess(sub) {
      const accessToken = jwt.sign({ sub, typ: 'access' }, config.keys[config.activeKid], {
        algorithm: ALGORITHM,
        keyid: config.activeKid,
        issuer: config.issuer,
        audience: config.audience,
        expiresIn: config.accessTtlSeconds,
      });
      return { accessToken, expiresIn: config.accessTtlSeconds };
    },

    verifyAccess(token) {
      // The kid is read without trust only to pick a key; an own key is required, not an inherited one.
      const key = keyByKid(config.keys, token);
      if (key === undefined) throw new AuthInvalidTokenError();

      let payload: JwtPayload | string;
      try {
        // clockTolerance is left at jsonwebtoken's default of 0: a token is valid only in its window.
        payload = jwt.verify(token, key, {
          algorithms: [ALGORITHM],
          issuer: config.issuer,
          audience: config.audience,
        });
      } catch {
        throw new AuthInvalidTokenError();
      }

      if (
        typeof payload === 'string' ||
        payload.typ !== 'access' ||
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        typeof payload.exp !== 'number'
      ) {
        throw new AuthInvalidTokenError();
      }
      return { sub: payload.sub };
    },
  };
}
