import type { Metadata } from "next";
import { WriteArticle } from "@/studio/ui/Lists";

export const metadata: Metadata = { title: "Write article" };

export default function Page() {
  return <WriteArticle />;
}
