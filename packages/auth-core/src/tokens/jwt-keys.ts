import jwt from 'jsonwebtoken';
import { isStrongSecret } from '../config';
import { AuthConfigError } from '../errors';

export interface SigningKeys {
  readonly keys: Record<string, string>;
  readonly activeKid: string;
}

// A hand-built config bypasses the schema, so signing and verifying both refuse an unusable key map.
export const assertSigningKeys = ({ keys, activeKid }: SigningKeys): void => {
  if (!Object.hasOwn(keys, activeKid)) throw new AuthConfigError({ activeKid });
  for (const kid of Object.keys(keys)) {
    if (!isStrongSecret(keys[kid])) throw new AuthConfigError({ kid });
  }
};

// The kid is read without trust only to pick a key; an own key is required, not an inherited one.
export const keyByKid = (keys: Record<string, string>, token: string): string | undefined => {
  const kid = jwt.decode(token, { complete: true })?.header.kid;
  return typeof kid === 'string' && Object.hasOwn(keys, kid) ? keys[kid] : undefined;
};
