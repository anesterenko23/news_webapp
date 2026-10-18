import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import type { NewsSource } from "./source-registry.js";
export class CollectionLimit extends Error {}
export function publicAddress(ip: string) {
  if (ip.includes(":")) {
    const s = ip.toLowerCase();
    return (
      !/^(::|fc|fd|fe[89ab]|ff|2001:db8)/.test(s) && !s.includes("::ffff:")
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    !!a &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0)
  );
}
export async function validateRemote(
  url: string,
  source: NewsSource,
  resolver = lookup,
) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    isIP(u.hostname) ||
    ![...source.feedHosts, ...source.articleHosts].includes(u.hostname)
  )
    throw new Error("Remote URL is outside registered HTTPS source hosts");
  const records = await resolver(u.hostname, { all: true });
  if (!records.length || records.some((x) => !publicAddress(x.address)))
    throw new Error("Remote host resolves to a private/reserved address");
  return u;
}
export interface HttpBudget {
  remaining: number;
  used: number;
  timeoutMs: number;
  retries: number;
  maxBytes: number;
  fetcher: typeof fetch;
  resolver?: typeof lookup;
  skipThrottle?: boolean;
  beforeRequest?: () => Promise<void>;
}
const nextRequest = new Map<string, number>();
export async function sourceRequest(
  url: string,
  source: NewsSource,
  budget: HttpBudget,
  headers: Record<string, string> = {},
) {
  let current = url;
  for (let attempt = 0; attempt <= budget.retries; attempt++) {
    try {
      for (let redirect = 0; redirect <= 3; redirect++) {
        await validateRemote(current, source, budget.resolver);
        if (budget.remaining <= 0)
          throw new CollectionLimit("Request budget exhausted");
        await budget.beforeRequest?.();
        budget.remaining--;
        budget.used++;
        const host = new URL(current).hostname;
        if (!budget.skipThrottle) {
          const wait = Math.max(0, (nextRequest.get(host) ?? 0) - Date.now());
          nextRequest.set(host, Date.now() + wait + 150);
          if (wait) await sleep(wait);
        }
        const response = await budget.fetcher(current, {
          headers: {
            "User-Agent": "WorldLens/0.5.1 (personal RSS reader)",
            Accept:
              "application/rss+xml, application/atom+xml, application/json, text/xml",
            ...headers,
          },
          redirect: "manual",
          signal: AbortSignal.timeout(budget.timeoutMs),
        });
        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.status !== 304
        ) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || redirect === 3)
            throw new Error("Invalid/excessive source redirect");
          current = new URL(location, current).href;
          continue;
        }
        if (response.status === 304)
          return { text: "", status: 304, headers: response.headers };
        if (!response.ok) {
          await response.body?.cancel();
          const error = new Error("Source returned HTTP " + response.status);
          if (
            attempt < budget.retries &&
            (response.status === 429 || response.status >= 500)
          ) {
            const seconds = Number(response.headers.get("retry-after"));
            if (Number.isFinite(seconds) && seconds > 2)
              throw new CollectionLimit(
                "Source Retry-After exceeds current job window",
              );
            await sleep(250);
            break;
          }
          throw error;
        }
        if (Number(response.headers.get("content-length")) > budget.maxBytes) {
          await response.body?.cancel();
          throw new Error("Source response exceeds size limit");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty source response");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > budget.maxBytes) {
            await reader.cancel();
            throw new Error("Source response exceeds size limit");
          }
          chunks.push(value);
        }
        return {
          text: Buffer.concat(chunks).toString("utf8"),
          status: response.status,
          headers: response.headers,
        };
      }
    } catch (e) {
      if (
        e instanceof CollectionLimit ||
        attempt >= budget.retries ||
        (e instanceof Error &&
          /outside registered|private\/reserved|size limit|HTTP 4|redirect/.test(
            e.message,
          ))
      )
        throw e;
      await sleep(250);
    }
  }
  throw new Error("Source request could not complete");
}
