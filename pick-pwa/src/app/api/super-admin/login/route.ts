import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import {
  SUPER_ADMIN_COOKIE,
  signSuperAdminJwt,
} from "@/lib/superAdminJwt";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expectedUser = String(process.env.SUPER_ADMIN_USERNAME ?? "").trim();
  const expectedPass = String(process.env.SUPER_ADMIN_PASSWORD ?? "").trim();

  if (!expectedUser || !expectedPass) {
    return NextResponse.json(
      { error: "伺服器未設定 SUPER_ADMIN_USERNAME／SUPER_ADMIN_PASSWORD" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }
  const username = String(
    (body as { username?: unknown }).username ?? "",
  ).trim();
  const password = String(
    (body as { password?: unknown }).password ?? "",
  ).trim();

  if (username !== expectedUser) {
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }

  const a = Buffer.from(password, "utf8");
  const b = Buffer.from(expectedPass, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }

  const token = await signSuperAdminJwt();
  const res = NextResponse.json({ ok: true });
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.FORCE_HTTPS === "true";
  res.cookies.set(SUPER_ADMIN_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
