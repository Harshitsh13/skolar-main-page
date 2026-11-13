import type { Metadata } from "next";
import { Research } from "@/studio/ui/Research";

export const metadata: Metadata = { title: "Research & Sources" };

export default function Page() {
  return <Research />;
}
