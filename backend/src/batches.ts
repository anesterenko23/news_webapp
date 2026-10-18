import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ExportBatch,
  ImportBatch,
  eventIssues,
  VERSION,
  type ImportData,
} from "./batch-contract.js";
import { hash } from "./collector.js";
export class PipelineError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
const batchInclude = {
  articles: {
    include: { article: true },
    orderBy: { ordinal: "asc" as const },
  },
  analyses: {
    select: { id: true, version: true, checksum: true, createdAt: true },
    orderBy: { version: "desc" as const },
  },
};
type Tx = Prisma.TransactionClient;
export async function createBatch(db: PrismaClient, ids?: string[]) {
  return db.$transaction(async (tx) => {
    if (
      ids &&
      (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length)
    )
      throw new PipelineError(
        "INVALID_SELECTION",
        "Select 1–20 different articles",
      );
    const articles = await tx.collectedArticle.findMany({
      where: ids
        ? { id: { in: ids } }
        : { analysisStatus: "collected", reservation: null },
      orderBy: { collectedAt: "asc" },
      take: 20,
      include: { reservation: true },
    });
    if (!articles.length)
      throw new PipelineError(
        "NO_ARTICLES",
        "No unprocessed articles available",
      );
    if (ids && articles.length !== ids.length)
      throw new PipelineError(
        "UNKNOWN_ARTICLE",
        "Some selected articles do not exist",
      );
    if (
      articles.some(
        (a) =>
          a.reservation ||
          a.analysisResultId ||
          a.analysisStatus !== "collected",
      )
    )
      throw new PipelineError(
        "ARTICLE_UNAVAILABLE",
        "An article is reserved or already analyzed. Use its existing batch and Replace Analysis.",
        409,
      );
    const batchId = "batch_" + randomUUID(),
      now = new Date();
    const payload = ExportBatch.parse({
      schemaVersion: VERSION,
      batchId,
      exportedAt: now.toISOString(),
      articles: articles.map((a) => ({
        articleId: a.id,
        source: { name: a.source, url: a.sourceUrl },
        title: a.title,
        originalUrl: a.url,
        publishedAt: a.publishedAt?.toISOString() ?? null,
        language: a.language,
        contentStatus: a.contentStatus,
        content: a.content,
      })),
    });
    const batch = await tx.newsBatch.create({
      data: {
        id: batchId,
        exportJson: JSON.stringify(payload, null, 2),
        articles: {
          create: articles.map((a, ordinal) => ({ articleId: a.id, ordinal })),
        },
        reservations: { create: articles.map((a) => ({ articleId: a.id })) },
      },
    });
    await tx.collectedArticle.updateMany({
      where: { id: { in: articles.map((a) => a.id) } },
      data: { analysisStatus: "exported", analysisBatchId: batchId },
    });
    return batch;
  });
}
export async function getBatch(db: PrismaClient, id: string) {
  const b = await db.newsBatch.findUnique({
    where: { id },
    include: batchInclude,
  });
  if (!b)
    throw new PipelineError("BATCH_NOT_FOUND", "Batch does not exist", 404);
  return b;
}
export async function exportBatch(db: PrismaClient, id: string) {
  const b = await getBatch(db, id);
  ExportBatch.parse(JSON.parse(b.exportJson));
  await db.newsBatch.update({
    where: { id },
    data: { exportedAt: b.exportedAt ?? new Date() },
  });
  return b.exportJson;
}
const canonical = (value: any): string =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}"
      : JSON.stringify(value);
export async function previewImport(
  db: PrismaClient,
  rawJson: string,
  mode: "import" | "replace" = "import",
) {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson.replace(/^\uFEFF/, ""));
  } catch {
    throw new PipelineError(
      "INVALID_JSON",
      "Invalid JSON; upload a JSON object without Markdown fences",
    );
  }
  const parsed = ImportBatch.safeParse(raw);
  if (!parsed.success)
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
      missingArticles: [],
    };
  const data = parsed.data,
    batch = await getBatch(db, data.batchId),
    expected = new Set(batch.articles.map((a) => a.articleId)),
    received = new Set<string>(),
    errors: { path: string; message: string }[] = [];
  const fail = (path: string, message: string) =>
    errors.push({ path, message });
  let events = 0,
    relationships = 0;
  const countries = new Set<string>();
  data.results.forEach((result, i) => {
    const prefix = `results.${i}`;
    if (received.has(result.articleId))
      fail(prefix + ".articleId", "Duplicate articleId");
    received.add(result.articleId);
    if (!expected.has(result.articleId))
      fail(prefix + ".articleId", "Article is not in this batch");
    if (result.outcome === "no_relevant_events" && result.events.length)
      fail(prefix + ".events", "No relevant events requires an empty array");
    if (result.outcome === "analyzed" && !result.events.length)
      fail(prefix + ".events", "Analyzed requires at least one event");
    if (result.outcome === "needs_review" && !result.reviewReason)
      fail(prefix + ".reviewReason", "Explain the uncertainty");
    const keys = new Set<string>();
    result.events.forEach((event, j) => {
      events++;
      relationships += event.relationships.length;
      const p = prefix + `.events.${j}`;
      if (keys.has(event.eventKey))
        fail(p + ".eventKey", "Duplicate local eventKey");
      keys.add(event.eventKey);
      for (const issue of eventIssues(event))
        fail(p + "." + issue.path, issue.message);
      event.participants.forEach((p) => {
        if (p.type === "country" && p.countryCode) countries.add(p.countryCode);
      });
      const sourceIds = event.sourceArticleIds ?? [result.articleId];
      if (!sourceIds.includes(result.articleId))
        fail(p + ".sourceArticleIds", "Must include the owning article");
      if (new Set(sourceIds).size !== sourceIds.length)
        fail(p + ".sourceArticleIds", "Duplicate source article");
      for (const id of sourceIds)
        if (!expected.has(id))
          fail(p + ".sourceArticleIds", "Sources must exist in this batch");
    });
  });
  const missingArticles = batch.articles
    .filter((a) => !received.has(a.articleId))
    .map((a) => ({ articleId: a.articleId, title: a.article.title }));
  if (missingArticles.length)
    fail("results", "Missing " + missingArticles.length + " article results");
  const checksum = hash(canonical(data)),
    duplicate = batch.importChecksum === checksum;
  if (batch.importVersion > 0 && !duplicate && mode !== "replace")
    fail(
      "batchId",
      "This batch already has analysis. Use Replace Analysis with preview and confirmation.",
    );
  if (mode === "replace" && batch.importVersion === 0)
    fail("batchId", "There is no analysis to replace");
  const previous = await db.importedEvent.findMany({
      where: { batchId: batch.id, archived: false },
    }),
    incoming = new Map(
      data.results.flatMap((r) =>
        r.events.map(
          (e) =>
            [
              r.articleId + ":" + e.eventKey,
              { event: e, outcome: r.outcome },
            ] as const,
        ),
      ),
    );
  const old = new Map(previous.map((e) => [e.articleId + ":" + e.eventKey, e]));
  const changes = {
    added: [...incoming.keys()].filter((k) => !old.has(k)),
    updated: [...incoming.keys()].filter(
      (k) =>
        old.has(k) &&
        canonical(JSON.parse(old.get(k)!.rawJson)) !==
          canonical(incoming.get(k)!.event),
    ),
    removed: [...old.keys()].filter((k) => !incoming.has(k)),
    publicationChanged: [...incoming.keys()].filter(
      (k) =>
        old.has(k) &&
        old.get(k)!.publicationStatus !==
          (incoming.get(k)!.outcome === "needs_review"
            ? "NeedsReview"
            : "Published"),
    ),
  };
  return {
    valid: !errors.length,
    errors,
    missingArticles,
    batchId: batch.id,
    baseVersion: batch.importVersion,
    checksum,
    duplicate,
    counts: {
      articlesInBatch: expected.size,
      resultsReceived: data.results.length,
      analyzed: data.results.filter((r) => r.outcome === "analyzed").length,
      noRelevantEvents: data.results.filter(
        (r) => r.outcome === "no_relevant_events",
      ).length,
      needsReview: data.results.filter((r) => r.outcome === "needs_review")
        .length,
      events,
      relationships,
      countries: countries.size,
    },
    sources: batch.articles.map((a) => ({
      articleId: a.articleId,
      title: a.article.title,
      url: a.article.url,
      contentStatus: a.article.contentStatus,
    })),
    changes,
    warnings: [
      "Import confirms human acceptance, not independent verification. needs_review results remain off the globe.",
      "Non-country endpoints and unknown directions are preserved but do not create globe arcs.",
    ],
    data,
  };
}
export async function importBatch(
  db: PrismaClient,
  rawJson: string,
  options: {
    mode: "import" | "replace";
    confirm: boolean;
    baseVersion: number;
    checksum: string;
  },
) {
  const preview = await previewImport(db, rawJson, options.mode);
  if (!preview.valid || !preview.data)
    throw new PipelineError(
      "VALIDATION_FAILED",
      "Correct the import before saving",
      400,
      preview,
    );
  if (!options.confirm)
    throw new PipelineError(
      "CONFIRM_REQUIRED",
      "Review the preview and confirm",
    );
  if (preview.checksum !== options.checksum)
    throw new PipelineError(
      "PREVIEW_CHANGED",
      "JSON changed since preview",
      409,
    );
  return db.$transaction(
    async (tx) => {
      const batch = await tx.newsBatch.findUniqueOrThrow({
        where: { id: preview.data!.batchId },
      });
      if (batch.importChecksum === preview.checksum)
        return {
          duplicate: true,
          message:
            "This batch has already been imported. No duplicate records were created.",
          version: batch.importVersion,
        };
      if (batch.importVersion !== options.baseVersion)
        throw new PipelineError(
          "STALE_PREVIEW",
          "Analysis changed since preview. Preview again.",
          409,
        );
      if (batch.importVersion > 0 && options.mode !== "replace")
        throw new PipelineError(
          "REPLACE_REQUIRED",
          "Use Replace Analysis",
          409,
        );
      const version = batch.importVersion + 1;
      const analysis = await tx.analysisImport.create({
        data: {
          batchId: batch.id,
          version,
          checksum: preview.checksum!,
          rawJson,
        },
      });
      await tx.importedEvent.updateMany({
        where: { batchId: batch.id },
        data: { archived: true, publicationStatus: "Archived" },
      });
      await saveEvents(tx, preview.data!, analysis.id);
      for (const result of preview.data!.results)
        await tx.collectedArticle.update({
          where: { id: result.articleId },
          data: {
            analysisStatus: result.outcome,
            analyzedAt: new Date(),
            analysisBatchId: batch.id,
            analysisVersion: version,
            analysisResultId: analysis.id,
          },
        });
      await tx.newsBatch.update({
        where: { id: batch.id },
        data: {
          status: "imported",
          importedAt: new Date(),
          importChecksum: preview.checksum,
          importVersion: version,
        },
      });
      await tx.batchReservation.deleteMany({ where: { batchId: batch.id } });
      return {
        duplicate: false,
        version,
        analysisId: analysis.id,
        counts: preview.counts,
      };
    },
    { timeout: 20000 },
  );
}
async function saveEvents(tx: Tx, data: ImportData, analysisId: string) {
  for (const result of data.results)
    for (const event of result.events) {
      const article = await tx.collectedArticle.findUniqueOrThrow({
        where: { id: result.articleId },
      });
      const values = {
        analysisId,
        title: event.title,
        summary: event.summary,
        eventType: event.eventType,
        eventStatus: event.status,
        reason: event.reason,
        publishedAt: article.publishedAt,
        verificationStatus: "Unverified",
        publicationStatus:
          result.outcome === "needs_review" ? "NeedsReview" : "Published",
        archived: false,
        participantsJson: JSON.stringify(event.participants),
        rawJson: JSON.stringify(event),
      };
      const record = await tx.importedEvent.upsert({
        where: {
          batchId_articleId_eventKey: {
            batchId: data.batchId,
            articleId: result.articleId,
            eventKey: event.eventKey,
          },
        },
        create: {
          batchId: data.batchId,
          articleId: result.articleId,
          eventKey: event.eventKey,
          ...values,
        },
        update: values,
      });
      await tx.importedRelationship.deleteMany({
        where: { eventId: record.id },
      });
      await tx.importedEventSource.deleteMany({
        where: { eventId: record.id },
      });
      for (const link of event.relationships)
        await tx.importedRelationship.create({
          data: { eventId: record.id, ...link },
        });
      for (const articleId of event.sourceArticleIds ?? [result.articleId])
        await tx.importedEventSource.create({
          data: { eventId: record.id, articleId },
        });
    }
}
