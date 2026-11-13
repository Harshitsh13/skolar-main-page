import type { Metadata } from "next";
import { Notifications } from "@/studio/ui/Admin";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return <Notifications />;
}
