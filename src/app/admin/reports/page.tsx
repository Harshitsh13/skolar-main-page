import type { Metadata } from "next";
import { Reports } from "@/studio/ui/Admin";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <Reports />;
}
