import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SUPER_ADMIN_COOKIE = "pick_super_admin_sess";

export function getSuperAdminJwtSecretKey(): Uint8Array {
  const raw =
    process.env.SUPER_ADMIN_JWT_SECRET ||
    process.env.SUPER_ADMIN_PASSWORD ||
    "pick-super-admin-dev-insecure";
  const doubled = raw.length < 32 ? `${raw}${raw}` : raw;
  return new TextEncoder().encode(doubled.slice(0, 64));
}

export async function signSuperAdminJwt(
  maxAgeSec = 60 * 60 * 12,
): Promise<string> {
  return await new SignJWT({ v: "1" } satisfies Record<string, string>)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("super_admin")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSec)
    .sign(getSuperAdminJwtSecretKey());
}

export async function verifySuperAdminJwt(
  token: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSuperAdminJwtSecretKey());
    const sub = String((payload as JWTPayload).sub ?? "");
    return sub === "super_admin";
  } catch {
    return false;
  }
}
