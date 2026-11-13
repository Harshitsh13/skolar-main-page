import type { Metadata } from "next";
import { Settings } from "@/studio/ui/Admin";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <Settings />;
}
