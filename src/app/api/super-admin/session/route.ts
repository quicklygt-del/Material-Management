import { NextResponse } from "next/server";

import { isSuperAdminRequest } from "@/lib/superAdminRequest";

export const dynamic = "force-dynamic";

export async function GET() {
  const ok = await isSuperAdminRequest();
  return NextResponse.json({ authenticated: ok });
}
