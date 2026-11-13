import { studioEnv } from "./env";
import { errorMessage } from "./util";

/**
 * Deployment tracking and public verification for publishing.
 *
 * After a commit, the deployment is looked up with (in order):
 *   1. Vercel REST API      — VERCEL_TOKEN + VERCEL_PROJECT_ID (+ VERCEL_TEAM_ID)
 *   2. GitHub Deployments   — the Vercel GitHub app reports deployments per commit
 *   3. GitHub commit status — fallback
 * Then the live page is fetched and must contain the article's content key.
 */

export type DeployState = "pending" | "building" | "ready" | "error" | "canceled" | "not_found" | "unknown";

export interface DeploymentInfo {
  provider: "vercel" | "github-deployments" | "github-status" | "none";
  id?: string;
  state: DeployState;
  url?: string;
  message: string;
}

const v = (k: string) => process.env[k]?.trim() || "";

export function vercelConfigured() {
  return Boolean(v("VERCEL_TOKEN") && v("VERCEL_PROJECT_ID"));
}

async function vercelDeployment(sha: string): Promise<DeploymentInfo | null> {
  if (!vercelConfigured()) return null;
  const team = v("VERCEL_TEAM_ID") ? `&teamId=${encodeURIComponent(v("VERCEL_TEAM_ID"))}` : "";
  const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(v("VERCEL_PROJECT_ID"))}&target=production&limit=20${team}`, {
    headers: { Authorization: `Bearer ${v("VERCEL_TOKEN")}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) return { provider: "vercel", state: "unknown", message: `Vercel API HTTP ${res.status}` };
  const data = (await res.json()) as { deployments?: Array<{ uid: string; state?: string; readyState?: string; url?: string; meta?: { githubCommitSha?: string } }> };
  const d = data.deployments?.find((x) => x.meta?.githubCommitSha === sha);
  if (!d) return { provider: "vercel", state: "not_found", message: "No production deployment for this commit yet." };
  const st = (d.readyState ?? d.state ?? "").toUpperCase();
  const state: DeployState = st === "READY" ? "ready" : st === "ERROR" ? "error" : st === "CANCELED" ? "canceled" : st === "BUILDING" || st === "INITIALIZING" ? "building" : "pending";
  return { provider: "vercel", id: d.uid, state, url: d.url ? `https://${d.url}` : undefined, message: `Vercel deployment ${d.uid}: ${st || "queued"}` };
}

async function gh(path: string) {
  const cfg = studioEnv.github();
  if (!cfg) return null;
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "skolar-studio" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  return res;
}

async function githubDeployment(sha: string): Promise<DeploymentInfo | null> {
  const res = await gh(`/deployments?sha=${sha}&per_page=10`);
  if (!res) return null;
  if (!res.ok) return { provider: "github-deployments", state: "unknown", message: `GitHub deployments HTTP ${res.status}` };
  const list = (await res.json()) as Array<{ id: number; environment: string; production_environment?: boolean }>;
  const dep = list.find((d) => d.production_environment || /^production$/i.test(d.environment)) ?? null;
  if (!dep) {
    // Fall back to the combined commit status (Vercel also posts one).
    const s = await gh(`/commits/${sha}/status`);
    if (s?.ok) {
      const st = (await s.json()) as { state?: string; total_count?: number };
      if (st.total_count) {
        const state: DeployState = st.state === "success" ? "ready" : st.state === "failure" || st.state === "error" ? "error" : "pending";
        return { provider: "github-status", state, message: `Commit status: ${st.state}` };
      }
    }
    return { provider: "github-deployments", state: "not_found", message: "No production deployment reported for this commit yet." };
  }
  const sres = await gh(`/deployments/${dep.id}/statuses?per_page=5`);
  const statuses = sres?.ok ? ((await sres.json()) as Array<{ state: string; environment_url?: string; target_url?: string }>) : [];
  const top = statuses[0];
  const map: Record<string, DeployState> = { success: "ready", failure: "error", error: "error", inactive: "ready", in_progress: "building", queued: "pending", pending: "pending" };
  return { provider: "github-deployments", id: String(dep.id), state: top ? map[top.state] ?? "unknown" : "pending", url: top?.environment_url || top?.target_url, message: `GitHub deployment ${dep.id} (${dep.environment}): ${top?.state ?? "created"}` };
}

export async function deploymentFor(sha: string): Promise<DeploymentInfo> {
  try {
    return (await vercelDeployment(sha)) ?? (await githubDeployment(sha)) ?? { provider: "none", state: "unknown", message: "No deployment tracking configured (set VERCEL_TOKEN + VERCEL_PROJECT_ID, or GITHUB_TOKEN)." };
  } catch (err) {
    return { provider: "none", state: "unknown", message: `Deployment lookup failed: ${errorMessage(err)}` };
  }
}

/** Triggers a fresh production deployment without a new commit (Vercel deploy hook). */
export async function triggerRedeploy(): Promise<{ ok: boolean; message: string }> {
  const hook = v("VERCEL_DEPLOY_HOOK_URL");
  if (!hook) return { ok: false, message: "VERCEL_DEPLOY_HOOK_URL is not set — cannot trigger a redeploy without a new commit." };
  try {
    const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(20_000) });
    return res.ok ? { ok: true, message: "Redeploy triggered." } : { ok: false, message: `Deploy hook HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * Verifies the article is live: the public page returns 200 and carries the
 * exact content key of the version that was published.
 */
export async function verifyPublicArticle(slug: string, contentKey: string, baseUrl = studioEnv.siteUrl()): Promise<{ ok: boolean; status: number; message: string }> {
  const url = `${baseUrl}/insights/${slug}?v=${contentKey.slice(0, 8)}`;
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "SKOLAR-Studio-Verifier/1.0" } });
    if (res.status === 404) return { ok: false, status: 404, message: `${baseUrl}/insights/${slug} returns 404 (not deployed yet).` };
    if (!res.ok) return { ok: false, status: res.status, message: `${baseUrl}/insights/${slug} returned HTTP ${res.status}.` };
    const html = await res.text();
    const m = /<meta name="skolar-content-key" content="([a-f0-9]+)"/.exec(html);
    if (!m) return { ok: false, status: res.status, message: "Page is live but has no content key (old site version deployed)." };
    if (m[1] !== contentKey) return { ok: false, status: res.status, message: "Page is live but shows a different version of the article (deployment not finished or cached)." };
    return { ok: true, status: res.status, message: `Verified live at ${baseUrl}/insights/${slug}` };
  } catch (err) {
    return { ok: false, status: 0, message: `Could not reach ${baseUrl}: ${errorMessage(err)}` };
  }
}

/** Is the production site reachable, and does it run a build that contains SKOLAR Studio publishing? */
export async function productionProbe(baseUrl = studioEnv.siteUrl()): Promise<{ ok: boolean; message: string; studioDeployed: boolean }> {
  try {
    const home = await fetch(baseUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!home.ok) return { ok: false, studioDeployed: false, message: `${baseUrl} returned HTTP ${home.status}` };
    const probe = await fetch(`${baseUrl}/api/studio/cron`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const studioDeployed = probe.status === 401 || probe.status === 503;
    return {
      ok: studioDeployed,
      studioDeployed,
      message: studioDeployed ? `${baseUrl} is live and runs a build with SKOLAR Studio publishing.` : `${baseUrl} is live, but the deployed build does not include SKOLAR Studio yet (commit and deploy this code).`,
    };
  } catch (err) {
    return { ok: false, studioDeployed: false, message: `Could not reach ${baseUrl}: ${errorMessage(err)}` };
  }
}
