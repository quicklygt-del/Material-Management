import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const UNIT_JWT_COOKIE = "pick_unit_jwt";

export function getUnitJwtSecretKey(): Uint8Array {
  const raw =
    process.env.PICK_UNIT_JWT_SECRET ||
    `${process.env.NEXT_PUBLIC_LABEL_PREFIX || "WMS"}-pick-unit-jwt-dev`;
  const doubled = raw.length < 32 ? `${raw}${raw}` : raw;
  return new TextEncoder().encode(doubled.slice(0, 64));
}

export type UnitJwtClaims = {
  slug: string;
  tenant: string;
  name: string;
};

export async function signUnitJwt(
  unitId: string,
  claims: UnitJwtClaims,
  maxAgeSec = 60 * 60 * 24 * 14,
): Promise<string> {
  return await new SignJWT({
    slug: claims.slug,
    tenant: claims.tenant,
    name: claims.name,
  } satisfies Record<string, string>)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(unitId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSec)
    .sign(getUnitJwtSecretKey());
}

export async function verifyUnitJwt(
  token: string,
): Promise<{ unitId: string } & UnitJwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getUnitJwtSecretKey());
    const sub = String(payload.sub ?? "");
    const slug = String((payload as JWTPayload & UnitJwtClaims).slug ?? "");
    const tenant = String((payload as JWTPayload & UnitJwtClaims).tenant ?? "");
    const name = String((payload as JWTPayload & UnitJwtClaims).name ?? "");
    if (!sub || !slug || !tenant) return null;
    return { unitId: sub, slug, tenant, name };
  } catch {
    return null;
  }
}
