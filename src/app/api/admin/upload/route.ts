import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 6 * 1024 * 1024;

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "unauthorized", message: "Please sign in first." }, { status: 401 });
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "blob_not_configured", message: "BLOB_READ_WRITE_TOKEN is not set in environment variables." },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const folderRaw = form?.get("folder");
  const folder = folderRaw === "articles" ? "articles" : "destinations";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file", message: "Please select an image file to upload." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "invalid_type", message: "Only JPEG, PNG, WebP, or AVIF images are allowed." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", message: "Image must be 6 MB or smaller." }, { status: 400 });
  }

  const cleanName = (file.name || "image.webp").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const pathname = `site/${folder}/${cleanName || "image.webp"}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
      token,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("[admin/upload] failed:", err);
    return NextResponse.json(
      { error: "upload_failed", message: err instanceof Error ? err.message : "Image upload failed." },
      { status: 500 },
    );
  }
}

