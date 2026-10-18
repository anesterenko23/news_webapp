import { it, expect, beforeEach, afterAll, vi } from "vitest";
import { testDatabase } from "./database.js";
import {
  collectMany,
  initializeSources,
  parseFeed,
  parseGovJson,
  normalizedContent,
  hash,
  sourceStates,
} from "../src/collector.js";
import { knownSource } from "../src/source-registry.js";
import { collectionHints } from "../src/collection-hints.js";
import { listCollected, collectionStats } from "../src/collection-service.js";
import {
  publicAddress,
  validateRemote,
  sourceRequest,
  type HttpBudget,
} from "../src/source-http.js";
import {
  createBatch,
  exportBatch,
  previewImport,
  importBatch,
} from "../src/batches.js";
import { ExportBatch } from "../src/batch-contract.js";
import { globeEvents } from "../src/manual-globe.js";
import { startCollectionScheduler } from "../src/collection-scheduler.js";
import { loadConfig } from "../src/config.js";
const fixture = await testDatabase(),
  db = fixture.db;
const transport = {
  resolver: (async () => [{ address: "93.184.216.34", family: 4 }]) as any,
  skipThrottle: true,
};
it("sample-audit regressions: tear gas/music are not energy policy, Iran and Mexico use their intended regions", () => {
  expect(
    collectionHints("Police fire tear gas during protests", "").topics,
  ).not.toContain("energy");
  expect(
    collectionHints("Afrobeats music brings 100,000-volt energy", "").topics,
  ).not.toContain("energy");
  expect(
    collectionHints("Iranian foreign minister visits Mexico", "").regions,
  ).toEqual(expect.arrayContaining(["Middle East", "Latin America"]));
  expect(collectionHints("Tell us more", "").countryMentions).not.toContain(
    "US",
  );
  expect(collectionHints("Uxsx", "").countryMentions).not.toContain("US");
});
beforeEach(async () => {
  for (const table of [
    "importedEventSource",
    "importedRelationship",
    "importedEvent",
    "analysisImport",
    "batchReservation",
    "batchArticle",
    "newsBatch",
    "collectedArticle",
    "newsSourceState",
    "collectionRun",
    "collectorLease",
  ] as const)
    await db[table].deleteMany();
});
afterAll(() => fixture.close());
function rss(
  host = "www.bbc.com",
  n = 3,
  options: { guid?: string; text?: string; date?: string } = {},
) {
  return (
    "<rss><channel><language>en</language>" +
    Array.from(
      { length: n },
      (_, i) =>
        `<item><guid>${options.guid ?? "id" + i}</guid><title>France and Germany energy agreement ${i}</title><link>https://${host}/news/${i}</link><description>${options.text ?? "France and Germany announce an energy agreement " + i}</description>${options.date === undefined ? "<pubDate>2026-10-18T10:00:00Z</pubDate>" : options.date ? "<pubDate>" + options.date + "</pubDate>" : ""}<category>World</category></item>`,
    ).join("") +
    "</channel></rss>"
  );
}
const fake = (body: string) =>
  vi.fn(async () => new Response(body)) as unknown as typeof fetch;
function budget(fetcher: typeof fetch): HttpBudget {
  return {
    remaining: 10,
    used: 0,
    timeoutMs: 100,
    retries: 0,
    maxBytes: 100000,
    fetcher,
    ...transport,
  };
}
it("RSS parsing preserves GUID, categories, creator and unknown date; strips scripts", () => {
  const [entry] = parseFeed(
    '<rss xmlns:dc="x"><channel><item><guid>g</guid><title>Original title</title><link>https://www.bbc.com/news/a</link><dc:creator>A Writer</dc:creator><description><![CDATA[<p>Original excerpt</p><script>bad()</script>]]></description><category>Diplomacy</category></item></channel></rss>',
  );
  expect(entry).toMatchObject({
    id: "g",
    title: "Original title",
    published: "",
    author: "A Writer",
    excerpt: "Original excerpt",
    tags: ["Diplomacy"],
  });
});
it("Atom parser uses alternate link and published time, not updated time", () => {
  const [entry] = parseFeed(
    '<feed><entry><id>x</id><title>Original</title><link rel="self" href="https://www.gov.uk/api/x"/><link rel="alternate" href="https://www.gov.uk/x"/><published>2026-10-01T12:00:00Z</published><updated>2026-10-18T12:00:00Z</updated><summary>Excerpt</summary><category term="Energy"/></entry></feed>',
  );
  expect(entry.url).toBe("https://www.gov.uk/x");
  expect(entry.published).toBe("2026-10-01T12:00:00Z");
  expect(entry.tags).toContain("Energy");
});
it("normalizes official JSON API and rejects malformed envelopes", () => {
  expect(
    parseGovJson(
      JSON.stringify({
        results: [
          {
            title: "Original",
            link: "/news/a",
            description: "Excerpt",
            format: "speech",
          },
        ],
        total: 1,
        start: 0,
      }),
    ).entries[0],
  ).toMatchObject({
    url: "https://www.gov.uk/news/a",
    published: "",
    tags: ["speech"],
  });
  expect(() => parseGovJson('{"results":[]}')).toThrow();
});
it("does not accept HTML bot pages as successful feeds", () => {
  expect(() =>
    parseFeed("<html><body>Enable JavaScript</body></html>"),
  ).toThrow("not an RSS/Atom");
});
it("collects several sources and isolates a failing source", async () => {
  const fetcher = vi.fn(async (url: any) =>
    String(url).includes("france24")
      ? new Response("Unavailable", { status: 503 })
      : new Response(
          rss(
            String(url).includes("theguardian")
              ? "www.theguardian.com"
              : "www.bbc.com",
          ),
        ),
  ) as unknown as typeof fetch;
  const r = await collectMany(
    db,
    { sourceIds: ["bbc-world", "guardian-world", "france24"], maxArticles: 30 },
    fetcher,
    transport,
  );
  expect(r.added).toBe(6);
  expect(r.status).toBe("partial");
  expect(r.sources.find((s) => s.sourceId === "france24")?.status).toBe(
    "failed",
  );
  expect(
    (await db.newsSourceState.findUniqueOrThrow({ where: { id: "bbc-world" } }))
      .lastSuccessAt,
  ).not.toBeNull();
});
it("same canonical URL across feeds cannot create a duplicate and analyzed state survives", async () => {
  const fetcher = fake(rss("www.bbc.com", 1));
  await collectMany(db, { sourceId: "bbc-world" }, fetcher, transport);
  const a = await db.collectedArticle.findFirstOrThrow();
  await db.collectedArticle.update({
    where: { id: a.id },
    data: { analysisStatus: "analyzed", analysisVersion: 3 },
  });
  const r = await collectMany(
    db,
    { sourceId: "bbc-africa" },
    fetcher,
    transport,
  );
  expect(r.duplicates).toBe(1);
  expect(await db.collectedArticle.count()).toBe(1);
  expect((await db.collectedArticle.findFirstOrThrow()).analysisVersion).toBe(
    3,
  );
});
it("duplicate GUID with different URLs is suppressed", async () => {
  await collectMany(
    db,
    { sourceId: "bbc-world" },
    fake(rss("www.bbc.com", 3, { guid: "same-guid" })),
    transport,
  );
  expect(await db.collectedArticle.count()).toBe(1);
});
it("normalized exact content deduplicates within publisher; independent reporting remains separate", async () => {
  await collectMany(
    db,
    { sourceId: "bbc-world" },
    fake(rss("www.bbc.com", 3, { text: "Identical body" })),
    transport,
  );
  expect(await db.collectedArticle.count()).toBe(1);
  await collectMany(
    db,
    { sourceId: "guardian-world" },
    fake(rss("www.theguardian.com", 1, { text: "Identical body" })),
    transport,
  );
  expect(await db.collectedArticle.count()).toBe(2);
  expect(hash(normalizedContent("a  b\n"))).toBe(
    hash(normalizedContent("a b")),
  );
});
it("does not invent dates or full text from feed summaries", async () => {
  await collectMany(
    db,
    { sourceId: "bbc-world" },
    fake(rss("www.bbc.com", 1, { date: "" })),
    transport,
  );
  const a = await db.collectedArticle.findFirstOrThrow();
  expect(a.publishedAt).toBeNull();
  expect(a.contentStatus).toBe("excerpt");
  expect(a.extractionMethod).toBe("rss-summary");
});
it("preserves metadata-only entries when content is absent", async () => {
  await collectMany(
    db,
    { sourceId: "bbc-world" },
    fake(rss("www.bbc.com", 1, { text: "" })),
    transport,
  );
  expect((await db.collectedArticle.findFirstOrThrow()).contentStatus).toBe(
    "metadata_only",
  );
});
it("official content API is the only enabled full-text adapter and fallback remains excerpt", async () => {
  const fetcher = (async (url: any) =>
    String(url).includes("/api/content")
      ? new Response("", { status: 404 })
      : new Response(rss("www.gov.uk", 1))) as typeof fetch;
  await collectMany(db, { sourceId: "govuk-fcdo" }, fetcher, transport);
  const a = await db.collectedArticle.findFirstOrThrow();
  expect(a.contentStatus).toBe("excerpt");
  expect(a.extractionStatus).toBe("fallback_excerpt");
});
it("latest collection is no longer capped at 20 and a later fetch can finish a limited window", async () => {
  const feed = fake(rss("www.bbc.com", 45));
  expect(
    (
      await collectMany(
        db,
        { sourceId: "bbc-world", maxArticles: 25 },
        feed,
        transport,
      )
    ).added,
  ).toBe(25);
  expect(
    (
      await collectMany(
        db,
        { sourceId: "bbc-world", maxArticles: 25 },
        feed,
        transport,
      )
    ).added,
  ).toBe(20);
  expect(
    (
      await collectMany(
        db,
        { sourceId: "bbc-world", maxArticles: 25 },
        feed,
        transport,
      )
    ).added,
  ).toBe(0);
});
it("historical collection uses date-filtered JSON pagination and stores checkpoint", async () => {
  const seen: string[] = [];
  const fetcher = (async (url: any) => {
    const u = new URL(String(url));
    seen.push(u.href);
    if (u.pathname.startsWith("/api/content"))
      return new Response(
        JSON.stringify({
          details: { body: "<p>Full source body " + u.pathname + "</p>" },
        }),
      );
    const start = Number(u.searchParams.get("start"));
    const results =
      start === 0
        ? [
            {
              title: "France Germany agreement",
              link: "/news/one",
              public_timestamp: "2026-10-01T12:00:00Z",
              description: "First",
            },
          ]
        : [
            {
              title: "France Germany agreement two",
              link: "/news/two",
              public_timestamp: "2026-10-02T12:00:00Z",
              description: "Second",
            },
          ];
    return new Response(JSON.stringify({ results, total: 2, start }));
  }) as typeof fetch;
  const r = await collectMany(
    db,
    {
      sourceId: "govuk-fcdo",
      mode: "historical",
      from: "2026-10-01",
      to: "2026-10-02",
      maxArticles: 20,
    },
    fetcher,
    transport,
  );
  expect(r.sources[0].coverage).toBe("complete");
  expect(r.added).toBe(2);
  expect(seen.some((s) => s.includes("start=1"))).toBe(true);
  expect(
    seen.some(
      (s) =>
        new URL(s).searchParams.get("filter_public_timestamp") ===
        "from:2026-10-01,to:2026-10-02",
    ),
  ).toBe(true);
  expect(
    JSON.parse(
      (
        await db.newsSourceState.findUniqueOrThrow({
          where: { id: "govuk-fcdo" },
        })
      ).checkpointJson,
    ).complete,
  ).toBe(true);
});
it("unsupported historical RSS never masquerades as archived coverage", async () => {
  const fetcher = vi.fn() as unknown as typeof fetch;
  const r = await collectMany(
    db,
    {
      sourceId: "bbc-world",
      mode: "historical",
      from: "2026-10-01",
      to: "2026-10-02",
    },
    fetcher,
    transport,
  );
  expect(r.sources[0].coverage).toBe("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
it("bounds historical pages, budgets and resumes persisted cursor after restart", async () => {
  const starts: number[] = [];
  const fetcher = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith("/api/content"))
      return new Response(
        JSON.stringify({ details: { body: "Full text " + u.pathname } }),
      );
    const start = Number(u.searchParams.get("start"));
    starts.push(start);
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "International news " + start,
            link: "/news/" + start,
            description: "Excerpt " + start,
            public_timestamp: "2026-10-01T12:00:00Z",
          },
        ],
        total: 4,
        start,
      }),
    );
  }) as typeof fetch;
  const args = {
    sourceId: "govuk-fcdo",
    mode: "historical",
    from: "2026-10-01",
    to: "2026-10-02",
    maxPages: 1,
  };
  const first = await collectMany(db, args, fetcher, transport);
  expect(first.sources[0].coverage).toBe("partial");
  await db.collectorLease.create({
    data: { id: "collection", token: "dead-process", expiresAt: new Date(0) },
  });
  await db.collectionRun.create({
    data: { status: "running", optionsJson: "{}" },
  });
  await collectMany(db, args, fetcher, transport);
  expect(starts).toEqual([0, 1]);
  expect(
    await db.collectionRun.count({ where: { status: "interrupted" } }),
  ).toBe(1);
  const budgeted = await collectMany(
    db,
    { sourceId: "bbc-world", requestBudget: 1, maxArticles: 1 },
    fake(rss("www.bbc.com", 1)),
    transport,
  );
  expect(budgeted.requestsUsed).toBeLessThanOrEqual(1);
});
it("overlapping jobs cannot acquire the same persisted lease", async () => {
  await db.collectorLease.create({
    data: {
      id: "collection",
      token: "active",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await expect(collectMany(db, {}, fake(rss()), transport)).rejects.toThrow(
    "FETCH_RUNNING",
  );
});
it("conditional requests avoid unnecessary re-fetching after complete window", async () => {
  let conditional = false;
  const fetcher = (async (_url: any, init: any) => {
    if (init.headers["If-None-Match"]) {
      conditional = true;
      return new Response(null, { status: 304 });
    }
    return new Response(rss("www.bbc.com", 1), {
      headers: { etag: '"feed-v1"' },
    });
  }) as typeof fetch;
  await collectMany(db, { sourceId: "bbc-world" }, fetcher, transport);
  const r = await collectMany(
    db,
    { sourceId: "bbc-world" },
    fetcher,
    transport,
  );
  expect(conditional).toBe(true);
  expect(r.sources[0].coverage).toBe("not_modified");
});
it("URL/GUID source state enablement survives initialization", async () => {
  await initializeSources(db);
  await db.newsSourceState.update({
    where: { id: "bbc-world" },
    data: { enabled: false },
  });
  await initializeSources(db);
  expect(
    (await sourceStates(db)).find((s) => s.id === "bbc-world")?.enabled,
  ).toBe(false);
  expect((await sourceStates(db)).find((s) => s.id === "govuk")?.enabled).toBe(
    false,
  );
});
it("topic and region hints are transparent, multi-region, and never produce relationships", () => {
  const h = collectionHints(
    "US sanctions against Russia over war in Ukraine",
    "European diplomacy",
  );
  expect(h.topics).toEqual(
    expect.arrayContaining(["sanctions", "conflict", "diplomacy"]),
  );
  expect(h.regions).toContain("Europe");
  expect(h).not.toHaveProperty("relationships");
  expect(collectionHints("Local school warning notice", "").topics).toEqual([
    "other",
  ]);
  expect(collectionHints("Children return to school", "").regions).toEqual([
    "Unknown",
  ]);
});
it("server-side filters, sort and pagination work with thousands of stored articles", async () => {
  await db.collectedArticle.createMany({
    data: Array.from({ length: 2200 }, (_, i) => ({
      sourceId: "bbc-world",
      source: "BBC World",
      publisher: "BBC",
      sourceUrl: "https://www.bbc.com",
      url: "https://www.bbc.com/news/" + i,
      title: "International publication " + i,
      publishedAt: new Date(Date.UTC(2026, 9, 1 + (i % 18))),
      language: "en",
      content: "Excerpt " + i,
      description: "Energy story " + i,
      contentStatus: "excerpt",
      contentHash: hash("x" + i),
      originalJson: "{}",
      regionsJson: '["Africa"]',
      categoriesJson: '["energy"]',
    })),
  });
  const page = await listCollected(db, {
    source: "bbc-world",
    region: "Africa",
    topic: "energy",
    from: "2026-10-01",
    to: "2026-10-18",
    sort: "oldest",
    offset: 100,
  });
  expect(page.total).toBe(2200);
  expect(page.articles).toHaveLength(100);
  expect(page.articles[0].id).not.toBe(page.articles[99].id);
  const stats = await collectionStats(db);
  expect(stats.byRegion.Africa).toBe(2200);
  expect(stats.byTopic.energy).toBe(2200);
});
it("SSRF rejects internal URLs, credentials, ports and private DNS before fetch", async () => {
  const source = knownSource("bbc-world");
  for (const url of [
    "http://127.0.0.1/",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://www.bbc.com:8080/",
    "https://user:pass@www.bbc.com/",
    "https://evil.example/",
  ])
    await expect(
      validateRemote(url, source, transport.resolver),
    ).rejects.toThrow();
  await expect(
    validateRemote("https://www.bbc.com/news/a", source, (async () => [
      { address: "10.0.0.1", family: 4 },
    ]) as any),
  ).rejects.toThrow("private");
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    expect(publicAddress(ip)).toBe(false);
});
it("redirects cannot escape source allowlists and oversized bodies are rejected", async () => {
  const b = budget(
    (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest" },
      })) as typeof fetch,
  );
  await expect(
    sourceRequest(knownSource("bbc-world").feed, knownSource("bbc-world"), b),
  ).rejects.toThrow("outside");
  const large = budget(fake("a".repeat(100001)));
  await expect(
    sourceRequest(
      knownSource("bbc-world").feed,
      knownSource("bbc-world"),
      large,
    ),
  ).rejects.toThrow("size limit");
});
it("default scheduler is off and cannot create model analysis or publication", () => {
  vi.useFakeTimers();
  const stop = startCollectionScheduler(db, loadConfig({}));
  expect(vi.getTimerCount()).toBe(0);
  stop();
  vi.useRealTimers();
});
it("multi-source end-to-end keeps 20-article export contract and imported globe events", async () => {
  const fetcher = (async (url: any) => {
    const host = String(url).includes("theguardian")
      ? "www.theguardian.com"
      : String(url).includes("france24")
        ? "www.france24.com"
        : "www.bbc.com";
    return new Response(rss(host, 10));
  }) as typeof fetch;
  await collectMany(
    db,
    { sourceIds: ["bbc-world", "guardian-world", "france24"], maxArticles: 30 },
    fetcher,
    transport,
  );
  const batch = await createBatch(db),
    exported = ExportBatch.parse(JSON.parse(await exportBatch(db, batch.id)));
  expect(exported.articles).toHaveLength(20);
  expect(new Set(exported.articles.map((a) => a.source.name)).size).toBe(3);
  const rawJson = JSON.stringify({
    schemaVersion: "1.0",
    batchId: batch.id,
    results: exported.articles.map((a, i) => ({
      articleId: a.articleId,
      outcome: i ? "no_relevant_events" : "analyzed",
      events: i
        ? []
        : [
            {
              eventKey: "event_1",
              title: "France and Germany cooperate",
              summary: "France and Germany announced energy cooperation.",
              eventType: "energy",
              status: "announced",
              reason: null,
              participants: [
                {
                  name: "France",
                  type: "country",
                  role: "partner",
                  countryCode: "FR",
                },
                {
                  name: "Germany",
                  type: "country",
                  role: "partner",
                  countryCode: "DE",
                },
              ],
              relationships: [
                {
                  from: "FR",
                  to: "DE",
                  type: "energy",
                  direction: "bidirectional",
                },
              ],
            },
          ],
    })),
  });
  const p = await previewImport(db, rawJson);
  expect(p.valid).toBe(true);
  await importBatch(db, rawJson, {
    mode: "import",
    confirm: true,
    checksum: p.checksum!,
    baseVersion: 0,
  });
  expect(await globeEvents(db)).toHaveLength(1);
  expect(
    await db.collectedArticle.count({
      where: { analysisStatus: "no_relevant_events" },
    }),
  ).toBe(19);
  expect(
    (
      await importBatch(db, rawJson, {
        mode: "import",
        confirm: true,
        checksum: p.checksum!,
        baseVersion: 0,
      })
    ).duplicate,
  ).toBe(true);
});
