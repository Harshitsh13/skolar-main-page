import type { Metadata } from "next";
import { ReviewQueue } from "@/studio/ui/Lists";

export const metadata: Metadata = { title: "Review Queue" };

export default function Page() {
  return <ReviewQueue />;
}
