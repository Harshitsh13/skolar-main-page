/** A connected SKOLAR country/destination platform (Firestore: `siteDestinations`). */
export interface Destination {
  id: string;
  title: string;
  description: string;
  /** Optional education focus, e.g. "Medicine" or "Undergraduate & Postgraduate". */
  category?: string;
  /** Destination name shown in the card lockup, e.g. "Italy". */
  countryName?: string;
  /** ISO 3166-1 alpha-2, links the card to the Control Center `countries` record. */
  countryCode?: string;
  imageUrl: string;
  imageAlt?: string;
  /** External country-specific website. */
  url: string;
  ctaLabel?: string;
  order: number;
  /**
   * Institutions SKOLAR has verified for this platform. Not displayed on the
   * card; given to the AI finder as its only "verified" university list.
   */
  institutions?: string[];
  isSample?: boolean;
}

/** A published SKOLAR Insights article (Firestore: `siteArticles`). */
export interface Article {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  coverImageUrl: string;
  coverImageAlt?: string;
  /** ISO date string. */
  publishedAt: string;
  readingMinutes?: number;
  /** Where the article is read (absolute URL or site path). */
  url: string;
  featured?: boolean;
  isSample?: boolean;
}

export type ContentSource = "firestore" | "default" | "sample" | "empty";

export interface ContentResult<T> {
  items: T[];
  source: ContentSource;
}
