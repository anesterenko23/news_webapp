import { z } from "zod";
import {
  TAXONOMY,
  EVENT_STATUSES,
  ROLES,
  ENTITY_TYPES,
  ISO_CODES,
} from "./schemas.js";
import { resolveCountry, isOrganization } from "./entities.js";
export const VERSION = "1.0";
export const webUrl = z
  .url()
  .max(2000)
  .refine((s) => {
    const u = new URL(s);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "HTTP(S) URL required");
const id = z.string().min(1).max(150);
export const ContentStatus = z.enum([
  "full",
  "excerpt",
  "metadata_only",
  "unavailable",
]);
export const ExportArticle = z.strictObject({
  articleId: id,
  source: z.strictObject({ name: z.string().min(1), url: webUrl }),
  title: z.string().min(1),
  originalUrl: webUrl,
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  language: z.string().min(2).max(20),
  contentStatus: ContentStatus,
  content: z.string().max(200000),
});
export const ExportBatch = z.strictObject({
  schemaVersion: z.literal(VERSION),
  batchId: id,
  exportedAt: z.iso.datetime({ offset: true }),
  articles: z.array(ExportArticle).min(1).max(20),
});
const Participant = z.strictObject({
  name: z.string().min(1).max(200),
  type: z.enum(ENTITY_TYPES),
  role: z.enum(ROLES),
  countryCode: z.string().nullable(),
});
export const ImportEvent = z.strictObject({
  eventKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  title: z.string().min(3).max(300),
  summary: z.string().min(10).max(4000),
  eventType: z.enum(TAXONOMY),
  status: z.enum(EVENT_STATUSES),
  reason: z.string().min(1).max(3000).nullable(),
  participants: z.array(Participant).min(1).max(30),
  relationships: z
    .array(
      z.strictObject({
        from: z.string().min(1).max(200),
        to: z.string().min(1).max(200),
        type: z.enum(TAXONOMY),
        direction: z.enum(["directed", "bidirectional", "unknown"]),
      }),
    )
    .max(30),
  sourceArticleIds: z.array(id).min(1).max(20).optional(),
});
export const ImportBatch = z.strictObject({
  schemaVersion: z.literal(VERSION),
  batchId: id,
  results: z
    .array(
      z.strictObject({
        articleId: id,
        outcome: z.enum(["analyzed", "no_relevant_events", "needs_review"]),
        reviewReason: z.string().min(1).max(3000).optional(),
        events: z.array(ImportEvent).max(30),
      }),
    )
    .min(1)
    .max(20),
});
export type ImportData = z.infer<typeof ImportBatch>;
export type ImportEventData = z.infer<typeof ImportEvent>;
export function eventIssues(
  event: ImportEventData,
): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const fail = (path: string, message: string) =>
    errors.push({ path, message });
  const endpoints = new Set<string>();
  event.participants.forEach((p, i) => {
    const endpoint = p.type === "country" ? p.countryCode : p.name;
    if (!endpoint) {
      fail(
        `participants.${i}.countryCode`,
        "Country requires an ISO alpha-2 code",
      );
      return;
    }
    if (endpoints.has(endpoint))
      fail(`participants.${i}`, "Duplicate participant endpoint");
    endpoints.add(endpoint);
    if (p.type === "country") {
      if (!ISO_CODES.has(p.countryCode!))
        fail(`participants.${i}.countryCode`, "Unknown ISO alpha-2 code");
      const resolved = resolveCountry(p.name);
      if (isOrganization(p.name) || (resolved && resolved !== p.countryCode))
        fail(`participants.${i}.name`, "Name does not match the country code");
      if (!resolved)
        fail(
          `participants.${i}.name`,
          "Unrecognized country name; use a dictionary name",
        );
    } else if (p.countryCode !== null)
      fail(
        `participants.${i}.countryCode`,
        "Non-country participants must use null",
      );
  });
  const links = new Set<string>();
  event.relationships.forEach((r, i) => {
    for (const key of ["from", "to"] as const)
      if (!endpoints.has(r[key]))
        fail(
          `relationships.${i}.${key}`,
          "Endpoint must reference a country code or non-country participant name",
        );
    if (r.from === r.to)
      fail(`relationships.${i}`, "Self-relationship is not allowed");
    const pair =
      r.direction === "bidirectional" ? [r.from, r.to].sort() : [r.from, r.to];
    const key = JSON.stringify([...pair, r.type, r.direction]);
    if (links.has(key)) fail(`relationships.${i}`, "Duplicate relationship");
    links.add(key);
  });
  return errors;
}
export const exportJsonSchema = z.toJSONSchema(ExportBatch, {
  target: "draft-7",
});
export const importJsonSchema = z.toJSONSchema(ImportBatch, {
  target: "draft-7",
});
