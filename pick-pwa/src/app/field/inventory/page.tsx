import { redirect } from "next/navigation";

/** 異動／分頁掃描已整合至 /operator ，保留路徑導流 */
export default function FieldInventoryRedirectPage() {
  redirect("/operator");
}
