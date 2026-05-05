import { redirect } from "next/navigation";

/** 相容舊連結／QR：導向首頁規定之「其他作業區」門禁頁 */
export default function UnitLoginLegacyRedirectPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  const err = searchParams.err;
  const slug = searchParams.slug;
  if (typeof err === "string") qs.set("err", err);
  if (typeof slug === "string") qs.set("slug", slug);
  const tail = qs.toString();
  redirect(tail ? `/other-operations?${tail}` : "/other-operations");
}
