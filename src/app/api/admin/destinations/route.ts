import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdminStore } from "@/lib/admin-api";

export const runtime = "nodejs";

const COL = "siteDestinations";

const destinationInputSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().min(5).max(400),
  category: z.string().trim().max(120).optional(),
  countryName: z.string().trim().min(2).max(80),
  countryCode: z.string().trim().max(4).optional(),
  imageUrl: z.string().trim().min(1),
  imageAlt: z.string().trim().max(160).optional(),
  url: z.string().trim().url(),
  ctaLabel: z.string().trim().max(60).optional(),
  institutions: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  order: z.number().int().min(0).max(999).optional(),
  published: z.boolean().default(true),
});

const patchSchema = destinationInputSchema.partial().extend({
  id: z.string().trim().min(1).max(80),
});

function cleanPayload(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export async function GET() {
  return withAdminStore(async (store) => {
    const docs = await store.list(COL);
    const items = docs.sort(
      (a, b) => Number((a as { order?: number }).order ?? 999) - Number((b as { order?: number }).order ?? 999),
    );
    return { items };
  });
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = destinationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message || "Invalid destination fields." },
      { status: 400 },
    );
  }
  return withAdminStore(async (store) => {
    const now = new Date().toISOString();
    const { id: requestedId, ...data } = parsed.data;
    const docs = await store.list(COL);
    const nextOrder =
      data.order ??
      (docs.length ? Math.max(...docs.map((d) => Number((d as { order?: number }).order ?? 0))) + 1 : 1);

    const slug = data.countryName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const id = requestedId || `${slug || "dest"}-${Date.now().toString(36)}`;
    const doc = cleanPayload({
      ...data,
      id,
      countryCode: data.countryCode ? data.countryCode.toUpperCase() : undefined,
      order: nextOrder,
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
      { error: "invalid_input", message: parsed.error.issues[0]?.message || "Invalid update fields." },
      { status: 400 },
    );
  }
  return withAdminStore(async (store) => {
    const { id, ...updates } = parsed.data;
    const doc = cleanPayload({
      ...updates,
      countryCode: updates.countryCode ? updates.countryCode.toUpperCase() : updates.countryCode,
      updatedAt: new Date().toISOString(),
    });
    await store.set(COL, id, doc, true);
    revalidatePath("/", "layout");
    return { ok: true, id };
  });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "missing_id", message: "Missing destination id." }, { status: 400 });
  }
  return withAdminStore(async (store) => {
    await store.remove(COL, id);
    revalidatePath("/", "layout");
    return { ok: true, id };
  });
}

