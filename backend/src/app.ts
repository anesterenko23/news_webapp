import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z, ZodError } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { SOURCES, collect } from "./collector.js";
import {
  createBatch,
  getBatch,
  exportBatch,
  previewImport,
  importBatch,
  PipelineError,
} from "./batches.js";
import { exportJsonSchema, importJsonSchema } from "./batch-contract.js";
import { collectionHtml } from "./collection-ui.js";
import { globeEvents } from "./manual-globe.js";
const local = (v: string) =>
  ["127.0.0.1", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"].includes(v);
export function createApp(
  config: Config,
  db: PrismaClient,
  fetcher: typeof fetch = fetch,
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 10000000,
    requestTimeout: 120000,
    trustProxy: false,
  });
  const localOnly =
    config.NODE_ENV === "development" &&
    local(config.HOST) &&
    !config.ADMIN_API_TOKEN;
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    if (req.url === "/health") return;
    if (
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    ) {
      let allowed = false;
      try {
        const u = new URL(req.headers.origin);
        allowed =
          localOnly &&
          local(u.hostname) &&
          ["3001", "5173", "5174"].includes(u.port);
      } catch {}
      if (!allowed) return reply.code(403).send({ error: "ORIGIN_DENIED" });
    }
    if (localOnly) {
      let host = "";
      try {
        host = new URL("http://" + req.headers.host).hostname;
      } catch {}
      if (!local(req.ip) || !local(host))
        return reply.code(403).send({ error: "LOOPBACK_ONLY" });
    }
    if (req.method === "GET" && req.url === "/collection") return;
    if (!localOnly) {
      const digest = (s: string) => createHash("sha256").update(s).digest();
      if (
        !config.ADMIN_API_TOKEN ||
        !timingSafeEqual(
          digest(req.headers.authorization?.replace(/^Bearer /, "") ?? ""),
          digest(config.ADMIN_API_TOKEN),
        )
      )
        return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-world-lens-client"] !== "collection"
    )
      return reply.code(403).send({ error: "CLIENT_HEADER_REQUIRED" });
  });
  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof ZodError)
      return reply.code(400).send({ error: "INVALID_INPUT", issues: e.issues });
    if (e instanceof PipelineError)
      return reply
        .code(e.statusCode)
        .send({ error: e.code, message: e.message, details: e.details });
    if (
      e instanceof Error &&
      "code" in e &&
      (e.code === "P2002" || e.code === "P2034" || e.code === "P2028")
    )
      return reply
        .code(409)
        .send({
          error: "CONCURRENT_CHANGE",
          message:
            "Another request changed this batch or selection. Refresh and retry.",
        });
    if (
      e instanceof Error &&
      "statusCode" in e &&
      typeof e.statusCode === "number" &&
      e.statusCode < 500
    )
      return reply.code(e.statusCode).send({ error: "INVALID_REQUEST" });
    return reply
      .code(500)
      .send({
        error: "REQUEST_FAILED",
        message:
          "No changes were saved. Check source availability or server logs.",
      });
  });
  app.get("/health", async () => ({
    status: "ok",
    service: "world-lens-manual-news",
  }));
  app.get("/collection", async (_req, reply) =>
    reply
      .header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      )
      .type("text/html; charset=utf-8")
      .send(collectionHtml(!localOnly)),
  );
  app.get("/api/sources", async () => SOURCES);
  let fetching = false;
  app.post("/api/collection/fetch", async (req) => {
    const { sourceId } = z
      .strictObject({ sourceId: z.enum(["govuk"]) })
      .parse(req.body);
    if (fetching)
      throw new PipelineError(
        "FETCH_RUNNING",
        "Collection is already running",
        409,
      );
    fetching = true;
    try {
      return await collect(db, sourceId, fetcher);
    } finally {
      fetching = false;
    }
  });
  app.get("/api/collection", async (req) => {
    const q = z
      .object({
        source: z.string().optional(),
        status: z.string().optional(),
        contentStatus: z.string().optional(),
        search: z.string().max(300).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const where = {
      ...(q.source ? { source: q.source } : {}),
      ...(q.status ? { analysisStatus: q.status } : {}),
      ...(q.contentStatus ? { contentStatus: q.contentStatus } : {}),
      ...(q.search ? { title: { contains: q.search } } : {}),
      ...(q.from || q.to
        ? {
            publishedAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(Date.parse(q.to) + 86400000) } : {}),
            },
          }
        : {}),
    };
    const [articles, total] = await Promise.all([
      db.collectedArticle.findMany({
        where,
        orderBy: { collectedAt: "desc" },
        take: 100,
        skip: q.offset,
        select: {
          id: true,
          source: true,
          sourceUrl: true,
          title: true,
          url: true,
          publishedAt: true,
          collectedAt: true,
          author: true,
          language: true,
          contentStatus: true,
          analysisStatus: true,
          analysisBatchId: true,
          analysisVersion: true,
          reservation: true,
          eventSources: {
            where: {
              event: { archived: false, publicationStatus: "Published" },
            },
            select: { eventId: true },
          },
        },
      }),
      db.collectedArticle.count({ where }),
    ]);
    return { articles, total, offset: q.offset, limit: 100 };
  });
  app.get<{ Params: { id: string } }>("/api/collection/:id", async (req) => {
    const a = await db.collectedArticle.findUnique({
      where: { id: req.params.id },
    });
    if (!a) throw new PipelineError("NOT_FOUND", "Article not found", 404);
    return a;
  });
  app.post("/api/batches", async (req) => {
    const { articleIds } = z
      .strictObject({
        articleIds: z.array(z.string()).min(1).max(20).optional(),
      })
      .parse(req.body);
    return createBatch(db, articleIds);
  });
  app.get("/api/batches", async () => {
    const batches = await db.newsBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { articles: true } },
        events: {
          where: { archived: false },
          select: { id: true, _count: { select: { relationships: true } } },
        },
      },
    });
    return batches.map((b) => ({
      ...b,
      exportJson: undefined,
      events: undefined,
      articleCount: b._count.articles,
      eventsCount: b.events.length,
      relationshipsCount: b.events.reduce(
        (n, e) => n + e._count.relationships,
        0,
      ),
    }));
  });
  app.get<{ Params: { id: string } }>("/api/batches/:id", (req) =>
    getBatch(db, req.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/batches/:id/export",
    async (req, reply) =>
      reply
        .header(
          "Content-Disposition",
          `attachment; filename="${req.params.id.replace(/[^a-zA-Z0-9_-]/g, "")}.json"`,
        )
        .type("application/json; charset=utf-8")
        .send(await exportBatch(db, req.params.id)),
  );
  const input = z.strictObject({
    rawJson: z.string().min(1).max(8000000),
    mode: z.enum(["import", "replace"]).default("import"),
  });
  app.post("/api/import/preview", (req) => {
    const p = input.parse(req.body);
    return previewImport(db, p.rawJson, p.mode);
  });
  app.post("/api/import/confirm", (req) => {
    const p = input
      .extend({
        confirm: z.literal(true),
        baseVersion: z.number().int().min(0),
        checksum: z.string().length(64),
      })
      .parse(req.body);
    return importBatch(db, p.rawJson, p);
  });
  app.get<{ Params: { id: string } }>(
    "/api/analyses/:id/raw",
    async (req, reply) => {
      const a = await db.analysisImport.findUnique({
        where: { id: req.params.id },
      });
      if (!a) throw new PipelineError("NOT_FOUND", "Analysis not found", 404);
      return reply.type("application/json; charset=utf-8").send(a.rawJson);
    },
  );
  app.get("/api/schemas/export", async () => exportJsonSchema);
  app.get("/api/schemas/import", async () => importJsonSchema);
  app.get("/api/analysis-prompt", async (_req, reply) =>
    reply
      .type("text/plain; charset=utf-8")
      .send(
        await readFile(
          new URL("../../docs/chatgpt-analysis-prompt.txt", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/api/globe/events", async () => ({ events: await globeEvents(db) }));
  app.get("/api/events", async () => ({ events: await globeEvents(db) }));
  app.get<{ Params: { code: string } }>(
    "/api/countries/:code/events",
    async (req) => ({
      events: (await globeEvents(db)).filter(
        (e) =>
          e.countries.includes(req.params.code.toUpperCase()) ||
          e.participants.some(
            (p) => p.countryCode === req.params.code.toUpperCase(),
          ),
      ),
    }),
  );
  return app;
}
