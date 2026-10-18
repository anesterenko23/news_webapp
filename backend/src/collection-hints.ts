import { createRequire } from "node:module";
export const TOPICS = [
  "conflict",
  "diplomacy",
  "sanctions",
  "trade",
  "military",
  "energy",
  "international_agreements",
  "humanitarian",
  "other",
];
const rules: Record<string, RegExp> = {
  conflict:
    /\b(wars?|warfare|conflicts?|ceasefires?|airstrikes?|attacks?|fighting|truce|invasion|drone strikes?|shelling|bombardment)\b/i,
  diplomacy:
    /\b(diploma\w*|summit|ambassador|negotiat\w*|bilateral|foreign minister|UN Security Council|United Nations|envoys?|peace talks?|international relations)\b/i,
  sanctions: /\b(sanctions?|blacklist\w*|asset freez\w*)\b/i,
  trade: /\b(trade|tariffs?|exports?|imports?|supply chain)\b/i,
  military: /\b(military|defen[cs]e|troops?|missiles?|NATO|armed forces)\b/i,
  energy: /\b(energy|oil|gas|nuclear|pipeline|OPEC|renewable)\b/i,
  international_agreements: /\b(treaty|agreement|accord|pact|memorandum)\b/i,
  humanitarian:
    /\b(humanitarian|refugees?|displaced|famine|hunger|food shortages?|aid workers|relief|asylum)\b/i,
};
const countries = createRequire(import.meta.url)("world-countries") as {
  cca2: string;
  name: { common: string; official: string };
  region: string;
  subregion: string;
}[];
const aliases: Record<string, string[]> = {
  GB: ["Britain", "British", "UK"],
  FR: ["French"],
  DE: ["German"],
  CA: ["Canadian"],
  AU: ["Australian"],
  MX: ["Mexican"],
  CU: ["Cuban"],
  CZ: ["Czech"],
  JP: ["Japanese"],
  ET: ["Ethiopian"],
  SA: ["Saudi"],
  EG: ["Egyptian"],
  SO: ["Somali"],
  US: ["United States", "American", "U.S."],
  RU: ["Russian"],
  CN: ["Chinese"],
  IL: ["Israeli"],
  PS: ["Palestinian", "Gaza", "West Bank"],
  UA: ["Ukrainian"],
  IR: ["Iranian"],
  SD: ["Sudanese"],
  KR: ["South Korean"],
  KP: ["North Korean"],
  SY: ["Syrian"],
  BR: ["Brazilian"],
  VE: ["Venezuelan"],
};
const region = (c: (typeof countries)[number]) =>
  c.cca2 === "IR"
    ? "Middle East"
    : c.region === "Africa"
      ? "Africa"
      : c.region === "Europe"
        ? "Europe"
        : c.subregion === "Western Asia"
          ? "Middle East"
          : ["US", "CA", "GL", "BM", "PM"].includes(c.cca2)
            ? "North America"
            : c.region === "Americas"
              ? "Latin America"
              : ["Asia", "Oceania"].includes(c.region)
                ? "Asia-Pacific"
                : "Unknown";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = countries.map((c) => ({
  code: c.cca2,
  region: region(c),
  pattern: new RegExp(
    "(?<![\\p{L}])(?:" +
      [c.name.common, ...(aliases[c.cca2] ?? [])].map(esc).join("|") +
      ")(?![\\p{L}])",
    "iu",
  ),
}));
export function collectionHints(
  title: string,
  description: string,
  tags: string[] = [],
) {
  const text = [title, description, ...tags]
    .join(" ")
    .replace(/\bUS\b/g, "United States")
    .replace(/\bU\.S\./g, "United States");
  let topics = Object.entries(rules)
    .filter(([, rule]) => rule.test(text))
    .map(([topic]) => topic);
  const noEnergyContext = text.replace(
    /tear gas|energy of (?:the )?(?:music|crowd|performer)/gi,
    "",
  );
  if (
    !rules.energy.test(noEnergyContext) ||
    (/Afrobeats|hypemen|music|singer/i.test(title) &&
      !/(?:oil|natural gas|pipeline|energy policy)/i.test(title))
  )
    topics = topics.filter((t) => t !== "energy");
  if (
    /co-pilot|axe blows|school attacker|sexual assault/i.test(title) &&
    !/war|military|missile|drone/i.test(title)
  )
    topics = topics.filter((t) => t !== "conflict");
  const matched = patterns.filter((c) => c.pattern.test(text));
  const regions = [...new Set(matched.map((c) => c.region))];
  if (/\b(middle east)\b/i.test(text)) regions.push("Middle East");
  if (/\b(africa|african)\b/i.test(text)) regions.push("Africa");
  if (/\b(latin america|latin american|caribbean)\b/i.test(text))
    regions.push("Latin America");
  if (/\b(europe|European Union)\b/i.test(text)) regions.push("Europe");
  if (/\b(asia|pacific)\b/i.test(text)) regions.push("Asia-Pacific");
  const geopolitical = topics.length > 0 || matched.length > 1;
  return {
    topics: topics.length ? topics : ["other"],
    regions: [...new Set(regions.length ? regions : ["Unknown"])],
    countryMentions: matched.map((c) => c.code),
    priorityScore: Math.max(
      0,
      topics.length * 10 +
        Math.min(matched.length, 5) * 3 -
        (/football|soccer|cricket|Afrobeats|museum|tourism|singer|Premier League/i.test(
          title,
        )
          ? 20
          : 0),
    ),
    relevanceHint: geopolitical ? "international_hint" : "unclassified",
    hintVersion: "keywords/1.1",
    basis:
      "Title, feed description and tags only; country mentions are not event participants or relationships",
  };
}
