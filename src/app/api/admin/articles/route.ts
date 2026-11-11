import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdminStore } from "@/lib/admin-api";

export const runtime = "nodejs";

const COL = "siteArticles";

const articleInputSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(3).max(160),
  excerpt: z.string().trim().min(5).max(400),
  category: z.string().trim().min(2).max(60),
  coverImageUrl: z.string().trim().min(1),
  coverImageAlt: z.string().trim().max(160).optional(),
  publishedAt: z.string().trim().min(4).max(40).optional(),
  readingMinutes: z.number().int().min(1).max(60).optional(),
  url: z.string().trim().min(1),
  featured: z.boolean().default(false),
  status: z.enum(["draft", "published"]).default("published"),
});

const patchSchema = articleInputSchema.partial().extend({
  id: z.string().trim().min(1).max(80),
});

function cleanPayload(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export async function GET() {
  return withAdminStore(async (store) => {
    const docs = await store.list(COL);
    const items = docs.sort((a, b) =>
      String((b as { publishedAt?: string }).publishedAt ?? "").localeCompare(
        String((a as { publishedAt?: string }).publishedAt ?? ""),
      ),
    );
    return { items };
  });
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = articleInputSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message || "Invalid article fields." },
      { status: 400 },
    );
  }
  return withAdminStore(async (store) => {
    const now = new Date().toISOString();
    const { id: requestedId, ...data } = parsed.data;
    const id = requestedId || `art-${Date.now().toString(36)}`;
    const doc = cleanPayload({
      ...data,
      id,
      publishedAt: data.publishedAt || now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    });
    await store.set(COL, id, doc);
    revalidatePath("/", "layout");
    return { item: doc };
  });
}

export async function PATCH(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message || "Invalid article update." },
      { status: 400 },
    );
  }
  return withAdminStore(async (store) => {
    const { id, ...updates } = parsed.data;
    await store.set(COL, id, cleanPayload({ ...updates, updatedAt: new Date().toISOString() }), true);
    revalidatePath("/", "layout");
    return { ok: true, id };
  });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "missing_id", message: "Missing article id." }, { status: 400 });
  }
  return withAdminStore(async (store) => {
    await store.remove(COL, id);
    revalidatePath("/", "layout");
    return { ok: true, id };
  });
}

