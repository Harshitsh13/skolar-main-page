import type { Metadata } from "next";
import { AdminClient } from "@/components/admin/AdminClient";

export const metadata: Metadata = { title: "Homepage cards" };

/** The original website admin (destination cards + external article links), kept as-is. */
export default function Page() {
  return <AdminClient />;
}
