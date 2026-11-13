import type { Metadata } from "next";
import { isAdminAuthenticated, isAdminConfigured } from "@/lib/admin-auth";
import { StudioShell } from "@/studio/ui/Shell";
import { StudioLogin } from "@/studio/ui/Login";

export const metadata: Metadata = {
  title: { default: "SKOLAR Studio", template: "%s · SKOLAR Studio" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Every /admin route is gated here (server-side); the Studio API checks again on each request. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdminAuthenticated())) return <StudioLogin configured={isAdminConfigured()} />;
  return <StudioShell>{children}</StudioShell>;
}
