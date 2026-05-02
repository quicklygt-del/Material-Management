import { redirect } from "next/navigation";

export default function FieldScanRedirectPage() {
  redirect("/field?camera=1");
}
