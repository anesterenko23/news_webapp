import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { webUrl } from "./batch-contract.js";
import { SOURCES, knownSource, type NewsSource } from "./source-registry.js";
import {
  sourceRequest,
  CollectionLimit,
  type HttpBudget,
} from "./source-http.js";
import { collectionHints } from "./collection-hints.js";
export { SOURCES };
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const normalizedContent = (s: string) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim();
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
  isArray: (name) =>
    ["entry", "item", "link", "category", "dc:creator"].includes(name),
});
const list = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string =>
  typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : (v?.["#text"] ?? "");
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
export interface FeedEntry {
  id: string | null;
  title: string;
  url: string;
  published: string;
  author: string | null;
  excerpt: string;
  language: string;
  tags: string[];
  raw: unknown;
}
export function parseFeed(xml: string): FeedEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DTD/entities are not accepted");
  if (XMLValidator.validate(xml) !== true)
    throw new Error("Malformed XML feed");
  const doc = parser.parse(xml);
  if (!doc.feed && !doc.rss?.channel && !doc["rdf:RDF"])
    throw new Error("Response is not an RSS/Atom feed");
  const entries = list(
    doc.feed?.entry ?? doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item,
  );
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
    published: text(e.published ?? e.pubDate ?? e["dc:date"] ?? e.updated),
    author:
      text(e.author?.name ?? e.author ?? list(e["dc:creator"])[0]) || null,
    excerpt: plain(text(e.summary ?? e.description)),
    language:
      text(doc.feed?.["@xml:lang"] ?? doc.rss?.channel?.language) || "en",
    tags: list(e.category)
      .map((c) => text(c["@term"] ?? c))
      .filter(Boolean),
    raw: e,
  }));
}
export function parseGovJson(json: string): {
  entries: FeedEntry[];
  total: number;
  start: number;
} {
  const parsed = z
    .object({
      results: z.array(
        z
          .object({
            title: z.string(),
            link: z.string(),
            description: z.string().optional(),
            public_timestamp: z.string().optional(),
            format: z.string().optional(),
          })
          .passthrough(),
      ),
      total: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
    })
    .parse(JSON.parse(json));
  return {
    total: parsed.total,
    start: parsed.start,
    entries: parsed.results.map((e) => ({
      id: e.link,
      title: e.title,
      url: new URL(e.link, "https://www.gov.uk").href,
      published: e.public_timestamp ?? "",
      author: null,
      excerpt: e.description ?? "",
      language: "en",
      tags: e.format ? [e.format] : [],
      raw: e,
    })),
  };
}
export const CollectOptions = z
  .object({
    sourceId: z.string().optional(),
    sourceIds: z.array(z.string()).max(20).optional(),
    mode: z.enum(["latest", "historical"]).default("latest"),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    maxArticles: z.number().int().min(1).max(2000).default(200),
    maxPages: z.number().int().min(1).max(20).default(5),
    requestBudget: z.number().int().min(1).max(500).default(150),
    resume: z.boolean().default(true),
  })
  .refine(
    (v) => v.mode !== "historical" || (!!v.from && !!v.to),
    "Historical collection requires start and end dates",
  )
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "Start date must precede end date",
  )
  .refine(
    (v) => v.mode !== "latest" || (!v.from && !v.to),
    "Use historical mode for a collection date range",
  );
export type CollectSettings = z.infer<typeof CollectOptions>;
export async function initializeSources(db: PrismaClient) {
  const existing = new Set(
    (await db.newsSourceState.findMany({ select: { id: true } })).map(
      (s) => s.id,
    ),
  );
  for (const s of SOURCES)
    if (!existing.has(s.id))
      await db.newsSourceState.upsert({
        where: { id: s.id },
        create: { id: s.id, enabled: s.enabled },
        update: {},
      });
  const old = await db.collectedArticle.findMany({ where: { sourceId: null } });
  for (const a of old) {
    const hints = collectionHints(a.title, "");
    await db.collectedArticle.update({
      where: { id: a.id },
      data: {
        sourceId: a.source.startsWith("GOV.UK") ? "govuk" : null,
        publisher: a.source.startsWith("GOV.UK") ? "GOV.UK" : a.source,
        canonicalUrl: canonicalUrl(a.url),
        description: "",
        contentHash: hash(normalizedContent(a.content)),
        categoriesJson: JSON.stringify(hints.topics),
        regionsJson: JSON.stringify(hints.regions),
        primaryRegion: hints.regions[0],
        priorityScore: hints.priorityScore,
        relevanceHint: hints.relevanceHint,
        extractionMethod: "legacy-preserved",
        extractionStatus: "legacy-preserved",
      },
    });
  }
}
function govUrl(source: NewsSource, options: CollectSettings, start: number) {
  const u = new URL("https://www.gov.uk/api/search.json");
  u.searchParams.set("count", "50");
  u.searchParams.set("start", String(start));
  u.searchParams.set("order", "-public_timestamp");
  if (source.id === "govuk-fcdo")
    u.searchParams.set(
      "filter_organisations",
      "foreign-commonwealth-development-office",
    );
  for (const format of [
    "news_story",
    "press_release",
    "speech",
    "world_news_story",
    "government_response",
  ])
    u.searchParams.append("filter_format", format);
  u.searchParams.set(
    "filter_public_timestamp",
    `from:${options.from},to:${options.to}`,
  );
  return u.href;
}
export async function sourceStates(db: PrismaClient) {
  await initializeSources(db);
  const states = await db.newsSourceState.findMany(),
    counts = await db.collectedArticle.groupBy({
      by: ["sourceId"],
      _count: true,
    });
  return SOURCES.map((s) => ({
    ...s,
    ...states.find((state) => state.id === s.id),
    articleCount: counts.find((c) => c.sourceId === s.id)?._count ?? 0,
    capabilities: { historical: s.history, fullText: s.fullText, latest: true },
    content: s.fullText
      ? "Official Content API full text, excerpt fallback"
      : "Feed excerpt only",
  }));
}
interface SourceResult {
  sourceId: string;
  source: string;
  status: string;
  received: number;
  added: number;
  duplicates: number;
  errors: string[];
  pages: number;
  coverage: string;
  nextStart?: number;
  extractionFailures: number;
}
async function collectOne(
  db: PrismaClient,
  source: NewsSource,
  options: CollectSettings,
  budget: HttpBudget,
  maxNew: number,
): Promise<SourceResult> {
  const result: SourceResult = {
    sourceId: source.id,
    source: source.name,
    status: "success",
    received: 0,
    added: 0,
    duplicates: 0,
    errors: [],
    pages: 0,
    coverage: options.mode === "latest" ? "latest_window" : "partial",
    extractionFailures: 0,
  };
  if (options.mode === "historical" && !source.history)
    return {
      ...result,
      status: "unsupported",
      coverage: "unavailable",
      errors: ["Historical collection is not supported by this source."],
    };
  await db.newsSourceState.update({
    where: { id: source.id },
    data: { lastAttemptAt: new Date() },
  });
  const state = await db.newsSourceState.findUniqueOrThrow({
      where: { id: source.id },
    }),
    queryKey = hash(JSON.stringify({ from: options.from, to: options.to }));
  let checkpoint: any = {};
  try {
    checkpoint = JSON.parse(state.checkpointJson);
  } catch {}
  let start =
    options.mode === "historical" &&
    options.resume &&
    checkpoint.queryKey === queryKey &&
    !checkpoint.complete
      ? (checkpoint.nextStart ?? 0)
      : 0;
  try {
    for (
      let page = 0;
      page < (options.mode === "historical" ? options.maxPages : 1);
      page++
    ) {
      const response = await sourceRequest(
        options.mode === "historical"
          ? govUrl(source, options, start)
          : source.feed,
        source,
        budget,
        options.mode === "latest"
          ? {
              ...(state.etag ? { "If-None-Match": state.etag } : {}),
              ...(state.lastModified
                ? { "If-Modified-Since": state.lastModified }
                : {}),
            }
          : {},
      );
      if (response.status === 304) {
        result.coverage = "not_modified";
        break;
      }
      const data =
        options.mode === "historical"
          ? parseGovJson(response.text)
          : { entries: parseFeed(response.text), total: 0, start: 0 };
      result.pages++;
      result.received += data.entries.length;
      let completePage = true;
      for (const entry of data.entries) {
        if (result.added >= maxNew) {
          completePage = false;
          break;
        }
        try {
          const canonical = canonicalUrl(entry.url),
            original = new URL(webUrl.parse(entry.url));
          if (
            !source.articleHosts.includes(original.hostname) ||
            (original.protocol !== "https:" && original.protocol !== "http:")
          )
            throw new Error("Article URL is outside publisher hosts");
          if (!entry.title) throw new Error("Article title missing");
          const duplicate = await db.collectedArticle.findFirst({
            where: {
              OR: [
                { url: entry.url },
                { canonicalUrl: canonical },
                ...(entry.id
                  ? [
                      {
                        publisher: source.publisher,
                        sourceArticleId: entry.id,
                      },
                      { source: source.name, sourceArticleId: entry.id },
                    ]
                  : []),
              ],
            },
          });
          if (duplicate) {
            result.duplicates++;
            continue;
          }
          let content = entry.excerpt,
            contentStatus = content ? "excerpt" : "metadata_only",
            extractionMethod = "rss-summary",
            extractionStatus = "excerpt_only",
            originalData: any = { feedEntry: entry.raw },
            warning: string | null = null;
          if (source.fullText) {
            try {
              const body = await sourceRequest(
                source.url + "/api/content" + original.pathname,
                source,
                budget,
              );
              const api = JSON.parse(body.text);
              originalData.contentApi = api;
              const full =
                typeof api.details?.body === "string"
                  ? plain(api.details.body)
                  : "";
              if (full) {
                content = full;
                contentStatus = "full";
                extractionMethod = "govuk-content-api";
                extractionStatus = "success";
              } else {
                extractionStatus = "body_unavailable";
                result.extractionFailures++;
              }
            } catch (e) {
              if (e instanceof CollectionLimit) throw e;
              warning = String(e);
              extractionStatus = "fallback_excerpt";
              result.extractionFailures++;
            }
          }
          const contentHash = hash(normalizedContent(content));
          if (
            content &&
            (await db.collectedArticle.findFirst({
              where: { publisher: source.publisher, contentHash },
            }))
          ) {
            result.duplicates++;
            continue;
          }
          const hints = collectionHints(entry.title, entry.excerpt, entry.tags),
            published = Date.parse(entry.published);
          await db.collectedArticle.create({
            data: {
              sourceId: source.id,
              source: source.name,
              publisher: source.publisher,
              sourceUrl: source.url,
              sourceArticleId: entry.id,
              url: entry.url,
              canonicalUrl: canonical,
              title: entry.title,
              description: entry.excerpt,
              publishedAt: Number.isFinite(published)
                ? new Date(published)
                : null,
              author: entry.author,
              language: entry.language || source.language,
              content,
              contentStatus,
              contentHash,
              originalJson: JSON.stringify({ ...originalData, warning, hints }),
              categoriesJson: JSON.stringify(hints.topics),
              regionsJson: JSON.stringify(hints.regions),
              primaryRegion: hints.regions[0],
              priorityScore:
                hints.priorityScore +
                (contentStatus === "full"
                  ? 8
                  : contentStatus === "excerpt"
                    ? 3
                    : 0),
              relevanceHint: hints.relevanceHint,
              extractionMethod,
              extractionStatus,
            },
          });
          result.added++;
        } catch (e) {
          if (e instanceof CollectionLimit) throw e;
          const message = String(e);
          if (/P2002|Unique constraint/.test(message)) {
            result.duplicates++;
            continue;
          }
          result.errors.push(entry.url + ": " + message.slice(0, 300));
        }
      }
      if (options.mode === "historical") {
        const next = completePage ? start + data.entries.length : start;
        const complete =
          completePage && (data.entries.length === 0 || next >= data.total);
        result.nextStart = next;
        result.coverage = complete ? "complete" : "partial";
        await db.newsSourceState.update({
          where: { id: source.id },
          data: {
            checkpointJson: JSON.stringify({
              queryKey,
              nextStart: next,
              complete,
              from: options.from,
              to: options.to,
            }),
          },
        });
        start = next;
        if (complete || !completePage || result.added >= maxNew) break;
      } else if (!completePage) result.coverage = "partial_latest_window";
      else if (completePage)
        await db.newsSourceState.update({
          where: { id: source.id },
          data: {
            etag: response.headers.get("etag"),
            lastModified: response.headers.get("last-modified"),
          },
        });
    }
    result.status = result.errors.length ? "partial" : "success";
    await db.newsSourceState.update({
      where: { id: source.id },
      data: {
        lastSuccessAt: new Date(),
        lastError: result.errors.length
          ? result.errors.slice(0, 3).join("\n")
          : null,
      },
    });
  } catch (e) {
    result.status = e instanceof CollectionLimit ? "partial" : "failed";
    result.errors.push(String(e).slice(0, 500));
    await db.newsSourceState.update({
      where: { id: source.id },
      data: { lastError: result.errors.at(-1) },
    });
  }
  return result;
}
export async function collectMany(
  db: PrismaClient,
  rawOptions: unknown,
  fetcher: typeof fetch = fetch,
  dependencies: Partial<Pick<HttpBudget, "resolver" | "skipThrottle">> = {},
) {
  const options = CollectOptions.parse(rawOptions);
  await initializeSources(db);
  const requested =
    options.sourceIds ?? (options.sourceId ? [options.sourceId] : null);
  if (requested) for (const id of requested) knownSource(id);
  const enabled = await db.newsSourceState.findMany({
    where: { enabled: true },
  });
  const sources = requested
    ? [...new Set(requested)].map(knownSource)
    : SOURCES.filter((s) => enabled.some((e) => e.id === s.id));
  if (!sources.length) throw new Error("No enabled sources selected");
  const token = randomUUID(),
    now = new Date();
  const lock = await db.$transaction(async (tx) => {
    const lease = await tx.collectorLease.findUnique({
      where: { id: "collection" },
    });
    if (lease && lease.expiresAt > now) return false;
    await tx.collectorLease.upsert({
      where: { id: "collection" },
      create: {
        id: "collection",
        token,
        expiresAt: new Date(Date.now() + 600000),
      },
      update: { token, expiresAt: new Date(Date.now() + 600000) },
    });
    await tx.collectionRun.updateMany({
      where: { status: "running" },
      data: { status: "interrupted", finishedAt: now },
    });
    return true;
  });
  if (!lock) throw new Error("FETCH_RUNNING: collection is already running");
  const run = await db.collectionRun.create({
    data: { status: "running", optionsJson: JSON.stringify(options) },
  });
  const budget: HttpBudget = {
    remaining: options.requestBudget,
    used: 0,
    timeoutMs: 15000,
    retries: 1,
    maxBytes: 4000000,
    fetcher,
    ...dependencies,
    beforeRequest: async () => {
      const lease = await db.collectorLease.updateMany({
        where: { id: "collection", token },
        data: { expiresAt: new Date(Date.now() + 600000) },
      });
      if (lease.count !== 1) throw new CollectionLimit("Collection lease lost");
    },
  };
  const results: SourceResult[] = [];
  let index = 0;
  async function worker() {
    while (index < sources.length) {
      const slot = index++,
        source = sources[slot],
        quota =
          Math.floor(options.maxArticles / sources.length) +
          (slot < options.maxArticles % sources.length ? 1 : 0);
      if (!quota) continue;
      const result = await collectOne(db, source, options, budget, quota);
      results.push(result);
      console.info(
        JSON.stringify({
          service: "news-collector",
          runId: run.id,
          sourceId: source.id,
          status: result.status,
          added: result.added,
          duplicates: result.duplicates,
        }),
      );
      await db.collectionRun.update({
        where: { id: run.id },
        data: {
          resultJson: JSON.stringify({
            sources: results,
            requestsUsed: budget.used,
          }),
        },
      });
    }
  }
  try {
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(3, sources.length) }, worker),
    );
    if (workers.some((r) => r.status === "rejected")) {
      await db.collectionRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date() },
      });
      throw new Error(
        "Collection storage error; completed source results were retained.",
      );
    }
    const result = {
      runId: run.id,
      status: results.every((r) => r.status === "success")
        ? "success"
        : "partial",
      added: results.reduce((n, r) => n + r.added, 0),
      duplicates: results.reduce((n, r) => n + r.duplicates, 0),
      requestsUsed: budget.used,
      sources: results,
    };
    await db.collectionRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        finishedAt: new Date(),
        resultJson: JSON.stringify(result),
      },
    });
    return result;
  } finally {
    await db.collectorLease.deleteMany({ where: { id: "collection", token } });
  }
}
// Compatibility wrapper for Phase 5 callers and regression fixtures.
export async function collect(
  db: PrismaClient,
  sourceId: string,
  fetcher: typeof fetch = fetch,
  dependencies: Partial<Pick<HttpBudget, "resolver" | "skipThrottle">> = {},
) {
  const result = await collectMany(
    db,
    { sourceId, maxArticles: 200 },
    fetcher,
    dependencies,
  );
  return result.sources[0];
}
