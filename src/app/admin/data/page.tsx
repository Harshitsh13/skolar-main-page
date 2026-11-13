import type { Metadata } from "next";
import { DataManager } from "@/studio/ui/DataManager";

export const metadata: Metadata = { title: "Countries & Universities" };

export default function Page() {
  return <DataManager />;
}
