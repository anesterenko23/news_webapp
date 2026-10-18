import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "./database.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  createBatch,
  exportBatch,
  previewImport,
  importBatch,
} from "../src/batches.js";
import { collect, hash, parseFeed } from "../src/collector.js";
import { ExportBatch, eventIssues } from "../src/batch-contract.js";
import { globeEvents } from "../src/manual-globe.js";
import type { ImportEventData } from "../src/batch-contract.js";
const transport = {
  resolver: (async () => [{ address: "93.184.216.34", family: 4 }]) as any,
  skipThrottle: true,
};
const fixture = await testDatabase(),
  db = fixture.db;
beforeEach(async () => {
  for (const name of [
    "importedEventSource",
    "importedRelationship",
    "importedEvent",
    "analysisImport",
    "batchReservation",
    "batchArticle",
    "newsBatch",
    "collectedArticle",
  ] as const)
    await db[name].deleteMany();
});
afterAll(() => fixture.close());
async function seed(count = 1) {
  const rows = [];
  for (let i = 0; i < count; i++)
    rows.push(
      await db.collectedArticle.create({
        data: {
          source: "GOV.UK",
          sourceUrl: "https://www.gov.uk",
          sourceArticleId: "id" + i,
          url: "https://www.gov.uk/news/" + i,
          title: "Original article " + i,
          publishedAt: new Date("2026-10-18T12:00:00Z"),
          language: "en",
          content:
            "France and Germany signed an energy cooperation agreement. " + i,
          contentStatus: "full",
          contentHash: hash("content" + i),
          originalJson: "{}",
        },
      }),
    );
  return rows;
}
function event(): ImportEventData {
  return {
    eventKey: "event_1",
    title: "France and Germany sign agreement",
    summary: "France and Germany signed an energy cooperation agreement.",
    eventType: "international_agreement",
    status: "completed",
    reason: null,
    participants: [
      { name: "France", type: "country", role: "partner", countryCode: "FR" },
      { name: "Germany", type: "country", role: "partner", countryCode: "DE" },
    ],
    relationships: [
      { from: "FR", to: "DE", type: "energy", direction: "bidirectional" },
    ],
  };
}
async function input(count = 1) {
  await seed(count);
  const b = await createBatch(db);
  const exported = JSON.parse(await exportBatch(db, b.id));
  return {
    schemaVersion: "1.0",
    batchId: b.id,
    results: exported.articles.map((a: any) => ({
      articleId: a.articleId,
      outcome: "analyzed",
      events: [event()],
    })),
  };
}
async function commit(value: any, mode: "import" | "replace" = "import") {
  const raw = typeof value === "string" ? value : JSON.stringify(value),
    p = await previewImport(db, raw, mode);
  if (!p.valid) throw new Error(JSON.stringify(p));
  return importBatch(db, raw, {
    mode,
    confirm: true,
    baseVersion: p.baseVersion!,
    checksum: p.checksum!,
  });
}
describe("manual collection and batch pipeline", () => {
  it("collects Atom and full Content API text; repeat collection is idempotent", async () => {
    const fake = (async (url: any) =>
      String(url).endsWith(".atom")
        ? new Response(
            '<feed xml:lang="en"><entry><id>story1</id><title>France and Germany</title><link href="https://www.gov.uk/news/1"/><published>2026-10-18T12:00:00Z</published><summary>Excerpt only</summary></entry></feed>',
          )
        : new Response(
            JSON.stringify({
              details: {
                body: "<p>France and Germany signed an energy agreement.</p>",
              },
            }),
          )) as typeof fetch;
    expect((await collect(db, "govuk", fake, transport)).added).toBe(1);
    expect((await collect(db, "govuk", fake, transport)).duplicates).toBe(1);
    const a = await db.collectedArticle.findFirstOrThrow();
    expect(a.contentStatus).toBe("full");
    expect(a.content).toBe("France and Germany signed an energy agreement.");
  });
  it("preserves excerpt and unknown publication date when full text fails", async () => {
    const fake = (async (url: any) =>
      String(url).endsWith(".atom")
        ? new Response(
            '<feed><entry><title>Story</title><link href="https://www.gov.uk/news/x"/><summary>Only this excerpt</summary></entry></feed>',
          )
        : new Response("", { status: 404 })) as typeof fetch;
    await collect(db, "govuk", fake, transport);
    const a = await db.collectedArticle.findFirstOrThrow();
    expect(a.contentStatus).toBe("excerpt");
    expect(a.publishedAt).toBeNull();
  });
  it("accepts RSS and rejects dangerous entity documents", () => {
    expect(() => parseFeed('<!DOCTYPE x [<!ENTITY a "x">]><feed/>')).toThrow();
    const entry = parseFeed(
      "<rss><channel><item><title>Story</title><link>https://www.gov.uk/news/1</link><description>Excerpt</description></item></channel></rss>",
    )[0];
    expect(entry.title).toBe("Story");
    expect(entry.url).toBe("https://www.gov.uk/news/1");
  });
  it("creates exactly 20 and a second partial batch without overlapping reservations", async () => {
    await seed(23);
    const first = await createBatch(db),
      second = await createBatch(db);
    expect(JSON.parse(first.exportJson).articles).toHaveLength(20);
    expect(JSON.parse(second.exportJson).articles).toHaveLength(3);
    expect(await db.batchReservation.count()).toBe(23);
    await expect(createBatch(db)).rejects.toThrow("No unprocessed");
  });
  it("prevents explicit reservation in another active batch", async () => {
    const [a] = await seed();
    await createBatch(db, [a.id]);
    await expect(createBatch(db, [a.id])).rejects.toThrow("reserved");
  });
  it("exports exactly the same original content and batch on redownload", async () => {
    const [a] = await seed();
    const b = await createBatch(db);
    const raw = await exportBatch(db, b.id);
    expect(await exportBatch(db, b.id)).toBe(raw);
    expect(ExportBatch.parse(JSON.parse(raw)).articles[0].content).toBe(
      a.content,
    );
  });
  it("imports complete batch with normalized edges and preserves exact uploaded JSON", async () => {
    const value = await input(2),
      raw = JSON.stringify(value, null, 4) + "\n";
    const p = await previewImport(db, raw);
    expect(p.counts?.events).toBe(2);
    await commit(raw);
    expect(await db.importedEvent.count()).toBe(2);
    expect((await db.analysisImport.findFirstOrThrow()).rawJson).toBe(raw);
    expect(await db.batchReservation.count()).toBe(0);
    expect((await globeEvents(db))[0].relationships[0]).toMatchObject({
      from: "FRA",
      to: "DEU",
      bidirectional: true,
    });
    expect((await globeEvents(db))[0].verificationStatus).toBe("Unverified");
  });
  it("returns exact missing articles and saves nothing on incomplete import", async () => {
    const v = await input(3);
    v.results.pop();
    const p = await previewImport(db, JSON.stringify(v));
    expect(p.valid).toBe(false);
    expect(p.missingArticles).toHaveLength(1);
    await expect(commit(v)).rejects.toThrow();
    expect(await db.analysisImport.count()).toBe(0);
    expect(await db.batchReservation.count()).toBe(3);
  });
  it("rejects duplicate and unknown article IDs, schema version, extra fields", async () => {
    const v = await input(2);
    v.results[1].articleId = v.results[0].articleId;
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
    v.results[1].articleId = "unknown";
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
    v.schemaVersion = "2.0";
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
    v.schemaVersion = "1.0";
    (v as any).secret = "extra";
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
  });
  it("rejects malformed JSON and unknown batch", async () => {
    await expect(previewImport(db, "```json")).rejects.toThrow("Invalid JSON");
    await expect(
      previewImport(
        db,
        JSON.stringify({
          schemaVersion: "1.0",
          batchId: "unknown",
          results: [
            { articleId: "unknown", outcome: "no_relevant_events", events: [] },
          ],
        }),
      ),
    ).rejects.toThrow("Batch does not exist");
  });
  it("handles no relevant events and excludes analyzed articles from automatic batching", async () => {
    const v = await input();
    v.results[0].outcome = "no_relevant_events";
    v.results[0].events = [];
    await commit(v);
    expect(await db.importedEvent.count()).toBe(0);
    expect((await db.collectedArticle.findFirstOrThrow()).analysisStatus).toBe(
      "no_relevant_events",
    );
    await expect(createBatch(db)).rejects.toThrow();
  });
  it("retains needs_review reason without publishing uncertain events", async () => {
    const v = await input();
    v.results[0].outcome = "needs_review";
    (v.results[0] as any).reviewReason =
      "Excerpt does not establish the actual participants";
    await commit(v);
    expect(await globeEvents(db)).toHaveLength(0);
    expect((await db.analysisImport.findFirstOrThrow()).rawJson).toContain(
      "Excerpt does not establish",
    );
  });
  it("requires reviewReason for needs_review and prevents fake empty analyzed results", async () => {
    const v = await input();
    v.results[0].outcome = "needs_review";
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
    v.results[0].outcome = "analyzed";
    v.results[0].events = [];
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
  });
  it("same-file repeat and whitespace-only repeat create no duplicates or new revisions", async () => {
    const v = await input();
    await commit(v);
    expect((await commit(JSON.stringify(v, null, 2))).duplicate).toBe(true);
    expect(await db.importedEvent.count()).toBe(1);
    expect(await db.analysisImport.count()).toBe(1);
  });
  it("changed file requires explicit replacement; shows diff and archives previous raw JSON", async () => {
    const v = await input();
    await commit(v);
    const old = await db.importedEvent.findFirstOrThrow();
    v.results[0].events[0].summary =
      "Corrected summary, reflecting the original publication.";
    expect((await previewImport(db, JSON.stringify(v))).valid).toBe(false);
    const p = await previewImport(db, JSON.stringify(v), "replace");
    expect(p.changes?.updated).toHaveLength(1);
    await commit(v, "replace");
    expect((await db.importedEvent.findFirstOrThrow()).id).toBe(old.id);
    expect(await db.analysisImport.count()).toBe(2);
    expect(
      (
        await db.analysisImport.findFirstOrThrow({
          orderBy: { version: "asc" },
        })
      ).rawJson,
    ).not.toContain("Corrected");
  });
  it("replacement handles removed/added events without deleting history", async () => {
    const v = await input();
    await commit(v);
    v.results[0].events[0].eventKey = "event_2";
    const p = await previewImport(db, JSON.stringify(v), "replace");
    expect(p.changes?.removed).toHaveLength(1);
    expect(p.changes?.added).toHaveLength(1);
    await commit(v, "replace");
    expect(await db.importedEvent.count({ where: { archived: true } })).toBe(1);
    expect(await globeEvents(db)).toHaveLength(1);
  });
  it("requires confirmation and rejects stale or modified preview", async () => {
    const v = await input(),
      raw = JSON.stringify(v),
      p = await previewImport(db, raw);
    await expect(
      importBatch(db, raw, {
        mode: "import",
        confirm: false,
        baseVersion: 0,
        checksum: p.checksum!,
      }),
    ).rejects.toThrow("confirm");
    await expect(
      importBatch(db, raw, {
        mode: "import",
        confirm: true,
        baseVersion: 0,
        checksum: "a".repeat(64),
      }),
    ).rejects.toThrow("changed since preview");
    await commit(v);
    v.results[0].events[0].summary =
      "New summary describes the updated agreement details.";
    const q = await previewImport(db, JSON.stringify(v), "replace");
    await expect(
      importBatch(db, JSON.stringify(v), {
        mode: "replace",
        confirm: true,
        baseVersion: 0,
        checksum: q.checksum!,
      }),
    ).rejects.toThrow("changed since preview");
  });
  it("enforces country codes and organization identity, endpoints and directions", () => {
    const e = event();
    e.participants[0].countryCode = "XX";
    expect(eventIssues(e).length).toBeGreaterThan(0);
    e.participants[0] = {
      name: "EU",
      type: "country",
      role: "partner",
      countryCode: "FR",
    };
    expect(eventIssues(e).length).toBeGreaterThan(0);
    e.participants[0] = {
      name: "European Union",
      type: "international_organization",
      role: "partner",
      countryCode: null,
    };
    e.relationships[0].from = "European Union";
    expect(eventIssues(e)).toHaveLength(0);
    e.relationships[0].to = "US";
    expect(eventIssues(e).length).toBeGreaterThan(0);
  });
  it("multiple events per article, one-country events and organizations preserve semantics", async () => {
    const v = await input();
    const e = event();
    e.eventKey = "event_2";
    e.participants = [
      { name: "France", type: "country", role: "initiator", countryCode: "FR" },
      {
        name: "United Nations",
        type: "international_organization",
        role: "recipient",
        countryCode: null,
      },
    ];
    e.relationships = [
      {
        from: "FR",
        to: "United Nations",
        type: "diplomacy",
        direction: "directed",
      },
    ];
    v.results[0].events.push(e);
    await commit(v);
    const globe = await globeEvents(db);
    expect(globe).toHaveLength(2);
    expect(
      globe.find((g) => g.countries.length === 1)?.relationships,
    ).toHaveLength(0);
  });
  it("one event can cite multiple articles, without title-based merging", async () => {
    const v = await input(2);
    v.results[0].events[0].sourceArticleIds = v.results.map(
      (r: any) => r.articleId,
    );
    v.results[1].outcome = "no_relevant_events";
    v.results[1].events = [];
    await commit(v);
    expect(await db.importedEvent.count()).toBe(1);
    expect(await db.importedEventSource.count()).toBe(2);
    expect((await globeEvents(db))[0].sources).toHaveLength(2);
  });
  it("rolls back all records and statuses if a later event cannot be saved", async () => {
    const v = await input(2);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_import BEFORE INSERT ON ImportedEvent WHEN NEW.articleId = '${v.results[1].articleId}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    );
    try {
      await expect(commit(v)).rejects.toThrow();
      expect(await db.analysisImport.count()).toBe(0);
      expect(await db.importedEvent.count()).toBe(0);
      expect(await db.importedRelationship.count()).toBe(0);
      expect(
        await db.collectedArticle.count({
          where: { analysisStatus: "exported" },
        }),
      ).toBe(2);
      expect((await db.newsBatch.findFirstOrThrow()).importVersion).toBe(0);
    } finally {
      await db.$executeRawUnsafe("DROP TRIGGER fail_import");
    }
  });
  it("end-to-end Source → Collector → Export → fixture import → Database → Globe API, without AI", async () => {
    const fake = (async (url: any) =>
      String(url).endsWith(".atom")
        ? new Response(
            '<feed><entry><id>x</id><title>France Germany agreement</title><link href="https://www.gov.uk/news/1"/><published>2026-10-18T12:00:00Z</published><summary>France and Germany signed an energy agreement.</summary></entry></feed>',
          )
        : new Response(
            JSON.stringify({
              details: {
                body: "France and Germany signed an energy agreement.",
              },
            }),
          )) as typeof fetch;
    const app = createApp(loadConfig({}), db, fake, transport);
    const headers = {
      host: "127.0.0.1:3001",
      "x-world-lens-client": "collection",
    };
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/collection/fetch",
            headers,
            payload: { sourceId: "govuk" },
          })
        ).json().added,
      ).toBe(1);
      const b = (
        await app.inject({
          method: "POST",
          url: "/api/batches",
          headers,
          payload: {},
        })
      ).json();
      const exported = (
        await app.inject({ url: "/api/batches/" + b.id + "/export", headers })
      ).json();
      const rawJson = JSON.stringify({
        schemaVersion: "1.0",
        batchId: b.id,
        results: [
          {
            articleId: exported.articles[0].articleId,
            outcome: "analyzed",
            events: [event()],
          },
        ],
      });
      const p = (
        await app.inject({
          method: "POST",
          url: "/api/import/preview",
          headers,
          payload: { rawJson },
        })
      ).json();
      expect(p.valid).toBe(true);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/import/confirm",
            headers,
            payload: {
              rawJson,
              mode: "import",
              confirm: true,
              baseVersion: p.baseVersion,
              checksum: p.checksum,
            },
          })
        ).statusCode,
      ).toBe(200);
      const response = (
        await app.inject({ url: "/api/globe/events", headers })
      ).json();
      expect(response.events[0].source.url).toBe("https://www.gov.uk/news/1");
      expect(response.events[0].countries).toEqual(["FRA", "DEU"]);
      for (const route of [
        "/dev/ai-lab",
        "/api/ai/usage",
        "/api/articles/process",
      ])
        expect((await app.inject({ url: route, headers })).statusCode).toBe(
          404,
        );
    } finally {
      await app.close();
    }
  });
  it("rejects cross-origin writes, missing client header and network access without authorization", async () => {
    const app = createApp(loadConfig({}), db);
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/batches",
            headers: { host: "localhost", origin: "https://evil.example" },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/batches",
            headers: { host: "localhost" },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
    const network = createApp(
      loadConfig({ HOST: "0.0.0.0", ADMIN_API_TOKEN: "a".repeat(32) }),
      db,
    );
    try {
      expect(
        (await network.inject({ url: "/api/globe/events" })).statusCode,
      ).toBe(401);
    } finally {
      await network.close();
    }
  });
});
