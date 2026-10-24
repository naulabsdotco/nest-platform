import { isIP } from 'node:net';

export const USER_AGENT_MAX_CHARS = 512;

export interface RequestMetadata {
  userAgent?: string;
  ip?: string;
}

// Header-derived values are untrusted. The user agent is capped so a login cannot be used for storage
// amplification, and an ip that is not a literal is dropped rather than failing the write after the
// access token was minted (the port stores null, and the attempt records its existing default).
export const sanitizeMetadata = ({ userAgent, ip }: RequestMetadata): RequestMetadata => ({
  userAgent: userAgent === undefined ? undefined : userAgent.slice(0, USER_AGENT_MAX_CHARS),
  ip: ip !== undefined && isIP(ip) !== 0 ? ip : undefined,
});
