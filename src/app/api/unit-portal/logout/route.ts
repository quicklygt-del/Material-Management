import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { UNIT_JWT_COOKIE } from "@/lib/unitPortalJwt";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(UNIT_JWT_COOKIE);
  return NextResponse.json({ ok: true });
}
