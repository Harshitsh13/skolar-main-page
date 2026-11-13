import type { Metadata } from "next";
import { ComingSoon } from "@/studio/ui/Admin";

export const metadata: Metadata = { title: "Coming soon" };

export default async function Page({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  return <ComingSoon slug={module} />;
}
