import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { webUrl } from "./batch-contract.js";
export const SOURCES = [
  {
    id: "govuk",
    name: "GOV.UK",
    url: "https://www.gov.uk",
    feed: "https://www.gov.uk/search/news-and-communications.atom",
    terms: "https://www.gov.uk/help/reuse-govuk-content",
    licence: "Open Government Licence v3.0, except third-party material",
    content: "Atom excerpt; full text via official Content API when available",
  },
];
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonicalUrl(value: string) {
  const u = new URL(webUrl.parse(value));
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  processEntities: true,
  isArray: (name) => ["entry", "item", "link"].includes(name),
});
const list = (value: any): any[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: any): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : (value?.["#text"] ?? "");
export function plain(html: string) {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
  return String(
    parser.parse(
      "<root>" +
        stripped.replace(
          /&(?!#\d+;|#x[0-9a-f]+;|amp;|lt;|gt;|quot;|apos;)/gi,
          "&amp;",
        ) +
        "</root>",
    ).root ?? "",
  )
    .replace(/\s+/g, " ")
    .trim();
}
export function parseFeed(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DTD/entities are not accepted");
  if (XMLValidator.validate(xml) !== true)
    throw new Error("Malformed XML feed");
  const doc = parser.parse(xml),
    entries = list(doc.feed?.entry ?? doc.rss?.channel?.item);
  return entries.map((e) => ({
    id: text(e.id ?? e.guid) || null,
    title: text(e.title),
    url:
      typeof e.link === "string"
        ? e.link
        : text(
            list(e.link).find((l) => !l["@rel"] || l["@rel"] === "alternate")?.[
              "@href"
            ] ?? list(e.link)[0],
          ),
    published: text(e.published ?? e.pubDate ?? e.updated),
    author: text(e.author?.name ?? e.author) || null,
    excerpt: plain(text(e.summary ?? e.description)),
    language:
      text(doc.feed?.["@xml:lang"] ?? doc.rss?.channel?.language) || "en",
  }));
}
async function get(url: string, fetcher: typeof fetch) {
  const res = await fetcher(url, {
    headers: {
      "User-Agent": "WorldLens/0.5 (manual news collection)",
      Accept: "application/atom+xml, application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty source response");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4000000) {
      await reader.cancel();
      throw new Error("Source response exceeds 4 MB");
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}
export async function collect(
  db: PrismaClient,
  sourceId: string,
  fetcher: typeof fetch = fetch,
) {
  const source = SOURCES.find((s) => s.id === sourceId);
  if (!source) throw new Error("Unknown source");
  const entries = parseFeed(await get(source.feed, fetcher)).slice(0, 20);
  let added = 0,
    duplicates = 0;
  const errors: string[] = [];
  for (const entry of entries) {
    try {
      const url = canonicalUrl(entry.url);
      if (new URL(url).origin !== source.url)
        throw new Error("Feed article host is not allowed");
      if (!entry.title) throw new Error("Missing title");
      const same = await db.collectedArticle.findFirst({
        where: {
          OR: [
            { url },
            ...(entry.id
              ? [{ source: source.name, sourceArticleId: entry.id }]
              : []),
          ],
        },
      });
      if (same) {
        duplicates++;
        continue;
      }
      let content = entry.excerpt,
        status = content ? "excerpt" : "metadata_only",
        original: any = { feedEntry: entry },
        warning: string | null = null;
      try {
        const page = JSON.parse(
          await get(
            source.url + "/api/content" + new URL(url).pathname,
            fetcher,
          ),
        );
        original.contentApi = page;
        const body =
          typeof page.details?.body === "string"
            ? plain(page.details.body)
            : "";
        if (body) {
          content = body;
          status = "full";
        }
      } catch (e) {
        warning = String(e);
      }
      const contentHash = hash(content);
      if (
        content &&
        (await db.collectedArticle.findFirst({
          where: { source: source.name, contentHash },
        }))
      ) {
        duplicates++;
        continue;
      }
      const published = Date.parse(entry.published);
      await db.collectedArticle.create({
        data: {
          source: source.name,
          sourceUrl: source.url,
          sourceArticleId: entry.id,
          url,
          title: entry.title,
          publishedAt: Number.isFinite(published) ? new Date(published) : null,
          author: entry.author,
          language: entry.language,
          content,
          contentStatus: status,
          contentHash,
          originalJson: JSON.stringify({ ...original, warning }),
        },
      });
      added++;
    } catch (e) {
      errors.push(`${entry.url}: ${String(e)}`);
    }
  }
  return {
    source: source.name,
    received: entries.length,
    added,
    duplicates,
    errors,
  };
}
