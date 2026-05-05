import { redirect } from "next/navigation";

/** 倉儲作業已回復首頁左欄；保留網址導向避免舊書籤失效 */
export default function WarehouseLegacyRedirectPage() {
  redirect("/");
}
