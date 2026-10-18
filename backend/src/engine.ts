import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { eventInclude } from './database.js';
import { normalizeArticle, originalText } from './normalization.js';
import { Extraction, type ArticleInputType } from './schemas.js';
import { PROMPT_VERSION } from './prompt.js';
import { EngineError, type Provider } from './provider.js';
import { validateEvidence } from './validation.js';
import { findDuplicates } from './deduplication.js';
import { publicationDecision } from './verification.js';

export class IntelligenceEngine {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private db: PrismaClient, private config: Config, private provider: Provider) {}
  process(raw: unknown, retryOf?: string) {
    const normalized = normalizeArticle(raw);
    // Bound the work queue; the API also limits concurrent ingestion requests.
    const result = this.tail.then(() => this.processOne(raw,normalized,retryOf));
    this.tail = result.catch(() => {});
    return result;
  }
  private async result(runId: string, cached = false) {
    const run = await this.db.processingRun.findUniqueOrThrow({where:{id:runId},include:{events:{include:eventInclude},requests:true}});
    return { articleId:run.articleId, runId:run.id, processingStatus:run.status, cached, events:run.events, warnings:JSON.parse(run.warnings), error:run.error, rawOutput:run.rawOutput, model:run.model, promptVersion:run.promptVersion, durationMs:run.durationMs,
      usage:{requests:run.requests.length,inputTokens:run.requests.reduce((n,r)=>n+r.inputTokens,0),outputTokens:run.requests.reduce((n,r)=>n+r.outputTokens,0),estimatedCostUsd:run.requests.reduce((n,r)=>n+r.estimatedCostUsd,0),uncertain:run.requests.some(r=>['uncertain','reserved','pricing_exceeded'].includes(r.status))} };
  }
  private async processOne(raw: unknown, normalized: ReturnType<typeof normalizeArticle>, retryOf?: string) {
    const article = await this.db.article.upsert({where:{fingerprint:normalized.fingerprint},update:{},create:{fingerprint:normalized.fingerprint,title:normalized.title,content:(raw as ArticleInputType).content,source:normalized.source,url:normalized.url,canonicalUrl:normalized.canonicalUrl,publishedAt:normalized.publishedAt,language:normalized.language,primarySourceId:normalized.primarySourceId,normalizedText:normalized.normalizedText,originalJson:JSON.stringify(raw)}});
    let attempt = 0;
    if (retryOf) {
      const failed = await this.db.processingRun.findUnique({where:{id:retryOf}});
      if (!failed || failed.articleId !== article.id || failed.status !== 'failed' || failed.model !== this.config.MISTRAL_MODEL || failed.promptVersion !== PROMPT_VERSION) throw new EngineError('INVALID_RETRY','Only a matching failed run can be explicitly retried',400);
      attempt = failed.attempt + 1;
    }
    const identity = {articleId:article.id,model:this.config.MISTRAL_MODEL,promptVersion:PROMPT_VERSION,attempt};
    const previous = await this.db.processingRun.findFirst({where:retryOf ? identity : {articleId:article.id,model:this.config.MISTRAL_MODEL,promptVersion:PROMPT_VERSION},orderBy:{attempt:'desc'}});
    if (previous) return this.result(previous.id,true);
    let run;
    try { run = await this.db.processingRun.create({data:{...identity,retryOf}}); }
    catch { const raced = await this.db.processingRun.findFirst({where:identity}); if (raced) return this.result(raced.id,true); throw new EngineError('DATABASE_BUSY','Could not claim article processing',503); }
    const started = Date.now();
    let rawOutput: string | undefined;
    try {
      rawOutput = await this.provider.extract({title:normalized.title,content:normalized.content,language:normalized.language,publishedAt:normalized.publishedAt.toISOString()},run.id);
      let parsed: unknown;
      try { parsed = JSON.parse(rawOutput); } catch { throw new EngineError('INVALID_MODEL_JSON','Model output is not valid JSON'); }
      const validated = Extraction.safeParse(parsed);
      if (!validated.success) throw new EngineError('INVALID_MODEL_SCHEMA',`Model output failed structural validation: ${validated.error.issues.slice(0,8).map(issue=>issue.path.join('.')+': '+issue.message).join('; ')}`);
      const window = (timestamp: number) => ({gte:new Date(timestamp-3*86400000),lte:new Date(timestamp+3*86400000)});
      const records = await this.db.event.findMany({where:{OR:[{publishedAt:window(normalized.publishedAt.getTime())},...validated.data.events.filter(event=>event.occurred_at).map(event=>({occurredAt:window(Date.parse(event.occurred_at!))})),...(normalized.primarySourceId ? [{sources:{some:{article:{primarySourceId:normalized.primarySourceId}}}}] : [])],publicationStatus:{not:'Rejected'}},include:{participants:true,sources:{include:{article:{select:{primarySourceId:true}}}}},take:1000,orderBy:{createdAt:'desc'}});
      await this.db.$transaction(async tx => {
        const withinRun: typeof records = [];
        for (const event of validated.data.events) {
          const checks = validateEvidence(event,originalText(raw as ArticleInputType));
          const duplicates = findDuplicates(event,normalized.publishedAt,normalized.primarySourceId,[...records,...withinRun]);
          const decision = publicationDecision(checks.rejected,duplicates);
          const saved = await tx.event.create({data:{runId:run.id,title:event.title,summary:event.summary,eventType:event.event_type,eventStatus:event.event_status,occurredAt:event.occurred_at ? new Date(event.occurred_at) : null,publishedAt:normalized.publishedAt,confidence:event.confidence,verificationStatus:decision.verificationStatus,publicationStatus:decision.publicationStatus,warnings:JSON.stringify([...checks.warnings,decision.reason]),duplicateCandidates:JSON.stringify(duplicates),participants:{create:event.countries.map(country=>({countryCode:country.code,role:country.role}))},relationships:{create:event.relationships.map(link=>({sourceCountry:link.source_country,targetCountry:link.target_country,type:link.type,direction:link.direction,confidence:link.confidence,evidenceRefs:JSON.stringify(link.evidence_refs)}))},evidence:{create:checks.evidence.map(item=>({...item,articleId:article.id}))},sources:{create:{articleId:article.id}},decisions:{create:{reviewer:'system:verification-v1',decision:decision.publicationStatus,note:decision.reason}}},include:{participants:true,sources:{include:{article:{select:{primarySourceId:true}}}}}});
          withinRun.push(saved);
        }
        await tx.processingRun.update({where:{id:run.id},data:{status:'completed',rawOutput,warnings:JSON.stringify([...validated.data.diagnostics,...(!validated.data.events.length?['No supported events extracted']:[])]),durationMs:Date.now()-started,finishedAt:new Date()}});
      });
    } catch (error) {
      const safe = error instanceof EngineError ? `${error.code}: ${error.message}` : 'PROCESSING_FAILED: Processing could not complete; inspect database connectivity or configuration';
      await this.db.processingRun.update({where:{id:run.id},data:{status:'failed',error:safe,rawOutput:rawOutput ?? (error instanceof EngineError ? error.raw : undefined),warnings:JSON.stringify([safe]),durationMs:Date.now()-started,finishedAt:new Date()}});
    }
    return this.result(run.id);
  }
}
