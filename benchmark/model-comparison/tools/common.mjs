import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse as parseEnv } from 'dotenv';
import { loadConfig } from '../../../backend/dist/config.js';
import { normalizeArticle } from '../../../backend/dist/normalization.js';
import { extractionRequest } from '../../../backend/dist/provider.js';
import { SYSTEM_PROMPT, PROMPT_VERSION } from '../../../backend/dist/prompt.js';
import { outputJsonSchema } from '../../../backend/dist/schemas.js';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO = path.resolve(ROOT, '../..');
export const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); await fs.rename(file + '.tmp', file); }
export function within(root, file) {
    const absolute = path.resolve(root, file), relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative))
        throw Error('Path escapes benchmark storage');
    return absolute;
}
export async function context() {
    const config = await readJson(path.join(ROOT, 'config.json')), dataset = await readJson(path.join(ROOT, 'dataset.json')), reprints = await readJson(path.join(ROOT, 'deduplication-cases.json'));
    if (config.promptVersion !== PROMPT_VERSION)
        throw Error('Prompt changed: create and approve a new benchmark series');
    if (config.datasetVersion !== dataset.version)
        throw Error('Dataset version mismatch');
    const env = parseEnv(await fs.readFile(path.join(REPO, 'backend/.env'), 'utf8').catch(() => ''));
    const articles = [];
    for (const record of dataset.articles) {
        const content = await fs.readFile(within(ROOT, record.contentFile), 'utf8');
        if (sha(content) !== record.contentSha256)
            throw Error('Corpus hash changed: ' + record.id);
        const article = { ...record.article, content };
        const n = normalizeArticle(article);
        articles.push({ ...record, article, input: { title: n.title, content: n.content, language: n.language, publishedAt: n.publishedAt.toISOString() } });
    }
    if (articles.length !== 100 || new Set(articles.map(a => a.id)).size !== 100 || new Set(articles.map(a => a.contentSha256)).size !== 100)
        throw Error('Expected 100 distinct publications');
    if (config.consistencyArticleIds.length !== 20 || new Set(config.consistencyArticleIds).size !== 20)
        throw Error('Consistency requires 20 unique articles');
    const codeFiles = (await fs.readdir(path.join(REPO, 'backend/src'))).filter(n => n.endsWith('.ts')).sort();
    const codeHashes = {};
    for (const name of codeFiles)
        codeHashes[name] = sha(await fs.readFile(path.join(REPO, 'backend/src', name), 'utf8'));
    for (const name of (await fs.readdir(path.join(ROOT, 'tools'))).filter(n => n.endsWith('.mjs')).sort())
        codeHashes['benchmark/' + name] = sha(await fs.readFile(path.join(ROOT, 'tools', name), 'utf8'));
    for (const name of (await fs.readdir(path.join(REPO, 'backend/dist'))).filter(n => n.endsWith('.js')).sort())
        codeHashes['compiled/' + name] = sha(await fs.readFile(path.join(REPO, 'backend/dist', name), 'utf8'));
    const frozen = { runtime: { node: process.version, platform: process.platform, arch: process.arch, lockfileSha256: sha(await fs.readFile(path.join(REPO, 'package-lock.json'), 'utf8')) }, config, datasetSha256: sha(dataset), promptSha256: sha(SYSTEM_PROMPT), schemaSha256: sha(outputJsonSchema), codeHashes, reprintsSha256: sha(reprints) };
    return { config, dataset, articles, reprints: reprints.cases, env, frozen, planSha256: sha(frozen) };
}
export function modelConfig(ctx, model) { return loadConfig({ ...ctx.env, LLM_PROVIDER: model.provider, MISTRAL_MODEL: model.provider === 'mistral' ? model.modelId : 'ministral-8b-2512', GEMINI_MODEL: model.provider === 'gemini' ? model.modelId : 'gemini-3.8-flash', LLM_MAX_OUTPUT_TOKENS: String(ctx.config.maxOutputTokens), LLM_TIMEOUT_MS: String(ctx.config.timeoutMs), LLM_MAX_RETRIES: String(ctx.config.max429Retries), LLM_MONTHLY_BUDGET_USD: String(ctx.config.hardBudgetCapUsd), LLM_INPUT_USD_PER_MILLION: String(model.inputUsdPerMillion), LLM_OUTPUT_USD_PER_MILLION: String(model.outputUsdPerMillion), LLM_PRICING_VERIFIED_AT: model.pricingVerifiedAt, GEMINI_INPUT_USD_PER_MILLION: String(model.inputUsdPerMillion), GEMINI_OUTPUT_USD_PER_MILLION: String(model.outputUsdPerMillion), GEMINI_PRICING_VERIFIED_AT: model.pricingVerifiedAt }); }
const smoke = [{ id: 'SMOKE-MEETING', category: 'smoke', article: { title: 'France and Germany hold diplomatic talks', content: 'France and Germany held diplomatic talks. Both delegations discussed bilateral cooperation.', source: 'Fictional compatibility fixture, excluded from holdout', url: 'https://example.invalid/benchmark/smoke-meeting', publishedAt: '2026-01-01T00:00:00Z', language: 'en' } }, { id: 'SMOKE-CONTROL', category: 'smoke', article: { title: 'A description of clouds', content: 'This educational text describes clouds, rainfall and the water cycle. It reports no actions by countries.', source: 'Fictional compatibility fixture, excluded from holdout', url: 'https://example.invalid/benchmark/smoke-control', publishedAt: '2026-01-01T00:00:00Z', language: 'en' } }];
export function jobs(ctx) {
    const result = [];
    const add = (phase, record, repeat = 0) => {
        const order = result.length % 4 === 0 ? ctx.config.models : [...ctx.config.models].reverse();
        for (const model of order)
            result.push({ id: [phase, record.id, repeat, model.key].join('__'), phase, caseId: record.id, category: record.category, repeat, model: model.key, article: record.article, input: record.input ?? { title: record.article.title, content: record.article.content, language: record.article.language, publishedAt: record.article.publishedAt } });
    };
    smoke.forEach(r => add('smoke', r));
    ctx.articles.forEach(r => add('main', r));
    for (const id of ctx.config.consistencyArticleIds) {
        const r = ctx.articles.find(a => a.id === id);
        if (!r)
            throw Error('Missing consistency article ' + id);
        for (let repeat = 0; repeat < ctx.config.consistencyRepeats; repeat++)
            add('consistency', r, repeat);
    }
    for (const pair of ctx.reprints) {
        const original = ctx.articles.find(a => a.id === pair.sourceArticleId);
        const article = { ...original.article, title: original.article.title + pair.titleSuffix, source: pair.publisher, url: pair.url, lineageId: pair.lineageId };
        const n = normalizeArticle(article);
        add('deduplication', { id: pair.id, category: original.category, article, input: { title: n.title, content: n.content, language: n.language, publishedAt: n.publishedAt.toISOString() } });
    }
    return result;
}
export function requestEstimate(ctx, job) { const model = ctx.config.models.find(m => m.key === job.model); const config = modelConfig(ctx, model); const request = extractionRequest(job.input, config, ctx.config.promptVersion); const maxInput = Buffer.byteLength(request.body) + 4096; const upper = (maxInput * model.inputUsdPerMillion + ctx.config.maxOutputTokens * model.outputUsdPerMillion) / 1e6; const assumedInput = Math.ceil(request.body.length / 4), assumedOutput = job.model === 'gemini' ? 3000 : 2000; return { bodySha256: sha(request.body), maxInputTokenReservation: maxInput, upperUsd: upper, scenarioUsd: (assumedInput * model.inputUsdPerMillion + assumedOutput * model.outputUsdPerMillion) / 1e6 }; }
export async function plan(ctx) { const list = jobs(ctx), estimates = list.map(j => ({ ...j, estimate: requestEstimate(ctx, j) })); const byModel = ctx.config.models.map(model => { const selected = estimates.filter(j => j.model === model.key); return { model: model.modelId, logicalRequests: selected.length, upperReservationUsd: selected.reduce((s, j) => s + j.estimate.upperUsd, 0), illustrativeScenarioUsd: selected.reduce((s, j) => s + j.estimate.scenarioUsd, 0) }; }); const labels = await readJson(path.join(ROOT, 'ground-truth.json')); return { status: 'dry_run_no_generation_requests', createdAt: new Date().toISOString(), planSha256: ctx.planSha256, frozen: ctx.frozen, phases: Object.fromEntries(['smoke', 'main', 'consistency', 'deduplication'].map(p => [p, list.filter(j => j.phase === p).length])), logicalRequests: list.length, maxHttpAttempts: list.length * (1 + ctx.config.max429Retries), retryPolicy: 'Only explicit HTTP429, bounded exponential backoff; ambiguous 5xx/timeouts stop until reconciliation. All attempts retained.', models: byModel, totalIllustrativeScenarioUsd: byModel.reduce((s, m) => s + m.illustrativeScenarioUsd, 0), firstAttemptConservativeUpperUsd: byModel.reduce((s, m) => s + m.upperReservationUsd, 0), hardBudgetCapUsd: ctx.config.hardBudgetCapUsd, keyPresence: { ministral: !!ctx.env.MISTRAL_API_KEY, gemini: !!ctx.env.GEMINI_API_KEY }, manualLabels: { approved: labels.articles.filter(a => a.review.status === 'adjudicated').length, total: labels.articles.length, status: labels.status }, scope: 'No paid calls in this command. No production DB connection or provider change.', costNotice: 'Scenario is a planning assumption (body chars/4 input; Mistral2000 output, Gemini3000 including thoughts), not measured cost. Upper uses UTF8 bytes+4096 input and full6000 output. No free tier/cache discounts assumed.', jobs: estimates.map(({ article, input, ...j }) => j) }; }
export async function isolatedDatabase(file) {
    const { PrismaClient } = await import('@prisma/client');
    const absolute = within(path.join(ROOT, 'state'), path.relative(path.join(ROOT, 'state'), file));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + absolute.replaceAll('\\', '/') } } });
    const exists = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='ProcessingRun'");
    if (!exists.length) {
        const migrations = path.join(REPO, 'backend/prisma/migrations');
        for (const directory of (await fs.readdir(migrations, { withFileTypes: true })).filter(d => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
            const sql = await fs.readFile(path.join(migrations, directory.name, 'migration.sql'), 'utf8');
            for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean))
                await db.$executeRawUnsafe(statement);
        }
    }
    return db;
}
export function stageDatabaseName(job) { return job.phase === 'main' || job.phase === 'deduplication' ? 'main-' + job.model : job.phase === 'consistency' ? 'consistency-' + job.model + '-' + job.repeat : 'smoke-' + job.model; }
