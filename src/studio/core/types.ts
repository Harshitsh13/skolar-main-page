/**
 * SKOLAR Studio domain types. Shared by the Next.js server, the background
 * worker and (as type-only imports) the admin UI. No runtime code here.
 */

export type CategoryKey =
  | "comparison"
  | "university_guide"
  | "programmes"
  | "scholarship"
  | "admissions"
  | "visa"
  | "student_life"
  | "cost_of_living"
  | "city_guide"
  | "trending"
  | "practical"
  | "other";

export type ArticleStatus =
  | "researching"
  | "draft"
  | "needs_review"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "rejected"
  | "failed";

export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "needs_review"
  | "conflicting"
  | "unverified"
  | "outdated";

export type SourceType =
  | "official_university"
  | "government"
  | "scholarship_authority"
  | "application_portal"
  | "publication"
  | "other";

export interface ArticleSource {
  n: number;
  title: string;
  url: string;
  type: SourceType;
  publisher?: string;
  accessedAt?: string;
  /** Publication or last-updated date reported by the page, if any. */
  pageDate?: string;
  academicYear?: string;
}

export interface ArticleFact {
  id: string;
  statement: string;
  /** Verbatim text from the source page that supports the statement. */
  quote: string;
  sourceN: number;
  academicYear?: string | null;
  status: VerificationStatus;
  question?: string;
}

export interface ArticleClaim {
  id: string;
  text: string;
  sourceNs: number[];
  status: VerificationStatus;
  note?: string;
  academicYear?: string;
}

export type WarningSeverity = "block" | "warn" | "info";

export interface EditorialWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  excerpt?: string;
  origin: "rules" | "ai" | "pipeline";
}

/** One image in an article's gallery (generated, uploaded or chosen from the library). */
export interface ArticleImage {
  id: string;
  version: number;
  /** 16:10 article cover. */
  url: string;
  /** 4:3 card rendition for listings (generated images). */
  cardUrl?: string;
  width: number;
  height: number;
  blobPaths: string[];
  alt: string;
  source: "generated" | "upload" | "library";
  provider?: string;
  model?: string;
  format?: string;
  palette?: string;
  concept?: string;
  prompt?: string;
  spec?: Record<string, unknown>;
  qc?: { passed: boolean; problems: string[]; attempts: number };
  hash?: string;
  credit?: string;
  license?: string;
  sourceUrl?: string;
  createdAt: string;
}

export interface CoverImage {
  url: string;
  cardUrl?: string;
  imageId?: string;
  alt: string;
  caption?: string;
  credit?: string;
  license?: string;
  sourceUrl?: string;
  mediaId?: string;
}

export interface ArticleCta {
  key: string;
  text: string;
  label: string;
}

export interface ScheduleChange {
  at: string;
  from: string | null;
  to: string | null;
  reason: string;
}

export interface ArticleSchedule {
  /** UTC ISO time of publication. */
  at: string;
  /** Manually chosen time — never moved by automatic recalculation. */
  pinned: boolean;
  history: ScheduleChange[];
}

export interface PublishHistoryEntry {
  at: string;
  action: "commit" | "no_change" | "deployment" | "verified" | "failed" | "retry" | "local_file" | "redeploy";
  message: string;
  commitSha?: string;
  deploymentId?: string;
}

export interface PublishState {
  /**
   * publishing → (commit) → deploying → verifying → published.
   * awaiting_push: written to content/insights locally; goes live once pushed & deployed.
   */
  state: "idle" | "publishing" | "deploying" | "verifying" | "awaiting_push" | "published" | "failed";
  failedStep?: "validation" | "commit" | "deployment" | "verification";
  committedAt?: string;
  deploymentId?: string;
  deploymentProvider?: string;
  deploymentUrl?: string;
  verifiedAt?: string;
  /** Publication date written into the file (fixed at the first commit so retries are byte-identical). */
  fileDate?: string;
  /** True when re-publishing an already-live article (the old version stays live meanwhile). */
  isUpdate?: boolean;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  lockUntil?: string;
  commitSha?: string;
  repo?: string;
  branch?: string;
  path?: string;
  url?: string;
  contentHash?: string;
  /** Hash of the article's content fields (no timestamps): decides whether a re-publish is a real update. */
  contentKey?: string;
  contentUpdatedAt?: string;
  target?: "github" | "local-file" | "none";
  siteRecord?: "firestore" | "skipped";
  deployment?: string;
  publishedAt?: string;
}

export interface StudioArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: CategoryKey;
  countryId: string;
  universityIds: string[];
  scholarshipIds: string[];
  audience: string;
  academicYear?: string;
  seoTitle: string;
  metaDescription: string;
  readingMinutes: number;
  tags: string[];
  coverImage?: CoverImage;
  images?: ArticleImage[];
  imageState?: { status: "pending" | "generating" | "ready" | "failed"; error?: string; at: string };
  cta?: ArticleCta;
  sources: ArticleSource[];
  facts: ArticleFact[];
  claims: ArticleClaim[];
  warnings: EditorialWarning[];
  relatedSlugs: string[];
  status: ArticleStatus;
  origin: "ai" | "manual";
  jobId?: string;
  topicId?: string;
  qualityGate?: { passed: boolean; reasons: string[]; checkedAt: string };
  generation?: {
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    calls: Array<{ stage: string; provider: string; model: string; at: string }>;
  };
  schedule?: ArticleSchedule;
  publish?: PublishState;
  publishHistory?: PublishHistoryEntry[];
  review?: { approvedAt?: string; rejectedAt?: string; rejectReason?: string };
  version: number;
  createdAt: string;
  updatedAt: string;
}

/* ───────────────────────── Jobs ───────────────────────── */

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_network"
  | "waiting_api"
  | "failed"
  | "needs_review"
  | "completed"
  | "cancelled";

export const PIPELINE_STAGES = [
  "plan",
  "sources",
  "collect",
  "extract",
  "organise",
  "outline",
  "write",
  "verify",
  "review",
  "seo",
  "links",
  "image_concept",
  "image_generate",
  "image_upload",
  "finalize",
] as const;
export type StageKey = (typeof PIPELINE_STAGES)[number];

export interface JobLogEntry {
  at: string;
  stage: StageKey | "job";
  level: "info" | "warn" | "error";
  message: string;
}

export interface StudioJob {
  id: string;
  topic: string;
  topicId?: string;
  category: CategoryKey;
  countryId: string;
  entityIds: string[];
  origin: "auto" | "manual" | "source_change" | "regenerate";
  status: JobStatus;
  stage: StageKey;
  completedStages: StageKey[];
  progress: number;
  retryCount: number;
  maxRetries: number;
  nextRunAt?: string;
  lastError?: string;
  lastErrorKind?: string;
  lease?: { owner: string; until: string };
  /** Stage outputs (resumable checkpoints). */
  checkpoints: Partial<Record<StageKey, unknown>>;
  lastCheckpointAt?: string;
  articleId?: string;
  /** For regenerate jobs: existing article whose content will be replaced (as a new version). */
  targetArticleId?: string;
  dayKey: string;
  log: JobLogEntry[];
  /** What the worker is doing right now (persisted, shown live in Studio). */
  activity?: { stage: StageKey; message: string; at: string };
  stageTimes?: Partial<Record<StageKey, { startedAt: string; completedAt?: string; failedAt?: string; attempts: number }>>;
  /** Audit trail: which provider/model produced each stage. */
  calls?: Array<{ stage: string; provider: string; model: string; at: string }>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/* ───────────────────────── Topics ───────────────────────── */

export type TopicStatus = "suggested" | "approved" | "in_progress" | "used" | "dismissed";

export interface StudioTopic {
  id: string;
  title: string;
  category: CategoryKey;
  countryId: string;
  entityIds: string[];
  rationale: string;
  intent?: string;
  score: number;
  origin: "template" | "search" | "source_change" | "manual" | "ai";
  sourceUrl?: string;
  status: TopicStatus;
  jobId?: string;
  duplicateOf?: { kind: "article" | "topic"; id: string; title: string; similarity: number };
  /** Where the idea came from — each signal names its source and collection date. */
  signals?: Array<{ kind: string; source: string; detail: string; url?: string; collectedAt: string }>;
  /** Relevance to Indian students planning to study in Italy (AI-assessed, with reason). */
  relevance?: { score: number; reason: string; assessedBy: string };
  createdAt: string;
  updatedAt: string;
}

/* ───────────────────────── Research data ───────────────────────── */

export interface CountryPublishState {
  state: "draft" | "deploying" | "verifying" | "awaiting_push" | "published" | "failed";
  contentKey?: string;
  commitSha?: string;
  committedAt?: string;
  publishedAt?: string;
  verifiedAt?: string;
  path?: string;
  lastError?: string;
  history?: Array<{ at: string; message: string }>;
}

export interface StudioCountry {
  id: string;
  name: string;
  code: string;
  active: boolean;
  currency: string;
  /* ── Public website fields (country cards + /countries/<slug>) ── */
  slug?: string;
  flag?: string;
  cardTitle?: string;
  shortDescription?: string;
  focus?: string;
  image?: { url: string; alt: string; credit?: string; license?: string };
  introContent?: string;
  links?: Array<{ label: string; url: string }>;
  platformUrl?: string;
  ctaLabel?: string;
  order?: number;
  publish?: CountryPublishState;
  /** Month (1-12) the academic year starts. Italy: 9 (Sept/Oct intake). */
  academicYearStartMonth: number;
  academicYearFormat: "YYYY/YYYY" | "YYYY";
  extraCategories: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StudioRegion {
  id: string;
  countryId: string;
  name: string;
  cities: string[];
  resources: Array<{ label: string; url: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface CourseRecord {
  name: string;
  level: "bachelor" | "master" | "single_cycle" | "phd" | "other";
  language: "english" | "italian" | "mixed" | "unknown";
  academicYear: string;
  durationYears?: number | null;
  url?: string;
  verified: boolean;
}

export interface StudioUniversity {
  id: string;
  countryId: string;
  regionId?: string;
  name: string;
  shortName?: string;
  city?: string;
  website: string;
  officialDomains: string[];
  campuses: string[];
  departments: string[];
  courses: CourseRecord[];
  scholarshipIds: string[];
  languageNotes?: string;
  notes?: string;
  researchEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudioScholarship {
  id: string;
  countryId: string;
  regionId?: string;
  name: string;
  organisation: string;
  website: string;
  portalUrl?: string;
  universityIds: string[];
  academicYear?: string;
  eligibility?: string;
  benefits?: string;
  notes?: string;
  monitor: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SourceCategory =
  | "university"
  | "government"
  | "scholarship"
  | "application_portal"
  | "consulate"
  | "publication"
  | "other";

export interface StudioSource {
  id: string;
  name: string;
  url: string;
  countryId: string;
  regionId?: string;
  universityId?: string;
  scholarshipId?: string;
  category: SourceCategory;
  monitor: boolean;
  frequencyHours: number;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastChangeAt?: string;
  lastStatus?: "ok" | "changed" | "error" | "blocked";
  lastError?: string;
  consecutiveFailures: number;
  nextCheckAt?: string;
  contentHash?: string;
  linkCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceChange {
  id: string;
  sourceId: string;
  sourceName: string;
  url: string;
  detectedAt: string;
  newLinks: Array<{ text: string; url: string }>;
  summary: string;
  meaningful: boolean | null;
  academicYear?: string | null;
  action: "new_article" | "update_article" | "ignore" | "pending";
  topicId?: string;
  relatedArticleId?: string;
}

/* ───────────────────────── Providers & usage ───────────────────────── */

export type ProviderKind = "groq" | "openai_compatible";

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** "env:NAME" reference or "enc:..." encrypted secret. Never sent to the browser. */
  keyRef: string;
  keyHint: string;
  enabled: boolean;
  priority: number;
  structuredOutput: "json_schema" | "json_object";
  capabilities: string[];
  pricing?: { inputPerMTok: number; outputPerMTok: number; currency: string } | null;
  state: {
    lastSuccessAt?: string;
    lastErrorAt?: string;
    lastError?: string;
    lastErrorKind?: string;
    rateLimitedUntil?: string;
    /** Set on permanent errors (invalid key / unknown model). Cleared by a successful test. */
    needsAttention?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UsageDay {
  id: string; // `${day}__${providerId}__${model}`
  day: string;
  providerId: string;
  providerName: string;
  model: string;
  requests: number;
  failures: number;
  rateLimits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
  currency: string | null;
  durationMs: number;
}

/* ───────────────────────── Settings ───────────────────────── */

export interface CtaTemplate {
  key: string;
  label: string;
  text: string;
  categories: CategoryKey[];
}

export interface StudioSettings {
  automation: {
    enabled: boolean;
    dailyTarget: number;
    autoPickTopics: boolean;
    maxRetries: number;
    /** Hard cap on jobs started per day so a failing pipeline cannot burn API quota. */
    maxJobsPerDay: number;
    minSourcesForDraft: number;
    minWords: number;
  };
  publishing: {
    timezone: string;
    times: string[];
    days: number[]; // 0 = Sunday … 6 = Saturday
    maxPerDay: number;
    minIntervalMinutes: number;
    allowWeekends: boolean;
    autoQueue: boolean;
  };
  monitoring: { enabled: boolean; defaultFrequencyHours: number };
  demand: { suggestEnabled: boolean };
  ctas: CtaTemplate[];
  updatedAt?: string;
}

/* ───────────────────────── Ops ───────────────────────── */

export type WorkerState =
  | "running"
  | "idle"
  | "paused"
  | "api_limited"
  | "offline"
  | "attention"
  | "stopped";

export interface WorkerStatus {
  id: "status";
  state: WorkerState;
  message: string;
  heartbeatAt: string;
  startedAt: string;
  pid: number;
  platform: string;
  currentJobId?: string | null;
  cleanShutdown?: boolean;
}

export interface StudioNotification {
  id: string;
  kind:
    | "daily_target"
    | "awaiting_approval"
    | "source_change"
    | "rate_limit"
    | "provider_down"
    | "generation_failed"
    | "publish_failed"
    | "published"
    | "schedule_due"
    | "network"
    | "worker_stopped"
    | "info";
  level: "info" | "success" | "warning" | "error";
  title: string;
  body?: string;
  href?: string;
  read: boolean;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: "admin" | "worker" | "system";
  action: string;
  message: string;
  refId?: string;
}

export interface DailyStats {
  id: string; // YYYY-MM-DD in publishing timezone
  completedDraftIds: string[];
  jobsStarted: string[];
  failedJobIds: string[];
  researchedTopics: number;
  approvedIds: string[];
  publishedIds: string[];
  rejectedIds: string[];
  generationMs: number;
  shortfallReason?: string;
  targetNotified?: boolean;
}

export interface MediaRecord {
  id: string; // sha256 of optimised bytes
  url: string;
  path: string;
  storage: "firebase" | "blob" | "local";
  width: number;
  height: number;
  bytes: number;
  alt: string;
  credit?: string;
  license?: string;
  sourceUrl?: string;
  createdAt: string;
}

export type JobEventType =
  | "job_queued"
  | "stage_started"
  | "progress"
  | "stage_completed"
  | "stage_failed"
  | "retry_scheduled"
  | "waiting"
  | "job_completed"
  | "job_needs_review"
  | "job_failed"
  | "job_control";

export interface JobEvent {
  id: string;
  jobId: string;
  at: string;
  type: JobEventType;
  stage?: StageKey;
  message: string;
  worker?: string;
}

export interface WorkerInstance {
  id: string;
  host: string;
  platform: string;
  pid: number;
  role: "leader" | "follower";
  state: WorkerState;
  message: string;
  startedAt: string;
  heartbeatAt: string;
  currentJobId?: string | null;
  stoppedAt?: string;
  cleanShutdown?: boolean;
}
