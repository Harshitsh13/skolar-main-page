import type { Metadata } from "next";
import { Calendar } from "@/studio/ui/Lists";

export const metadata: Metadata = { title: "Publishing Calendar" };

export default function Page() {
  return <Calendar />;
}
