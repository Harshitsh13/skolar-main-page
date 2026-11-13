import type { Metadata } from "next";
import { Integrations } from "@/studio/ui/Admin";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <Integrations />;
}
