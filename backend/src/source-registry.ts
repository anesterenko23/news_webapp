export interface NewsSource {
  id: string;
  name: string;
  publisher: string;
  url: string;
  feed: string;
  type: "rss" | "atom" | "json";
  language: string;
  scope: string;
  topics: string[];
  enabled: boolean;
  history: boolean;
  fullText: boolean;
  documentation: string;
  terms: string;
  policy: string;
  feedHosts: string[];
  articleHosts: string[];
}
function source(
  id: string,
  name: string,
  publisher: string,
  url: string,
  feed: string,
  scope: string,
  documentation: string,
  terms: string,
  extra: Partial<NewsSource> = {},
): NewsSource {
  return {
    id,
    name,
    publisher,
    url,
    feed,
    type: "rss",
    language: "en",
    scope,
    topics: ["international"],
    enabled: true,
    history: false,
    fullText: false,
    documentation,
    terms,
    policy:
      "Official RSS excerpt only; attribution and original link retained. No page scraping. Publisher reuse restrictions apply.",
    feedHosts: [new URL(feed).hostname],
    articleHosts: [new URL(url).hostname],
    ...extra,
  };
}
export const SOURCES: NewsSource[] = [
  source(
    "bbc-world",
    "BBC World",
    "BBC",
    "https://www.bbc.com",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "Global",
    "https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm",
    "https://www.bbc.co.uk/usingthebbc/terms/",
    {
      articleHosts: ["www.bbc.com", "www.bbc.co.uk", "bbc.com", "bbc.co.uk"],
      policy:
        "Personal RSS reader use with BBC attribution. Commercial reuse requires publisher permission. Excerpts only.",
    },
  ),
  source(
    "guardian-world",
    "The Guardian World",
    "The Guardian",
    "https://www.theguardian.com",
    "https://www.theguardian.com/world/rss",
    "Global",
    "https://www.theguardian.com/help/feeds",
    "https://www.theguardian.com/help/terms-of-service",
    {
      policy:
        "Personal non-commercial RSS reader use. Excerpts only; commercial use requires separate rights.",
    },
  ),
  source(
    "france24",
    "France 24",
    "France 24",
    "https://www.france24.com",
    "https://www.france24.com/en/rss",
    "Global",
    "https://www.france24.com/en/rss",
    "https://www.france24.com/en/terms-and-conditions",
    {
      enabled: false,
      policy:
        "Feed initially verified, but collector received non-feed/DTD responses during repeated tests. Disabled by default until source availability is stable. No access restrictions bypassed.",
    },
  ),
  source(
    "npr-world",
    "NPR World",
    "NPR",
    "https://www.npr.org",
    "https://feeds.npr.org/1004/rss.xml",
    "Global",
    "https://feeds.npr.org/1004/rss.xml",
    "https://www.npr.org/about-npr/179876898/terms-of-use",
    {
      policy:
        "Official feed states For Personal Use Only. RSS excerpt only, no article scraping or commercial licence assumed.",
    },
  ),
  source(
    "dw-world",
    "DW World",
    "DW",
    "https://www.dw.com",
    "https://rss.dw.com/rdf/rss-en-world",
    "Global",
    "https://rss.dw.com/rdf/rss-en-world",
    "https://www.dw.com/en/terms-of-use/a-16594243",
    { articleHosts: ["www.dw.com", "dw.com", "p.dw.com"] },
  ),
  source(
    "aljazeera",
    "Al Jazeera English",
    "Al Jazeera",
    "https://www.aljazeera.com",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "Global",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.aljazeera.com/terms-and-conditions",
  ),
  source(
    "un-news",
    "UN News",
    "United Nations",
    "https://news.un.org",
    "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
    "Global",
    "https://news.un.org/en/rss-feeds",
    "https://www.un.org/en/about-us/terms-of-use",
    { topics: ["humanitarian", "diplomacy"] },
  ),
  source(
    "cna-world",
    "CNA World",
    "Mediacorp",
    "https://www.channelnewsasia.com",
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311",
    "Global",
    "https://www.channelnewsasia.com/rss",
    "https://www.channelnewsasia.com/rss",
    {
      policy:
        "Free personal non-commercial RSS service; excerpts only. Publisher licence needed for commercial reuse.",
    },
  ),
  source(
    "cna-asia",
    "CNA Asia",
    "Mediacorp",
    "https://www.channelnewsasia.com",
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511",
    "Asia-Pacific",
    "https://www.channelnewsasia.com/rss",
    "https://www.channelnewsasia.com/rss",
    {
      policy:
        "Free personal non-commercial RSS service; excerpts only. Publisher licence needed for commercial reuse.",
    },
  ),
  source(
    "guardian-americas",
    "The Guardian Americas",
    "The Guardian",
    "https://www.theguardian.com",
    "https://www.theguardian.com/world/americas/rss",
    "Americas",
    "https://www.theguardian.com/help/feeds",
    "https://www.theguardian.com/help/terms-of-service",
    {
      policy:
        "Personal non-commercial RSS reader use; same publisher as Guardian World. Excerpts only.",
    },
  ),
  source(
    "bbc-africa",
    "BBC Africa",
    "BBC",
    "https://www.bbc.com",
    "https://feeds.bbci.co.uk/news/world/africa/rss.xml",
    "Africa",
    "https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm",
    "https://www.bbc.co.uk/usingthebbc/terms/",
    { articleHosts: ["www.bbc.com", "www.bbc.co.uk", "bbc.com", "bbc.co.uk"] },
  ),
  source(
    "govuk-fcdo",
    "GOV.UK Foreign Affairs",
    "GOV.UK",
    "https://www.gov.uk",
    "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=foreign-commonwealth-development-office",
    "Global",
    "https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html",
    "https://www.gov.uk/help/reuse-govuk-content",
    {
      type: "atom",
      history: true,
      fullText: true,
      policy:
        "Open Government Licence v3.0 except third-party material. Official Content API full text, otherwise excerpt.",
    },
  ),
  source(
    "govuk",
    "GOV.UK",
    "GOV.UK",
    "https://www.gov.uk",
    "https://www.gov.uk/search/news-and-communications.atom",
    "United Kingdom",
    "https://www.gov.uk/help/reuse-govuk-content",
    "https://www.gov.uk/help/reuse-govuk-content",
    {
      type: "atom",
      enabled: false,
      history: true,
      fullText: true,
      policy:
        "Legacy general domestic feed disabled by default; existing articles/batches retained. OGL except third-party material.",
    },
  ),
];
export const REGIONS = [
  "Europe",
  "North America",
  "Latin America",
  "Asia-Pacific",
  "Middle East",
  "Africa",
  "Global",
  "Unknown",
] as const;
export function knownSource(id: string) {
  const s = SOURCES.find((s) => s.id === id);
  if (!s) throw new Error("Unknown registered source: " + id);
  return s;
}
