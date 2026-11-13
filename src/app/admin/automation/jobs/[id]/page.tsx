import type { Metadata } from "next";
import { LiveJobView } from "@/studio/ui/LiveJob";

export const metadata: Metadata = { title: "Live job" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveJobView id={id} />;
}
