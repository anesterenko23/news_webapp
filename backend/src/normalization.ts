import { createHash } from 'node:crypto';
import { ArticleInput, type ArticleInputType } from './schemas.js';
export function normalizeArticle(raw: unknown) {
  const input = ArticleInput.parse(raw);
  const url = new URL(input.url);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('Article URL must be HTTP(S) without credentials');
  url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const seen = new Set<string>();
  const clean = (value: string) => value.normalize('NFC').replace(/\r\n?/g,'\n').split('\n').map(line => line.replace(/[\t ]+/g,' ').trim()).filter(line => {
    if (!line) return true;
    if (!/^(advertisement|subscribe|share this article|cookie preferences)$/i.test(line)) return true;
    if (seen.has(line.toLowerCase())) return false; seen.add(line.toLowerCase()); return true;
  }).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  const title = clean(input.title), content = clean(input.content);
  const language = input.language ?? detectLanguage(content);
  const contentFingerprint = createHash('sha256').update(content.normalize('NFKC').replace(/\s+/g,' ').trim()).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify([url.href,title,content])).digest('hex');
  return { ...input, title, content, language, publishedAt: new Date(input.publishedAt), canonicalUrl: url.href, fingerprint, contentFingerprint, normalizedText: `${title}\n${content}`, originalJson: JSON.stringify(raw) };
}
export function detectLanguage(text: string) {
  // Conservative script/function-word heuristic; uncertain languages remain undetermined.
  if (/[іїєґ]/i.test(text)) return 'uk';
  if ((text.match(/[а-яё]/gi)?.length ?? 0) > text.length * .25) return 'ru';
  if ((text.match(/[\u4e00-\u9fff]/g)?.length ?? 0) > text.length * .25) return 'zh';
  if (/\b(the|and|announced|against|with)\b/i.test(text)) return 'en';
  return 'und';
}
export function originalText(input: Pick<ArticleInputType,'title'|'content'>) { return `${input.title}\n${input.content}`; }
