import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyUnitJwt, UNIT_JWT_COOKIE } from "@/lib/unitPortalJwt";

export default async function UnitSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const requested = decodeURIComponent(params.slug ?? "");
  const token = cookies().get(UNIT_JWT_COOKIE)?.value;
  if (!token) {
    redirect(`/other-operations?slug=${encodeURIComponent(requested)}`);
  }
  const v = await verifyUnitJwt(token);
  if (!v || v.slug !== requested) {
    redirect("/other-operations?err=forbidden");
  }
  return <>{children}</>;
}
