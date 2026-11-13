import type { CategoryKey, CtaTemplate, SourceType } from "./types";

/**
 * Editorial strategy per content category: what to research, how the article
 * is structured, which sources count, and category-specific safety rules.
 * This file is client-safe (no Node imports) so the UI can show labels.
 */

export interface CategoryStrategy {
  key: CategoryKey;
  label: string;
  short: string;
  description: string;
  audience: string;
  /** Questions the research stage must try to answer from sources. */
  researchQuestions: string[];
  /** Required article structure (the outline must include these, in order). */
  skeleton: string[];
  preferredSources: SourceType[];
  /** Extra instructions given to the writer for this category. */
  writerRules: string[];
  /** Time-sensitive categories must state the academic year. */
  timeSensitive: boolean;
  defaultCta: string;
  /** Link keywords used to find deeper pages on official sites. */
  linkKeywords: string[];
}

const COMMON_LINKS = [
  "international", "admission", "apply", "english", "foreign", "incoming", "welcome", "students",
  // Italian terms used on official university sites
  "iscrizion", "immatricolazion", "ammission", "titolo estero", "titolo-estero", "stranieri",
  "offerta formativa", "offerta-formativa", "corsi di laurea", "tasse", "contribuzion",
];

export const STRATEGIES: Record<CategoryKey, CategoryStrategy> = {
  comparison: {
    key: "comparison",
    label: "University comparison",
    short: "Comparison",
    description: "Balanced side-by-side comparisons of two or more universities or options.",
    audience: "Indian students shortlisting universities in Italy",
    researchQuestions: [
      "Background and location of each university",
      "English-taught Bachelor's and Master's programmes offered (with academic year)",
      "Admission and language requirements for international students",
      "Tuition fee structure and how fees are calculated",
      "Scholarships or regional financial aid available to students of each university",
      "Accommodation and student services, including international student office",
      "City, transport and campus environment",
    ],
    skeleton: [
      "Introduction",
      "Quick comparison summary",
      "University profiles",
      "Comparison table",
      "Programmes and academic differences",
      "Fees and financial considerations",
      "Student life and facilities",
      "Strengths and limitations",
      "Who might prefer each option",
      "Final thoughts",
    ],
    preferredSources: ["official_university", "scholarship_authority", "government"],
    writerRules: [
      "Never declare a universal winner. The recommendation depends on course, academic profile, budget and preferences.",
      "Include a Markdown comparison table. Use 'Not verified' in any cell without a supporting fact.",
      "Give each option a fair, equally detailed treatment.",
    ],
    timeSensitive: true,
    defaultCta: "explore-options",
    linkKeywords: [...COMMON_LINKS, "fees", "tuition", "tasse", "contribut", "housing", "accommodation"],
  },
  university_guide: {
    key: "university_guide",
    label: "University guide",
    short: "University",
    description: "A complete, sourced guide to one university.",
    audience: "Students considering a specific Italian university",
    researchQuestions: [
      "Official name, location and campuses",
      "Faculties/departments relevant to international students",
      "English-taught programmes (Bachelor's and Master's) for the stated academic year",
      "Entry and language requirements",
      "Application process and official application pages",
      "Tuition and fee structure",
      "Scholarships and regional financial aid",
      "Accommodation, libraries, labs and student services",
      "International student office and contacts listed on the official site",
    ],
    skeleton: [
      "Introduction",
      "At a glance",
      "Programmes and languages of instruction",
      "Admission requirements",
      "How to apply",
      "Fees and scholarships",
      "Campus life and facilities",
      "Useful official links",
      "Final thoughts",
    ],
    preferredSources: ["official_university", "application_portal", "scholarship_authority"],
    writerRules: [
      "State the academic year next to every programme, fee or deadline.",
      "If a facility, fee or deadline is not in the facts, write that it could not be verified, or omit it.",
    ],
    timeSensitive: true,
    defaultCta: "explore-options",
    linkKeywords: [...COMMON_LINKS, "courses", "degree", "corsi", "fees", "tuition", "services", "housing"],
  },
  programmes: {
    key: "programmes",
    label: "Courses & programmes",
    short: "Programmes",
    description: "English-taught and other programme guides.",
    audience: "Students looking for specific courses in Italy",
    researchQuestions: [
      "Which programmes are offered, at which level and in which language, for which academic year",
      "Duration and credits (ECTS)",
      "Entry requirements and admission tests",
      "Application windows published for the academic year",
      "Fees where officially published",
    ],
    skeleton: ["Introduction", "Programmes at a glance", "Entry requirements", "How to apply", "Costs", "Final thoughts"],
    preferredSources: ["official_university", "application_portal"],
    writerRules: ["List only programmes that appear in the facts, each with its academic year."],
    timeSensitive: true,
    defaultCta: "explore-options",
    linkKeywords: [...COMMON_LINKS, "courses", "degree", "programmes", "programs", "corsi", "laurea"],
  },
  scholarship: {
    key: "scholarship",
    label: "Scholarships & aid",
    short: "Scholarship",
    description: "Regional scholarships (e.g. ERSU, DSU, EDISU) and financial aid.",
    audience: "International students planning finances for study in Italy",
    researchQuestions: [
      "Responsible organisation and region, and which universities it covers",
      "Academic year of the call (bando) and publication date",
      "Eligibility conditions (income/ISEE or equivalent documentation, academic merit)",
      "Benefits (amounts, accommodation, meals) as officially published",
      "Application dates and portal",
      "Required documents",
      "Ranking, payment and renewal procedures",
    ],
    skeleton: [
      "Introduction",
      "Who runs this scholarship",
      "Eligibility",
      "Benefits",
      "Required documents",
      "Application process and dates",
      "Ranking, payment and renewal",
      "Common questions",
      "Final thoughts",
    ],
    preferredSources: ["scholarship_authority", "government", "official_university"],
    writerRules: [
      "Regional scholarship bodies differ: never present one body's rules as universal for Italy.",
      "Never state an amount, deadline or eligibility rule without a fact. Never promise that a student will receive the scholarship.",
      "State the academic year of the call in the introduction.",
    ],
    timeSensitive: true,
    defaultCta: "scholarship-help",
    linkKeywords: ["bando", "bandi", "borsa", "borse", "scholarship", "benefici", "concorso", "graduatori", "notice", "avvisi", "news"],
  },
  admissions: {
    key: "admissions",
    label: "Admission procedures",
    short: "Admissions",
    description: "How applications, pre-enrolment and admission work.",
    audience: "Indian students preparing to apply to Italian universities",
    researchQuestions: [
      "Steps of the official application / pre-enrolment process for the academic year",
      "Official portals involved (e.g. Universitaly) and what each step is for",
      "Documents typically requested by universities",
      "Official timelines published for the academic year",
    ],
    skeleton: ["Introduction", "The process at a glance", "Step-by-step", "Documents", "Timelines", "Common mistakes", "Final thoughts"],
    preferredSources: ["government", "application_portal", "official_university"],
    writerRules: ["Never guarantee admission. Explain that each university sets its own requirements."],
    timeSensitive: true,
    defaultCta: "admission-help",
    linkKeywords: [...COMMON_LINKS, "pre-enrolment", "preiscrizion", "visa", "procedure"],
  },
  visa: {
    key: "visa",
    label: "Visa & documentation",
    short: "Visa",
    description: "Student visa and documentation guidance from official sources.",
    audience: "Students preparing a study visa application for Italy",
    researchQuestions: [
      "Visa type for study and who needs it (official source)",
      "Documents listed by the official visa / consular sources",
      "Where and how to apply",
      "Financial means requirements as officially published",
    ],
    skeleton: ["Introduction", "Which visa applies", "Documents", "How to apply", "After arrival", "Final thoughts"],
    preferredSources: ["government", "application_portal"],
    writerRules: [
      "Never guarantee visa approval. Advise readers to confirm requirements with the official consulate or visa centre.",
      "Use only government or consular sources for visa requirements.",
    ],
    timeSensitive: true,
    defaultCta: "admission-help",
    linkKeywords: ["visa", "visti", "study", "studio", "documents", "requirements"],
  },
  student_life: {
    key: "student_life",
    label: "Student life",
    short: "Student life",
    description: "Practical life in Italy: housing, transport, banking, SIM cards.",
    audience: "Students moving to Italy",
    researchQuestions: [
      "Official or institutional information relevant to the topic (e.g. residence permit, health cover, student services)",
      "Practical steps students take, from official or reputable sources",
    ],
    skeleton: ["Introduction", "What to know first", "Step-by-step", "Practical tips", "Final thoughts"],
    preferredSources: ["official_university", "government", "publication"],
    writerRules: [
      "Separate official rules from general advice.",
      "Personal experiences must be labelled as such. Never invent a student or a testimonial.",
    ],
    timeSensitive: false,
    defaultCta: "talk-to-skolar",
    linkKeywords: ["students", "services", "housing", "accommodation", "transport", "health"],
  },
  cost_of_living: {
    key: "cost_of_living",
    label: "Cost of living",
    short: "Costs",
    description: "Budgets and cost guides with clearly labelled estimates.",
    audience: "Students budgeting for life in an Italian city",
    researchQuestions: [
      "Officially published prices (e.g. student transport passes, university canteen prices, residence fees)",
      "Published figures from reputable sources, with dates",
    ],
    skeleton: [
      "Introduction",
      "Assumptions behind these numbers",
      "Official prices",
      "Illustrative monthly budget",
      "Ways to save",
      "Final thoughts",
    ],
    preferredSources: ["official_university", "government", "scholarship_authority", "publication"],
    writerRules: [
      "Every estimate must be labelled as an estimate, with city, period, lifestyle assumptions, what is included and what is excluded.",
      "Never claim every student can live on a fixed amount. Never present an estimate as an official average.",
      "Separate officially published prices from estimates in different sections.",
    ],
    timeSensitive: true,
    defaultCta: "talk-to-skolar",
    linkKeywords: ["prices", "tariff", "fees", "canteen", "mensa", "transport", "abbonament", "housing"],
  },
  city_guide: {
    key: "city_guide",
    label: "City guide",
    short: "City",
    description: "Guides to Italian university cities for students.",
    audience: "Students choosing or moving to an Italian city",
    researchQuestions: [
      "Universities located in the city (official)",
      "Transport and student services published by official sources",
      "Housing options listed by universities or regional bodies",
    ],
    skeleton: ["Introduction", "The city at a glance", "Universities", "Getting around", "Housing", "Everyday life", "Final thoughts"],
    preferredSources: ["official_university", "government", "publication"],
    writerRules: ["Distinguish official information from general impressions. Do not invent rankings or statistics."],
    timeSensitive: false,
    defaultCta: "explore-options",
    linkKeywords: ["students", "transport", "housing", "city", "services"],
  },
  trending: {
    key: "trending",
    label: "Trending question",
    short: "Trending",
    description: "Answers to questions students are actively searching.",
    audience: "Indian students researching study in Italy",
    researchQuestions: ["The direct, sourced answer to the question", "Conditions and exceptions", "Official sources to confirm"],
    skeleton: ["Short answer", "The details", "Exceptions and conditions", "What to do next", "Final thoughts"],
    preferredSources: ["government", "official_university", "application_portal"],
    writerRules: ["Answer the question directly in the first paragraph, then explain conditions."],
    timeSensitive: true,
    defaultCta: "talk-to-skolar",
    linkKeywords: [...COMMON_LINKS],
  },
  practical: {
    key: "practical",
    label: "Practical guide",
    short: "Practical",
    description: "How-to guides for international students.",
    audience: "International students in Italy",
    researchQuestions: ["Official procedure steps", "Documents needed", "Where to do it"],
    skeleton: ["Introduction", "Before you start", "Step-by-step", "Common problems", "Final thoughts"],
    preferredSources: ["government", "official_university", "publication"],
    writerRules: ["Separate official rules from practical advice."],
    timeSensitive: false,
    defaultCta: "talk-to-skolar",
    linkKeywords: ["students", "services", "procedure", "documents"],
  },
  other: {
    key: "other",
    label: "Other",
    short: "Other",
    description: "Other educational content.",
    audience: "Students interested in studying abroad",
    researchQuestions: ["Key facts about the topic from official or reputable sources"],
    skeleton: ["Introduction", "Main points", "Final thoughts"],
    preferredSources: ["official_university", "government", "publication"],
    writerRules: [],
    timeSensitive: false,
    defaultCta: "talk-to-skolar",
    linkKeywords: [...COMMON_LINKS],
  },
};

export const CATEGORY_KEYS = Object.keys(STRATEGIES) as CategoryKey[];

export const DEFAULT_CTAS: CtaTemplate[] = [
  {
    key: "explore-options",
    label: "Explore options with SKOLAR",
    text: "Exploring university options in Italy? Speak with SKOLAR about your academic profile and preferences.",
    categories: ["comparison", "university_guide", "programmes", "city_guide"],
  },
  {
    key: "admission-help",
    label: "Talk to SKOLAR",
    text: "Need help understanding the admission process? Connect with SKOLAR to discuss your study-abroad plans.",
    categories: ["admissions", "visa"],
  },
  {
    key: "scholarship-help",
    label: "Plan your application",
    text: "Planning to apply to an Italian university? SKOLAR can help you explore suitable university and course options.",
    categories: ["scholarship"],
  },
  {
    key: "talk-to-skolar",
    label: "Talk to SKOLAR",
    text: "Have questions about studying in Italy? Connect with SKOLAR to discuss your plans.",
    categories: ["student_life", "cost_of_living", "trending", "practical", "other"],
  },
];

export const STATUS_LABEL: Record<string, string> = {
  researching: "Researching",
  draft: "Draft",
  needs_review: "Needs review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  rejected: "Rejected",
  failed: "Failed",
};

export const VERIFICATION_LABEL: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially verified",
  needs_review: "Needs review",
  conflicting: "Conflicting information",
  unverified: "Unverified",
  outdated: "Outdated",
};
