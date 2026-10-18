import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { countryMetadata } from "./countries.js";
const codes = new Map(countryMetadata.map((c) => [c.cca2, c.cca3]));
const catalogue = JSON.parse(
  readFileSync(
    new URL("../../src/data/country-catalogue.json", import.meta.url),
    "utf8",
  ),
);
const renderTypes: Record<string, string> = {
  conflict: "conflict",
  trade: "trade",
  trade_restrictions: "trade",
  military_aid: "military",
  military_cooperation: "military",
  diplomacy: "diplomacy",
  international_agreement: "diplomacy",
  energy: "energy",
};
export async function globeEvents(db: PrismaClient) {
  const records = await db.importedEvent.findMany({
    where: { archived: false, publicationStatus: "Published" },
    include: { relationships: true, sources: { include: { article: true } } },
    orderBy: { publishedAt: "desc" },
  });
  return records.map((e) => {
    const participants = JSON.parse(e.participantsJson) as {
      name: string;
      type: string;
      countryCode: string | null;
      role: string;
    }[];
    const countries = participants
      .filter((p) => p.type === "country")
      .map((p) => codes.get(p.countryCode!))
      .filter((code): code is string => !!code && !!catalogue[code]);
    const sources = e.sources.map((s) => ({
      articleId: s.articleId,
      name: s.article.source,
      url: s.article.url,
    }));
    const category = renderTypes[e.eventType] ?? "other";
    return {
      id: e.id,
      title: e.title,
      description: e.summary,
      category,
      originalType: e.eventType,
      eventStatus: e.eventStatus,
      reason: e.reason,
      verificationStatus: e.verificationStatus,
      publicationStatus: e.publicationStatus,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      image: "",
      imageAlt: "",
      source: sources[0],
      sources,
      countries,
      participants,
      relationships: e.relationships.flatMap((r) => {
        const from = codes.get(r.from),
          to = codes.get(r.to);
        return r.direction !== "unknown" &&
          from &&
          to &&
          catalogue[from] &&
          catalogue[to]
          ? [
              {
                from,
                to,
                type: renderTypes[r.type] ?? "other",
                originalType: r.type,
                bidirectional: r.direction === "bidirectional",
              },
            ]
          : [];
      }),
      allRelationships: e.relationships,
      coordinates: countries.length
        ? catalogue[countries[0]].coordinates
        : { lat: 20, lng: 0 },
      demo: false,
    };
  });
}
