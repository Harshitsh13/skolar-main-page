"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Article, Destination } from "@/lib/types";

interface AdminConfigStatus {
  adminPassword: boolean;
  blob: boolean;
  firestoreAdmin: boolean;
  firestoreProjectId: string | null;
}

type DestinationRecord = Destination & { published?: boolean };
type ArticleRecord = Article & { status?: "draft" | "published" };

interface DestinationDraft {
  id?: string;
  countryName: string;
  countryCode: string;
  title: string;
  description: string;
  category: string;
  url: string;
  ctaLabel: string;
  imageUrl: string;
  imageAlt: string;
  institutionsText: string;
  order: string;
  published: boolean;
}

interface ArticleDraft {
  id?: string;
  title: string;
  excerpt: string;
  category: string;
  coverImageUrl: string;
  coverImageAlt: string;
  publishedAt: string;
  readingMinutes: string;
  url: string;
  featured: boolean;
  status: "draft" | "published";
}

const EMPTY_DEST: DestinationDraft = {
  countryName: "",
  countryCode: "",
  title: "",
  description: "",
  category: "",
  url: "",
  ctaLabel: "Explore Platform",
  imageUrl: "",
  imageAlt: "",
  institutionsText: "",
  order: "1",
  published: true,
};

const EMPTY_ART: ArticleDraft = {
  title: "",
  excerpt: "",
  category: "Admissions",
  coverImageUrl: "",
  coverImageAlt: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  readingMinutes: "5",
  url: "",
  featured: false,
  status: "published",
};

export function AdminClient() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [config, setConfig] = useState<AdminConfigStatus | null>(null);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState<"destinations" | "articles">("destinations");
  const [destinations, setDestinations] = useState<DestinationRecord[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [destForm, setDestForm] = useState<DestinationDraft>(EMPTY_DEST);
  const [artForm, setArtForm] = useState<ArticleDraft>(EMPTY_ART);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/auth", { cache: "no-store" });
      const data = await res.json();
      setAuthed(Boolean(data.authenticated));
      setConfig(data.configured ?? null);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadContent = useCallback(async () => {
    setLoadingData(true);
    setNotice(null);
    try {
      const [dRes, aRes] = await Promise.all([
        fetch("/api/admin/destinations", { cache: "no-store" }),
        fetch("/api/admin/articles", { cache: "no-store" }),
      ]);
      const dData = await dRes.json().catch(() => ({}));
      const aData = await aRes.json().catch(() => ({}));
      if (dRes.ok) setDestinations(dData.items ?? []);
      else if (dData.message) setNotice({ kind: "err", text: dData.message });
      if (aRes.ok) setArticles(aData.items ?? []);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (authed) void loadContent();
  }, [authed, loadContent]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoggingIn(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(data.message || "Sign-in failed.");
        return;
      }
      setPassword("");
      setAuthed(true);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setAuthed(false);
    setDestinations([]);
    setArticles([]);
  };

  const uploadImage = async (file: File, folder: "destinations" | "articles"): Promise<string | null> => {
    setUploading(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data.message || "Image upload failed." });
        return null;
      }
      setNotice({ kind: "ok", text: "Image uploaded to Vercel Blob." });
      return data.url as string;
    } finally {
      setUploading(false);
    }
  };

  const saveDestination = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const institutions = destForm.institutionsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        ...(destForm.id ? { id: destForm.id } : {}),
        countryName: destForm.countryName.trim(),
        countryCode: destForm.countryCode.trim() || undefined,
        title: destForm.title.trim(),
        description: destForm.description.trim(),
        category: destForm.category.trim() || undefined,
        url: destForm.url.trim(),
        ctaLabel: destForm.ctaLabel.trim() || undefined,
        imageUrl: destForm.imageUrl.trim(),
        imageAlt: destForm.imageAlt.trim() || undefined,
        institutions: institutions.length ? institutions : undefined,
        order: Number(destForm.order) || 1,
        published: destForm.published,
      };
      const res = await fetch("/api/admin/destinations", {
        method: destForm.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data.message || "Failed to save country." });
        return;
      }
      setNotice({ kind: "ok", text: destForm.id ? "Country updated & site refreshed." : "New country added & site refreshed." });
      setDestForm({ ...EMPTY_DEST, order: String(destinations.length + 2) });
      await loadContent();
    } finally {
      setSaving(false);
    }
  };

  const toggleDestPublished = async (d: DestinationRecord) => {
    const res = await fetch("/api/admin/destinations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: d.id, published: !(d.published ?? true) }),
    });
    if (res.ok) {
      setNotice({ kind: "ok", text: `Updated ${d.countryName || d.title}.` });
      await loadContent();
    }
  };

  const deleteDestination = async (id: string) => {
    if (!window.confirm("Delete this country card from Firestore?")) return;
    const res = await fetch(`/api/admin/destinations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setNotice({ kind: "ok", text: "Country deleted." });
      if (destForm.id === id) setDestForm(EMPTY_DEST);
      await loadContent();
    }
  };

  const seedDefaults = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const defaults = [
        {
          id: "italy",
          countryName: "Italy",
          countryCode: "IT",
          title: "Explore Higher Education in Italy",
          description:
            "Degree programmes taught in English at public and private Italian universities, with guidance on pre-enrolment and document preparation.",
          category: "Undergraduate · Postgraduate · Medicine",
          url: "https://italy.skolar.it/",
          ctaLabel: "Explore Platform",
          imageUrl: "/images/campus-courtyard.webp",
          imageAlt: "Arcaded courtyard of a historic Italian university",
          order: 1,
          published: true,
        },
        {
          id: "mongolia",
          countryName: "Mongolia",
          countryCode: "MN",
          title: "Study Medicine in Mongolia",
          description:
            "A dedicated platform for students exploring English-medium medical programmes in Mongolia, from eligibility questions to arrival.",
          category: "Medicine",
          url: "https://mangolia.skolar.it/",
          ctaLabel: "Explore Platform",
          imageUrl: "/images/sample-campus-mongolia.webp",
          imageAlt: "University campus building in Ulaanbaatar",
          order: 2,
          published: true,
        },
      ];
      for (const item of defaults) {
        const res = await fetch("/api/admin/destinations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setNotice({ kind: "err", text: data.message || "Could not seed defaults." });
          return;
        }
      }
      setNotice({ kind: "ok", text: "Italy & Mongolia added to Firestore." });
      await loadContent();
    } finally {
      setSaving(false);
    }
  };

  const saveArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        ...(artForm.id ? { id: artForm.id } : {}),
        title: artForm.title.trim(),
        excerpt: artForm.excerpt.trim(),
        category: artForm.category.trim(),
        coverImageUrl: artForm.coverImageUrl.trim(),
        coverImageAlt: artForm.coverImageAlt.trim() || undefined,
        publishedAt: artForm.publishedAt.trim() || undefined,
        readingMinutes: Number(artForm.readingMinutes) || undefined,
        url: artForm.url.trim(),
        featured: artForm.featured,
        status: artForm.status,
      };
      const res = await fetch("/api/admin/articles", {
        method: artForm.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data.message || "Failed to save article." });
        return;
      }
      setNotice({ kind: "ok", text: artForm.id ? "Article updated." : "Article published." });
      setArtForm(EMPTY_ART);
      await loadContent();
    } finally {
      setSaving(false);
    }
  };

  const deleteArticle = async (id: string) => {
    if (!window.confirm("Delete this article?")) return;
    const res = await fetch(`/api/admin/articles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setNotice({ kind: "ok", text: "Article deleted." });
      if (artForm.id === id) setArtForm(EMPTY_ART);
      await loadContent();
    }
  };

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-navy-950 text-paper">
        <p className="text-sm text-paper/60">Loading SKOLAR Admin…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-navy-950 px-5 text-paper">
        <div className="w-full max-w-md rounded-[24px] bg-paper p-8 text-navy-900 shadow-2xl">
          <p className="eyebrow text-gold-600">SKOLAR Control</p>
          <h1 className="display mt-3 text-[2rem] leading-tight">Website Admin</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Sign in to add or edit destination country platforms and Insights articles.
          </p>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="admin-pw" className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                Admin Password
              </label>
              <input
                id="admin-pw"
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="mt-2 w-full rounded-xl border border-navy-900/15 bg-white px-4 py-3 text-base outline-none focus:border-navy-900"
              />
            </div>
            {authError && <p className="text-sm font-medium text-red-700">{authError}</p>}
            {config && !config.adminPassword && (
              <p className="text-xs text-amber-800">
                <code>ADMIN_PASSWORD</code> is not set in environment variables yet.
              </p>
            )}
            <button type="submit" disabled={loggingIn} className="btn btn-navy w-full">
              {loggingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="mt-6 border-t border-navy-900/10 pt-4 text-center">
            <Link href="/" className="text-xs font-medium text-ink-soft hover:text-navy-900">
              ← Back to SKOLAR website
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone text-navy-900">
      <header className="border-b border-navy-900/10 bg-navy-950 text-paper">
        <div className="container-x flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p className="eyebrow text-gold-300">SKOLAR Admin</p>
            <h1 className="display mt-1 text-[1.6rem]">Countries &amp; Insights Manager</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={`rounded-full px-3 py-1 ${config?.blob ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200"}`}>
              Blob: {config?.blob ? "Connected" : "Missing BLOB_READ_WRITE_TOKEN"}
            </span>
            <span
              className={`rounded-full px-3 py-1 ${
                config?.firestoreAdmin ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"
              }`}
            >
              Firestore Admin: {config?.firestoreAdmin ? config.firestoreProjectId || "Connected" : "Needs Service Account JSON"}
            </span>
            <Link href="/" target="_blank" className="btn btn-ghost-dark !min-h-9 !px-4 text-xs">
              View site
            </Link>
            <button type="button" onClick={handleLogout} className="btn btn-gold !min-h-9 !px-4 text-xs">
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="container-x py-10">
        {config && !config.firestoreAdmin && (
          <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-50 p-5 text-sm text-amber-950">
            <p className="font-semibold">One-time Firebase setup needed to save to Firestore:</p>
            <p className="mt-1">
              In Firebase Console (<strong>{config.firestoreProjectId || "skolar-main-page"}</strong>) →{" "}
              <strong>Project Settings → Service accounts → Generate new private key</strong>, then paste the single-line JSON into{" "}
              <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> in <code>.env.local</code> and Vercel Environment Variables. Image uploads
              to Vercel Blob already work right now.
            </p>
          </div>
        )}

        {notice && (
          <div
            className={`mb-6 rounded-xl px-4 py-3 text-sm font-medium ${
              notice.kind === "ok" ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="mb-8 flex gap-3">
          <button
            type="button"
            onClick={() => setTab("destinations")}
            className={`btn !min-h-10 !px-5 text-sm ${tab === "destinations" ? "btn-navy" : "btn-ghost-light"}`}
          >
            Country Platforms ({destinations.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("articles")}
            className={`btn !min-h-10 !px-5 text-sm ${tab === "articles" ? "btn-navy" : "btn-ghost-light"}`}
          >
            Insights Articles ({articles.length})
          </button>
        </div>

        {tab === "destinations" ? (
          <div className="grid gap-8 lg:grid-cols-12">
            <form onSubmit={saveDestination} className="space-y-4 rounded-[22px] bg-paper p-6 shadow-sm ring-1 ring-navy-900/10 lg:col-span-5">
              <div className="flex items-center justify-between">
                <h2 className="display text-[1.45rem]">{destForm.id ? "Edit Country" : "Add New Country"}</h2>
                {destForm.id && (
                  <button
                    type="button"
                    onClick={() => setDestForm(EMPTY_DEST)}
                    className="text-xs font-medium text-ink-soft underline"
                  >
                    Cancel edit
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Country Name *">
                  <input
                    required
                    value={destForm.countryName}
                    onChange={(e) => setDestForm({ ...destForm, countryName: e.target.value })}
                    placeholder="e.g. United Kingdom"
                    className={inputCls}
                  />
                </Field>
                <Field label="Country Code (2-letter)">
                  <input
                    maxLength={4}
                    value={destForm.countryCode}
                    onChange={(e) => setDestForm({ ...destForm, countryCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. GB"
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Card Title *">
                <input
                  required
                  value={destForm.title}
                  onChange={(e) => setDestForm({ ...destForm, title: e.target.value })}
                  placeholder="e.g. Study in the United Kingdom"
                  className={inputCls}
                />
              </Field>

              <Field label="Short Description *">
                <textarea
                  required
                  rows={3}
                  value={destForm.description}
                  onChange={(e) => setDestForm({ ...destForm, description: e.target.value })}
                  placeholder="1–2 crisp sentences about the platform…"
                  className={inputCls}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category / Focus">
                  <input
                    value={destForm.category}
                    onChange={(e) => setDestForm({ ...destForm, category: e.target.value })}
                    placeholder="Undergraduate · Postgraduate"
                    className={inputCls}
                  />
                </Field>
                <Field label="Platform URL *">
                  <input
                    required
                    type="url"
                    value={destForm.url}
                    onChange={(e) => setDestForm({ ...destForm, url: e.target.value })}
                    placeholder="https://uk.skolar.it/"
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-navy-900/10 bg-stone/60 p-4">
                <label className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  Country Card Image (Vercel Blob) *
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    disabled={uploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const url = await uploadImage(file, "destinations");
                      if (url) setDestForm((prev) => ({ ...prev, imageUrl: url }));
                    }}
                    className="text-xs"
                  />
                  {uploading && <span className="text-xs font-medium text-gold-600">Uploading…</span>}
                </div>
                <input
                  required
                  value={destForm.imageUrl}
                  onChange={(e) => setDestForm({ ...destForm, imageUrl: e.target.value })}
                  placeholder="https://…public.blob.vercel-storage.com/…"
                  className={`${inputCls} mt-2`}
                />
                {destForm.imageUrl && (
                  <img src={destForm.imageUrl} alt="" className="mt-3 h-32 w-full rounded-lg object-cover" />
                )}
              </div>

              <Field label="Verified Institutions (optional, one per line for AI Finder)">
                <textarea
                  rows={3}
                  value={destForm.institutionsText}
                  onChange={(e) => setDestForm({ ...destForm, institutionsText: e.target.value })}
                  placeholder="University of Bologna&#10;Sapienza University of Rome"
                  className={inputCls}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Button Label">
                  <input
                    value={destForm.ctaLabel}
                    onChange={(e) => setDestForm({ ...destForm, ctaLabel: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Order">
                  <input
                    type="number"
                    min={0}
                    value={destForm.order}
                    onChange={(e) => setDestForm({ ...destForm, order: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <label className="flex items-center gap-2 pt-6 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={destForm.published}
                    onChange={(e) => setDestForm({ ...destForm, published: e.target.checked })}
                    className="h-4 w-4 accent-navy-900"
                  />
                  Published
                </label>
              </div>

              <button type="submit" disabled={saving || uploading} className="btn btn-navy w-full">
                {saving ? "Saving…" : destForm.id ? "Update Country" : "Add Country"}
              </button>
            </form>

            <div className="space-y-4 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="display text-[1.45rem]">Saved Countries</h2>
                {destinations.length === 0 && config?.firestoreAdmin && (
                  <button type="button" onClick={seedDefaults} disabled={saving} className="btn btn-gold !min-h-9 !px-4 text-xs">
                    Import Italy &amp; Mongolia defaults
                  </button>
                )}
              </div>
              {loadingData ? (
                <p className="text-sm text-ink-soft">Loading…</p>
              ) : destinations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-navy-900/20 bg-paper p-8 text-center text-sm text-ink-soft">
                  No Firestore countries yet (the website currently shows your default Italy &amp; Mongolia cards). Add a country on
                  the left or import the defaults.
                </div>
              ) : (
                <div className="space-y-3">
                  {destinations.map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-col gap-4 rounded-2xl bg-paper p-4 shadow-sm ring-1 ring-navy-900/10 sm:flex-row sm:items-center"
                    >
                      <img src={d.imageUrl} alt="" className="h-24 w-full rounded-xl object-cover sm:w-36" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-600">
                            {d.countryName || d.countryCode}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${
                              d.published !== false ? "bg-emerald-100 text-emerald-800" : "bg-stone text-ink-soft"
                            }`}
                          >
                            {d.published !== false ? "Published" : "Hidden"}
                          </span>
                          <span className="text-xs text-ink-faint">Order #{d.order}</span>
                        </div>
                        <h3 className="mt-1 font-semibold">{d.title}</h3>
                        <p className="truncate text-xs text-ink-soft">{d.url}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => toggleDestPublished(d)}
                          className="btn btn-ghost-light !min-h-9 !px-3 text-xs"
                        >
                          {d.published !== false ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDestForm({
                              id: d.id,
                              countryName: d.countryName || "",
                              countryCode: d.countryCode || "",
                              title: d.title,
                              description: d.description,
                              category: d.category || "",
                              url: d.url,
                              ctaLabel: d.ctaLabel || "Explore Platform",
                              imageUrl: d.imageUrl,
                              imageAlt: d.imageAlt || "",
                              institutionsText: (d.institutions || []).join("\n"),
                              order: String(d.order ?? 1),
                              published: d.published !== false,
                            })
                          }
                          className="btn btn-ghost-light !min-h-9 !px-3 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDestination(d.id)}
                          className="btn btn-ghost-light !min-h-9 !px-3 text-xs text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-12">
            <form onSubmit={saveArticle} className="space-y-4 rounded-[22px] bg-paper p-6 shadow-sm ring-1 ring-navy-900/10 lg:col-span-5">
              <div className="flex items-center justify-between">
                <h2 className="display text-[1.45rem]">{artForm.id ? "Edit Article" : "Add Insights Article"}</h2>
                {artForm.id && (
                  <button type="button" onClick={() => setArtForm(EMPTY_ART)} className="text-xs text-ink-soft underline">
                    Cancel edit
                  </button>
                )}
              </div>
              <Field label="Title *">
                <input
                  required
                  value={artForm.title}
                  onChange={(e) => setArtForm({ ...artForm, title: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Excerpt *">
                <textarea
                  required
                  rows={3}
                  value={artForm.excerpt}
                  onChange={(e) => setArtForm({ ...artForm, excerpt: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category *">
                  <input
                    required
                    value={artForm.category}
                    onChange={(e) => setArtForm({ ...artForm, category: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Article URL *">
                  <input
                    required
                    value={artForm.url}
                    onChange={(e) => setArtForm({ ...artForm, url: e.target.value })}
                    placeholder="https://…"
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="rounded-xl border border-navy-900/10 bg-stone/60 p-4">
                <label className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  Cover Image (Vercel Blob) *
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = await uploadImage(file, "articles");
                    if (url) setArtForm((prev) => ({ ...prev, coverImageUrl: url }));
                  }}
                  className="mt-2 text-xs"
                />
                <input
                  required
                  value={artForm.coverImageUrl}
                  onChange={(e) => setArtForm({ ...artForm, coverImageUrl: e.target.value })}
                  placeholder="https://…"
                  className={`${inputCls} mt-2`}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Publish Date">
                  <input
                    type="date"
                    value={artForm.publishedAt}
                    onChange={(e) => setArtForm({ ...artForm, publishedAt: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Read Mins">
                  <input
                    type="number"
                    min={1}
                    value={artForm.readingMinutes}
                    onChange={(e) => setArtForm({ ...artForm, readingMinutes: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={artForm.status}
                    onChange={(e) => setArtForm({ ...artForm, status: e.target.value as "draft" | "published" })}
                    className={inputCls}
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={artForm.featured}
                  onChange={(e) => setArtForm({ ...artForm, featured: e.target.checked })}
                  className="h-4 w-4 accent-navy-900"
                />
                Pin as Featured lead article
              </label>
              <button type="submit" disabled={saving || uploading} className="btn btn-navy w-full">
                {saving ? "Saving…" : artForm.id ? "Update Article" : "Publish Article"}
              </button>
            </form>

            <div className="space-y-3 lg:col-span-7">
              <h2 className="display text-[1.45rem]">Saved Articles</h2>
              {articles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-navy-900/20 bg-paper p-8 text-center text-sm text-ink-soft">
                  No articles saved in Firestore yet.
                </div>
              ) : (
                articles.map((a) => (
                  <div key={a.id} className="flex flex-col gap-4 rounded-2xl bg-paper p-4 shadow-sm ring-1 ring-navy-900/10 sm:flex-row sm:items-center">
                    <img src={a.coverImageUrl} alt="" className="h-20 w-full rounded-xl object-cover sm:w-32" />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-600">
                        {a.category} · {a.status ?? "published"}
                      </span>
                      <h3 className="mt-1 font-semibold">{a.title}</h3>
                      <p className="truncate text-xs text-ink-soft">{a.url}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setArtForm({
                            id: a.id,
                            title: a.title,
                            excerpt: a.excerpt,
                            category: a.category,
                            coverImageUrl: a.coverImageUrl,
                            coverImageAlt: a.coverImageAlt || "",
                            publishedAt: a.publishedAt || "",
                            readingMinutes: String(a.readingMinutes ?? 5),
                            url: a.url,
                            featured: Boolean(a.featured),
                            status: a.status ?? "published",
                          })
                        }
                        className="btn btn-ghost-light !min-h-9 !px-3 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteArticle(a.id)}
                        className="btn btn-ghost-light !min-h-9 !px-3 text-xs text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const inputCls =
  "mt-1.5 w-full rounded-xl border border-navy-900/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-navy-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

