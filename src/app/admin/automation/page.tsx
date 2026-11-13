import type { Metadata } from "next";
import { Suspense } from "react";
import { Automation } from "@/studio/ui/Automation";

export const metadata: Metadata = { title: "Blog Automation" };

export default function Page() {
  return (
    <Suspense>
      <Automation />
    </Suspense>
  );
}
