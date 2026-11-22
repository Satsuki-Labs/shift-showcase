import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { AppError } from '../../../shared/app-error';
import type { Identity, Role } from '../../../shared/protocol';
import type { Env } from '../index';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function isRole(value: unknown): value is Role {
  return value === 'first' || value === 'second' || value === 'maintenance';
}
function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value);
}

export async function authenticate(request: Request, env: Env): Promise<Identity> {
  if (env.ENVIRONMENT === '手元') {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname))
      throw new AppError('E-22');
    if (!isEmail(env.LOCAL_EMAIL) || !isRole(env.LOCAL_ROLE)) throw new AppError('E-52');
    return { email: env.LOCAL_EMAIL, role: env.LOCAL_ROLE };
  }
  if (env.ENVIRONMENT !== '本番') throw new AppError('E-52');
  const roles: unknown = env.ROLE_TABLE;
  if (
    !roles ||
    typeof roles !== 'object' ||
    Array.isArray(roles) ||
    Object.keys(roles).length === 0 ||
    Object.entries(roles).some(([email, role]) => !isEmail(email) || !isRole(role)) ||
    typeof env.ACCESS_TEAM !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(env.ACCESS_TEAM) ||
    typeof env.ACCESS_AUDIENCE !== 'string' ||
    !env.ACCESS_AUDIENCE.trim()
  )
    throw new AppError('E-52');
  const table = new Map(
    Object.entries(roles as Record<string, Role>).map(([email, role]) => [
      email.toLowerCase(),
      role,
    ]),
  );
  if (table.size !== Object.keys(roles).length) throw new AppError('E-52');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AppError('E-22');
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: env.ACCESS_AUDIENCE,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iss', 'aud', 'email'],
    });
    email = payload.email;
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new AppError('E-23');
    if (
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWKSNoMatchingKey ||
      error instanceof errors.JWKSMultipleMatchingKeys ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JOSENotSupported
    )
      throw new AppError('E-24');
    throw new AppError('E-82');
  }
  if (!isEmail(email)) throw new AppError('E-24');
  const role = table.get(email.toLowerCase());
  if (!role) throw new AppError('E-25');
  return { email, role };
}

export function checkOrigin(request: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (
    request.headers.get('Origin') !== new URL(request.url).origin ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new AppError('E-26');
}
