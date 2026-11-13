import { Marked, type Tokens } from "marked";

/**
 * Article Markdown → safe HTML. Client- and server-safe (used by the public
 * article page and the Studio editor preview), so both render identically.
 *
 * - Raw HTML in Markdown is escaped (AI or pasted content cannot inject markup)
 * - Citations: "[[3]]" → superscript link to source #3
 * - Headings get stable ids for the table of contents
 * - Tables are wrapped in a horizontally scrollable container (mobile)
 * - Only http(s), relative and #anchor links are allowed
 */

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function headingId(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\[\[\d+]]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h) || h.startsWith("/") || h.startsWith("#")) return h;
  return null;
}

function makeMarked(ids: Map<string, number>, toc: TocItem[]) {
  const m = new Marked({ gfm: true, breaks: false, async: false });
  m.use({
    extensions: [
      {
        name: "citation",
        level: "inline",
        start(src: string) {
          return src.indexOf("[[");
        },
        tokenizer(src: string) {
          const match = /^\[\[(\d{1,3})]]/.exec(src);
          if (match) return { type: "citation", raw: match[0], n: Number(match[1]) };
          return undefined;
        },
        renderer(token) {
          const n = (token as unknown as { n: number }).n;
          return `<sup class="cite"><a href="#source-${n}" aria-label="Source ${n}">${n}</a></sup>`;
        },
      },
    ],
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return esc(token.text);
      },
      heading(token: Tokens.Heading) {
        const text = this.parser.parseInline(token.tokens);
        const plain = token.text.replace(/\[\[\d+]]/g, "").replace(/[*_`]/g, "").trim();
        let id = headingId(plain);
        const count = ids.get(id) ?? 0;
        ids.set(id, count + 1);
        if (count) id = `${id}-${count + 1}`;
        if (token.depth === 2 || token.depth === 3) toc.push({ id, text: plain, level: token.depth });
        const level = Math.min(6, Math.max(2, token.depth)); // h1 is reserved for the article title
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      },
      link(token: Tokens.Link) {
        const href = safeHref(token.href);
        const text = this.parser.parseInline(token.tokens);
        if (!href) return text;
        const external = /^https?:\/\//i.test(href);
        const title = token.title ? ` title="${esc(token.title)}"` : "";
        return external
          ? `<a href="${esc(href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`
          : `<a href="${esc(href)}"${title}>${text}</a>`;
      },
      image(token: Tokens.Image) {
        const href = safeHref(token.href);
        if (!href) return "";
        const caption = token.title ? `<figcaption>${esc(token.title)}</figcaption>` : "";
        return `<figure><img src="${esc(href)}" alt="${esc(token.text)}" loading="lazy" decoding="async" />${caption}</figure>`;
      },
      table(token: Tokens.Table) {
        const head = token.header
          .map((c, i) => `<th scope="col"${align(token.align[i])}>${this.parser.parseInline(c.tokens)}</th>`)
          .join("");
        const rows = token.rows
          .map(
            (r) =>
              `<tr>${r
                .map((c, i) =>
                  i === 0
                    ? `<th scope="row"${align(token.align[i])}>${this.parser.parseInline(c.tokens)}</th>`
                    : `<td${align(token.align[i])}>${this.parser.parseInline(c.tokens)}</td>`,
                )
                .join("")}</tr>`,
          )
          .join("");
        return `<div class="table-scroll" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return m;
}

function align(a: "center" | "left" | "right" | null) {
  return a ? ` style="text-align:${a}"` : "";
}

export function renderArticleMarkdown(md: string): { html: string; toc: TocItem[] } {
  const ids = new Map<string, number>();
  const toc: TocItem[] = [];
  const html = makeMarked(ids, toc).parse(md ?? "") as string;
  return { html, toc };
}

/** Splits an article into H2 sections (for section-level regeneration). */
export function splitSections(md: string): Array<{ heading: string | null; body: string }> {
  const lines = md.split(/\r?\n/);
  const out: Array<{ heading: string | null; body: string }> = [];
  let cur: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      out.push({ heading: cur.heading, body: cur.lines.join("\n").trim() });
      cur = { heading: m[1].trim(), lines: [] };
    } else cur.lines.push(line);
  }
  out.push({ heading: cur.heading, body: cur.lines.join("\n").trim() });
  return out.filter((s) => s.heading !== null || s.body);
}

export function joinSections(sections: Array<{ heading: string | null; body: string }>): string {
  return sections
    .map((s) => (s.heading ? `## ${s.heading}\n\n${s.body}`.trim() : s.body.trim()))
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

/** Citation numbers referenced in markdown. */
export function citedNumbers(md: string): number[] {
  return [...new Set([...md.matchAll(/\[\[(\d{1,3})]]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}
