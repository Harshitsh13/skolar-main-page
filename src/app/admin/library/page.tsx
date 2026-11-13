import type { Metadata } from "next";
import { Suspense } from "react";
import { Library } from "@/studio/ui/Lists";

export const metadata: Metadata = { title: "Content Library" };

export default function Page() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}
