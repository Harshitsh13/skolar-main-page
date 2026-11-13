import type { Metadata } from "next";
import { Editor } from "@/studio/ui/Editor";

export const metadata: Metadata = { title: "Article" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor id={id} />;
}
