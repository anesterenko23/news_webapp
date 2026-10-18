import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { context, jobs, requestEstimate, modelConfig, isolatedDatabase, stageDatabaseName, readJson, writeJson, ROOT, sha } from './common.mjs';
import { IntelligenceEngine } from '../../../backend/dist/engine.js';
import { Extraction } from '../../../backend/dist/schemas.js';
import { pricing } from '../../../backend/dist/config.js';
export function requireApproval(args, ctx) {
    if (args.some(a => a !== '--paid' && !/^--approve-budget=/.test(a) && !/^--plan=/.test(a) && !['--phase=all', '--phase=smoke'].includes(a)))
        throw Error('Unknown run option');
    const budget = Number(args.find(a => a.startsWith('--approve-budget='))?.split('=')[1]);
    const digest = args.find(a => a.startsWith('--plan='))?.split('=')[1];
    if (!args.includes('--paid') || !Number.isFinite(budget) || budget <= 0 || digest !== ctx.planSha256)
        throw Error('No matching explicit budget/run approval. Use the reviewed dry-run plan SHA and --paid --approve-budget=USD only after human confirmation.');
    if (budget > ctx.config.hardBudgetCapUsd)
        throw Error('Approved budget exceeds configurable hard cap; create/review a new plan before changing it.');
    return budget;
}
export async function spent(directory) { const files = (await fs.readdir(directory).catch(() => [])).filter(n => n.endsWith('.attempt.json')); const attempts = await Promise.all(files.map(n => readJson(path.join(directory, n)))); return { attempts, total: attempts.reduce((s, a) => s + (a.estimatedCostUsd ?? a.reservedUsd), 0), uncertain: attempts.some(a => ['reserved', 'uncertain'].includes(a.status)) }; }
export function usageFrom(provider, payload) {
    if (provider === 'gemini') {
        const u = payload?.usageMetadata;
        if (!Number.isInteger(u?.promptTokenCount) || !Number.isInteger(u?.candidatesTokenCount))
            return null;
        return { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0), totalTokens: u.totalTokenCount ?? null, providerReported: u };
    }
    const u = payload?.usage;
    if (!Number.isInteger(u?.prompt_tokens) || !Number.isInteger(u?.completion_tokens))
        return null;
    return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens ?? u.prompt_tokens + u.completion_tokens, providerReported: u };
}
function redact(value, secrets) {
    let text = JSON.stringify(value);
    for (const secret of secrets.filter(Boolean))
        text = text.replaceAll(secret, '[REDACTED]');
    return JSON.parse(text);
}
export async function run(args) {
    if (!args.includes('--paid'))
        throw Error('No explicit paid run approval. Run compare:dry first; no API request sent.');
    const ctx = await context(), cap = requireApproval(args, ctx);
    for (const model of ctx.config.models) {
        const cfg = modelConfig(ctx, model);
        pricing(cfg);
        if (!(model.provider === 'mistral' ? cfg.MISTRAL_API_KEY : cfg.GEMINI_API_KEY))
            throw Error('Missing key for ' + model.key);
    }
    const directory = path.join(ROOT, 'state', ctx.planSha256);
    await fs.mkdir(directory, { recursive: true });
    const lockPath = path.join(ROOT, 'state/run.lock');
    const lock = await fs.open(lockPath, 'wx').catch(() => { throw Error('Another runner or an interrupted run holds state/run.lock. Inspect before removing; no automatic takeover.'); });
    await lock.writeFile(JSON.stringify({ pid: process.pid, plan: ctx.planSha256, at: new Date().toISOString() }));
    const dbs = new Map(), secrets = [ctx.env.MISTRAL_API_KEY, ctx.env.GEMINI_API_KEY, ctx.env.ADMIN_API_TOKEN];
    const selected = jobs(ctx).filter(j => !args.includes('--phase=smoke') || j.phase === 'smoke');
    try {
        await writeJson(path.join(directory, 'approved-plan.json'), { planSha256: ctx.planSha256, approvedBudgetUsd: cap, startedAt: new Date().toISOString(), scope: args.includes('--phase=smoke') ? 'smoke_only' : 'all', frozen: ctx.frozen });
        const available = [];
        for (const model of ctx.config.models) {
            const url = model.provider === 'mistral' ? 'https://api.mistral.ai/v1/models' : 'https://generativelanguage.googleapis.com/v1beta/models/' + model.modelId;
            const response = await fetch(url, { headers: model.provider === 'mistral' ? { Authorization: 'Bearer ' + ctx.env.MISTRAL_API_KEY } : { 'x-goog-api-key': ctx.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(30000) });
            let payload;
            try {
                payload = await response.json();
            }
            catch { }
            const definition = model.provider === 'mistral' ? payload?.data?.find(m => m.id === model.modelId) : payload;
            available.push({ model: model.modelId, status: response.status, definition: response.ok ? definition : null });
            if (!response.ok || !definition || model.provider === 'gemini' && definition.name !== 'models/' + model.modelId)
                throw Error('Model metadata preflight failed; no generation attempted for this run');
        }
        await writeJson(path.join(directory, 'metadata-preflight-' + Date.now() + '.json'), redact({ at: new Date().toISOString(), models: available }, secrets));
        for (const job of selected) {
            const finalPath = path.join(directory, job.id + '.result.json');
            if (await fs.access(finalPath).then(() => true, () => false))
                continue;
            if ((await fs.readdir(directory)).some(n => n.startsWith(job.id + '__') && n.endsWith('.attempt.json')))
                throw Error('Interrupted job has HTTP history but no final result: ' + job.id + '. Recover saved response offline; never pay again automatically.');
            if (job.phase !== 'smoke')
                for (const smoke of jobs(ctx).filter(j => j.phase === 'smoke')) {
                    const result = await readJson(path.join(directory, smoke.id + '.result.json'));
                    if (!result.smokeCompatible)
                        throw Error('Compatibility smoke failed. Main run is blocked; configuration fixes require a new frozen series.');
                }
            const budget = await spent(directory);
            if (budget.uncertain)
                throw Error('Uncertain/reserved benchmark request: reconcile provider usage before resuming. Production reservations are not touched.');
            if (budget.total + requestEstimate(ctx, job).upperUsd > cap)
                throw Error('BENCHMARK_BUDGET_CAP: cannot reserve next request');
            const model = ctx.config.models.find(m => m.key === job.model), cfg = modelConfig(ctx, model), dbName = stageDatabaseName(job);
            if (!dbs.has(dbName))
                dbs.set(dbName, await isolatedDatabase(path.join(directory, 'db', dbName + '.db')));
            const db = dbs.get(dbName);
            let attempt = 0;
            const capture = async (url, options) => {
                const reservedUsd = ((Buffer.byteLength(options.body) + 4096) * model.inputUsdPerMillion + ctx.config.maxOutputTokens * model.outputUsdPerMillion) / 1e6;
                const ledger = await spent(directory);
                if (ledger.uncertain || ledger.total + reservedUsd > cap)
                    throw Error('BENCHMARK_BUDGET_CAP');
                const requestId = job.id + '__' + String(++attempt).padStart(2, '0'), file = path.join(directory, requestId + '.attempt.json'), started = Date.now();
                const entry = { requestId, jobId: job.id, phase: job.phase, model: job.model, configuredModelId: model.modelId, status: 'reserved', reservedUsd, startedAt: new Date().toISOString(), request: { url, method: 'POST', body: JSON.parse(options.body), bodySha256: sha(options.body) }, response: null, usage: null, estimatedCostUsd: null };
                await writeJson(file, redact(entry, secrets));
                try {
                    const response = await fetch(url, options), raw = await response.clone().text();
                    let payload;
                    try {
                        payload = JSON.parse(raw);
                    }
                    catch { }
                    const usage = usageFrom(model.provider, payload), safeRejection = response.status >= 400 && response.status < 500;
                    const knownCost = usage ? (usage.inputTokens * model.inputUsdPerMillion + usage.outputTokens * model.outputUsdPerMillion) / 1e6 : null;
                    Object.assign(entry, { status: knownCost !== null ? 'completed' : safeRejection ? 'rejected' : 'uncertain', estimatedCostUsd: knownCost ?? (safeRejection ? 0 : null), durationMs: Date.now() - started, usage, response: { status: response.status, statusText: response.statusText, headers: Object.fromEntries([...response.headers].filter(([k]) => !/cookie|authorization/i.test(k))), body: payload ?? raw }, reportedModelId: payload?.model ?? payload?.modelVersion ?? null });
                    if (knownCost !== null && knownCost > reservedUsd)
                        entry.status = 'uncertain';
                    await writeJson(file, redact(entry, secrets));
                    return response;
                }
                catch (error) {
                    Object.assign(entry, { status: 'uncertain', durationMs: Date.now() - started, networkError: error.name + ': ' + error.message });
                    await writeJson(file, redact(entry, secrets));
                    throw error;
                }
            };
            const { MistralProvider, GeminiProvider } = await import('../../../backend/dist/provider.js');
            const recordedProvider = model.provider === 'gemini' ? new GeminiProvider(db, cfg, capture) : new MistralProvider(db, cfg, capture);
            const started = Date.now();
            const output = await new IntelligenceEngine(db, cfg, recordedProvider).process(job.article, undefined, ctx.config.promptVersion);
            if (output.cached)
                throw Error('Unexpected application cache hit: refusing to count as a fresh benchmark generation');
            let parsed = null, jsonValid = false;
            try {
                if (typeof output.rawOutput === 'string') {
                    parsed = JSON.parse(output.rawOutput);
                    jsonValid = true;
                }
            }
            catch { }
            ;
            const attempts = (await spent(directory)).attempts.filter(a => a.jobId === job.id);
            const reported = attempts.map(a => a.reportedModelId).filter(Boolean);
            const modelMismatch = reported.some(id => id !== model.modelId);
            const result = redact({ jobId: job.id, phase: job.phase, caseId: job.caseId, category: job.category, repeat: job.repeat, model: job.model, configuredModelId: model.modelId, reportedModelIds: reported, modelMismatch, planSha256: ctx.planSha256, input: job.input, article: job.article, completedAt: new Date().toISOString(), wallLatencyMs: Date.now() - started, attemptIds: attempts.map(a => a.requestId), retryCount: Math.max(0, attempts.length - 1), raw: { text: output.rawOutput, jsonValid, schemaValid: Extraction.safeParse(parsed).success, events: Array.isArray(parsed?.events) ? parsed.events : null }, pipeline: output, smokeCompatible: !modelMismatch && output.processingStatus === 'completed' && Extraction.safeParse(parsed).success }, secrets);
            await writeJson(finalPath, result);
            console.log(JSON.stringify({ jobId: job.id, status: output.processingStatus, attempts: attempts.length, claims: output.claims.length, validClaims: output.claims.filter(c => c.validationStatus === 'Valid').length }));
            if (modelMismatch || attempts.some(a => a.status === 'uncertain') || attempts.some(a => a.response?.status === 400))
                throw Error('Stopped after provider/adapter uncertainty. Saved job is not repeated; inspect diagnostics.');
        }
    }
    finally {
        for (const db of dbs.values())
            await db.$disconnect();
        await lock.close();
        await fs.unlink(lockPath);
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await run(process.argv.slice(2));
}
