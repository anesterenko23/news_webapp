import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TOPICS } from "./collection-hints.js";
import { REGIONS, SOURCES } from "./source-registry.js";
export const CollectionQuery = z
  .object({
    source: z.string().optional(),
    region: z.enum(REGIONS).optional(),
    topic: z.enum(TOPICS as [string, ...string[]]).optional(),
    status: z
      .enum([
        "collected",
        "exported",
        "analyzed",
        "no_relevant_events",
        "needs_review",
      ])
      .optional(),
    contentStatus: z
      .enum(["full", "excerpt", "metadata_only", "unavailable"])
      .optional(),
    search: z.string().max(300).optional(),
    relevance: z.enum(["international_hint", "unclassified"]).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z
      .enum(["priority", "newest", "oldest", "collected", "source"])
      .default("priority"),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Invalid date range");
export async function listCollected(db: PrismaClient, input: unknown) {
  const q = CollectionQuery.parse(input);
  const where: Prisma.CollectedArticleWhereInput = {
    ...(q.source ? { OR: [{ sourceId: q.source }, { source: q.source }] } : {}),
    ...(q.region
      ? { regionsJson: { contains: JSON.stringify(q.region) } }
      : {}),
    ...(q.topic
      ? { categoriesJson: { contains: JSON.stringify(q.topic) } }
      : {}),
    ...(q.status ? { analysisStatus: q.status } : {}),
    ...(q.contentStatus ? { contentStatus: q.contentStatus } : {}),
    ...(q.relevance ? { relevanceHint: q.relevance } : {}),
    ...(q.search
      ? {
          AND: [
            {
              OR: [
                { title: { contains: q.search } },
                { description: { contains: q.search } },
              ],
            },
          ],
        }
      : {}),
    ...(q.from || q.to
      ? {
          publishedAt: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lt: new Date(Date.parse(q.to) + 86400000) } : {}),
          },
        }
      : {}),
  };
  const orderBy: Prisma.CollectedArticleOrderByWithRelationInput[] =
    q.sort === "priority"
      ? [{ priorityScore: "desc" }, { publishedAt: "desc" }, { id: "asc" }]
      : q.sort === "source"
        ? [{ source: "asc" }, { publishedAt: "desc" }, { id: "asc" }]
        : q.sort === "collected"
          ? [{ collectedAt: "desc" }, { id: "asc" }]
          : [
              {
                publishedAt: {
                  sort: q.sort === "oldest" ? "asc" : "desc",
                  nulls: "last",
                },
              },
              { id: "asc" },
            ];
  const [articles, total] = await Promise.all([
    db.collectedArticle.findMany({
      where,
      orderBy,
      take: 100,
      skip: q.offset,
      select: {
        id: true,
        sourceId: true,
        source: true,
        publisher: true,
        sourceUrl: true,
        title: true,
        url: true,
        canonicalUrl: true,
        description: true,
        publishedAt: true,
        collectedAt: true,
        author: true,
        language: true,
        contentStatus: true,
        analysisStatus: true,
        analysisBatchId: true,
        analysisVersion: true,
        priorityScore: true,
        relevanceHint: true,
        categoriesJson: true,
        regionsJson: true,
        extractionMethod: true,
        extractionStatus: true,
        reservation: true,
        eventSources: {
          where: { event: { archived: false, publicationStatus: "Published" } },
          select: { eventId: true },
        },
      },
    }),
    db.collectedArticle.count({ where }),
  ]);
  return {
    articles: articles.map((a) => ({
      ...a,
      topics: JSON.parse(a.categoriesJson),
      regions: JSON.parse(a.regionsJson),
    })),
    total,
    offset: q.offset,
    limit: 100,
  };
}
export async function collectionStats(db: PrismaClient) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const [
    total,
    todayCount,
    statuses,
    content,
    sources,
    publishers,
    regions,
    topics,
    states,
    missingDate,
    emptyContent,
    events,
  ] = await Promise.all([
    db.collectedArticle.count(),
    db.collectedArticle.count({ where: { collectedAt: { gte: today } } }),
    db.collectedArticle.groupBy({ by: ["analysisStatus"], _count: true }),
    db.collectedArticle.groupBy({ by: ["contentStatus"], _count: true }),
    db.collectedArticle.groupBy({ by: ["sourceId"], _count: true }),
    db.collectedArticle.groupBy({ by: ["publisher"], _count: true }),
    db.collectedArticle.groupBy({ by: ["regionsJson"], _count: true }),
    db.collectedArticle.groupBy({ by: ["categoriesJson"], _count: true }),
    db.newsSourceState.findMany(),
    db.collectedArticle.count({ where: { publishedAt: null } }),
    db.collectedArticle.count({ where: { content: "" } }),
    db.importedEvent.count({
      where: { archived: false, publicationStatus: "Published" },
    }),
  ]);
  const expand = (rows: { _count: number }[], key: string) => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      let values: string[] = [];
      try {
        values = JSON.parse((row as any)[key]);
      } catch {}
      for (const value of values)
        counts[value] = (counts[value] ?? 0) + row._count;
    }
    return counts;
  };
  return {
    totalArticles: total,
    collectedToday: todayCount,
    dayTimezone: "UTC",
    statuses: Object.fromEntries(
      statuses.map((s) => [s.analysisStatus, s._count]),
    ),
    contentStatuses: Object.fromEntries(
      content.map((s) => [s.contentStatus, s._count]),
    ),
    sourcesEnabled: states.filter((s) => s.enabled).length,
    sourcesWithErrors: states.filter((s) => s.lastError).length,
    bySource: sources.map((s) => ({
      sourceId: s.sourceId,
      name: SOURCES.find((x) => x.id === s.sourceId)?.name ?? s.sourceId,
      count: s._count,
    })),
    byPublisher: Object.fromEntries(
      publishers.map((s) => [s.publisher, s._count]),
    ),
    byRegion: expand(regions, "regionsJson"),
    byTopic: expand(topics, "categoriesJson"),
    missingPublicationDate: missingDate,
    emptyContent,
    publishedEvents: events,
    notice:
      "Article counts, not event counts. Region/topic hints use title, description and feed tags only; they are multi-label and may sum above total. Unknown remains explicit. Publisher location is not inferred story geography.",
  };
}
