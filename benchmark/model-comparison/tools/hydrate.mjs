import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson, within, sha } from './common.mjs';
// Fixed, reviewed manifest only. Not RSS, a crawler, a scheduler, or production ingestion.
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
export function sourceText(html) { return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/tr)\s*[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => key[0] === '#' ? String.fromCodePoint(parseInt(key.slice(key[1].toLowerCase() === 'x' ? 2 : 1), key[1].toLowerCase() === 'x' ? 16 : 10)) : entities[key] ?? all).replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
export async function hydrate() {
    if (!process.argv.includes('--fetch-sources'))
        throw Error('Explicit --fetch-sources required; no retrieval during tests/startup.');
    const dataset = await readJson(path.join(ROOT, 'dataset.json'));
    for (const article of dataset.articles) {
        const file = within(ROOT, article.contentFile);
        try {
            if (sha(await fs.readFile(file, 'utf8')) === article.contentSha256)
                continue;
            throw Error('Existing corpus was modified; refusing replacement');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const url = new URL(article.provenance.apiUrl);
        if (url.origin !== 'https://www.gov.uk' || !url.pathname.startsWith('/api/content/'))
            throw Error('Unexpected source origin');
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok)
            throw Error('Source unavailable ' + article.id + ':HTTP' + response.status);
        const data = await response.json(), html = data.details?.body;
        if (typeof html !== 'string' || sha(html) !== article.provenance.sourceHtmlSha256)
            throw Error('Source updated since freeze ' + article.id + '; use the archived annotation package, do not silently replace benchmark text.');
        const text = sourceText(html);
        if (sha(text) !== article.contentSha256)
            throw Error('Text extraction drift ' + article.id);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
        console.log(article.id + ' restored');
    }
    for (const name of ['ground-truth', 'adjudication'])
        try {
            await fs.access(path.join(ROOT, name + '.json'));
        }
        catch {
            await fs.copyFile(path.join(ROOT, name + '.template.json'), path.join(ROOT, name + '.json'));
        }
}
if (process.argv.includes('--fetch-sources'))
    await hydrate();
