import type { Article, Destination } from "@/lib/types";

/**
 * Default destination platforms (Italy & Mongolia). Shown whenever Firestore
 * has no published `siteDestinations` yet, so the country platforms remain
 * reachable in both development and production.
 */
export const defaultDestinations: Destination[] = [
  {
    id: "italy",
    title: "Explore Higher Education in Italy",
    description:
      "Degree programmes taught in English at public and private Italian universities, with guidance on pre-enrolment and document preparation.",
    category: "Undergraduate · Postgraduate · Medicine",
    countryName: "Italy",
    countryCode: "IT",
    imageUrl: "/images/campus-courtyard.webp",
    imageAlt: "Arcaded courtyard of a historic Italian university",
    url: "https://italy.skolar.it/",
    order: 1,
  },
  {
    id: "mongolia",
    title: "Study Medicine in Mongolia",
    description:
      "A dedicated platform for students exploring English-medium medical programmes in Mongolia, from eligibility questions to arrival.",
    category: "Medicine",
    countryName: "Mongolia",
    countryCode: "MN",
    imageUrl: "/images/sample-campus-mongolia.webp",
    imageAlt: "University campus building in Ulaanbaatar",
    url: "https://mangolia.skolar.it/",
    order: 2,
  },
];

/**
 * SAMPLE CONTENT: development and preview only.
 * Rendered with a visible "Sample" label, and only when Firestore has no
 * published items AND sample content is enabled (see siteConfig).
 * Production with no published content shows an empty state instead.
 */
export const sampleDestinations: Destination[] = defaultDestinations;

export const sampleArticles: Article[] = [
  {
    id: "sample-1",
    title: "How to read a university's entry requirements, line by line",
    excerpt:
      "Minimum grades, prerequisite subjects, language certificates and recognition of your qualification: what each part means and what to ask before you apply.",
    category: "Admissions",
    coverImageUrl: "/images/library-stacks.webp",
    coverImageAlt: "Rows of suspended bookshelves in a modern library",
    publishedAt: "2026-11-03",
    readingMinutes: 8,
    url: "#",
    featured: true,
    isSample: true,
  },
  {
    id: "sample-2",
    title: "Percentage, CGPA or GPA? Presenting your grades to a foreign university",
    excerpt: "Why conversions vary between institutions, and why you should keep your original transcript in front of you.",
    category: "Guides",
    coverImageUrl: "/images/study-overhead.webp",
    coverImageAlt: "Overhead view of students at study tables",
    publishedAt: "2026-10-27",
    readingMinutes: 5,
    url: "#",
    isSample: true,
  },
  {
    id: "sample-3",
    title: "Building a shortlist you can actually apply to",
    excerpt: "A practical method for narrowing twenty options to five, using deadlines, documents and budget.",
    category: "Planning",
    coverImageUrl: "/images/students-studying.webp",
    coverImageAlt: "Students studying together in a library",
    publishedAt: "2026-10-19",
    readingMinutes: 6,
    url: "#",
    isSample: true,
  },
  {
    id: "sample-4",
    title: "The document checklist most applicants start too late",
    excerpt: "Passports, translations and legalisation take time to arrange.",
    category: "Documents",
    coverImageUrl: "/images/library-dome.webp",
    publishedAt: "2026-10-08",
    readingMinutes: 4,
    url: "#",
    isSample: true,
  },
];
