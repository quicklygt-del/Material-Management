import { cookies } from "next/headers";

import { SUPER_ADMIN_COOKIE, verifySuperAdminJwt } from "@/lib/superAdminJwt";

export async function isSuperAdminRequest(): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get(SUPER_ADMIN_COOKIE)?.value ?? "";
  if (!raw) return false;
  return verifySuperAdminJwt(raw);
}
