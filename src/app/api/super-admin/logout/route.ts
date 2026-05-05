import { NextResponse } from "next/server";

import { SUPER_ADMIN_COOKIE } from "@/lib/superAdminJwt";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SUPER_ADMIN_COOKIE);
  return res;
}
