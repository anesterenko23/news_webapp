import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { pricing, type Config } from './config.js';
import { outputJsonSchema as baselineJsonSchema } from './schemas-v1.js';
import { BASELINE_PROMPT, BASELINE_VERSION, PREVIOUS_PROMPT, PREVIOUS_VERSION } from './prompt.js';
import { outputJsonSchema } from './schemas.js';
import { SYSTEM_PROMPT } from './prompt.js';

export class EngineError extends Error {
  constructor(public code: string, message: string, public statusCode = 502, public raw?: string) { super(message); }
}
export interface LlmInput { title: string; content: string; language: string; publishedAt: string }
export interface Provider { extract(input: LlmInput, runId: string): Promise<string> }
const usageSchema = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class MistralProvider implements Provider {
  constructor(private db: PrismaClient, private config: Config, private fetcher: typeof fetch = fetch, private sleep = delay) {}
  async extract(input: LlmInput, runId: string) {
    if (!this.config.MISTRAL_API_KEY) throw new EngineError('MISSING_API_KEY','Set MISTRAL_API_KEY in backend/.env',503);
    let rates: ReturnType<typeof pricing>;
    try { rates = pricing(this.config); } catch { throw new EngineError('PRICING_UNCONFIRMED','Confirm current model rates and pricing date in backend/.env',503); }
    const run = await this.db.processingRun.findUniqueOrThrow({where:{id:runId}});
    const baseline = run.promptVersion === BASELINE_VERSION;
    const body = JSON.stringify({
      model: this.config.MISTRAL_MODEL, temperature: 0, max_tokens: this.config.LLM_MAX_OUTPUT_TOKENS,
      messages: [{ role:'system', content:baseline ? BASELINE_PROMPT : run.promptVersion===PREVIOUS_VERSION ? PREVIOUS_PROMPT : SYSTEM_PROMPT },{ role:'user', content:JSON.stringify(input) }],
      response_format: { type:'json_schema', json_schema:{ name:'news_extraction', strict:true, schema:baseline ? baselineJsonSchema : outputJsonSchema } },
    });
    // One token per UTF-8 byte is deliberately conservative; extra room covers protocol overhead.
    const maxInput = Buffer.byteLength(body,'utf8') + 4096;
    const reserve = (maxInput * rates.input + this.config.LLM_MAX_OUTPUT_TOKENS * rates.output) / 1_000_000;
    for (let attempt = 0; attempt <= this.config.LLM_MAX_RETRIES; attempt++) {
      const month = new Date().toISOString().slice(0,7);
      const request = await this.db.$transaction(async tx => {
        const uncertain = await tx.llmRequest.count({ where:{ status:{in:['uncertain','pricing_exceeded']} } });
        const stale = await tx.llmRequest.count({ where:{status:'reserved',createdAt:{lt:new Date(Date.now()-this.config.LLM_TIMEOUT_MS-60000)}} });
        if (uncertain || stale) throw new EngineError('USAGE_UNCERTAIN','Reconcile uncertain/pending provider charges before sending more requests',503);
        const total = await tx.llmRequest.aggregate({where:{month},_sum:{estimatedCostUsd:true}});
        if ((total._sum.estimatedCostUsd ?? 0) + reserve > this.config.LLM_MONTHLY_BUDGET_USD) throw new EngineError('BUDGET_EXCEEDED','Monthly budget cannot cover the next request reservation',429);
        return tx.llmRequest.create({data:{runId,model:this.config.MISTRAL_MODEL,month,estimatedCostUsd:reserve,inputRate:rates.input,outputRate:rates.output,pricingVerifiedAt:rates.verifiedAt}});
      });
      const started = Date.now();
      let response: Response;
      try {
        response = await this.fetcher('https://api.mistral.ai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${this.config.MISTRAL_API_KEY}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(this.config.LLM_TIMEOUT_MS)});
      } catch {
        await this.db.llmRequest.update({where:{id:request.id},data:{status:'uncertain',durationMs:Date.now()-started}});
        throw new EngineError('PROVIDER_CONNECTION','Provider connection failed or timed out; charge is uncertain. No automatic retry.',502);
      }
      if (!response.ok) {
        const safeRejection = response.status >= 400 && response.status < 500;
        await this.db.llmRequest.update({where:{id:request.id},data:{status:safeRejection ? `http_${response.status}` : 'uncertain',estimatedCostUsd:safeRejection ? 0 : reserve,durationMs:Date.now()-started}});
        await response.body?.cancel();
        if (response.status === 429 && attempt < this.config.LLM_MAX_RETRIES) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await this.sleep(Math.min(5000, Math.max(250 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
          continue;
        }
        throw new EngineError(`PROVIDER_HTTP_${response.status}`,`Mistral rejected or could not complete the request (HTTP ${response.status}).`,response.status === 429 ? 429 : 502);
      }
      let payload: Record<string, unknown>;
      try { payload = await response.json() as Record<string,unknown>; }
      catch {
        await this.db.llmRequest.update({where:{id:request.id},data:{status:'uncertain',durationMs:Date.now()-started}});
        throw new EngineError('INVALID_PROVIDER_RESPONSE','Provider returned unreadable JSON; usage is uncertain');
      }
      const usage = usageSchema.safeParse(payload.usage);
      const choices = payload.choices as {finish_reason?:string;message?:{content?:unknown}}[] | undefined;
      const raw = typeof choices?.[0]?.message?.content === 'string' ? choices[0].message.content : '';
      if (!usage.success) {
        await this.db.llmRequest.update({where:{id:request.id},data:{status:'uncertain',durationMs:Date.now()-started}});
        throw new EngineError('MISSING_USAGE','Provider omitted reliable token usage; further requests blocked until reconciliation',502,raw);
      }
      const cost = (usage.data.prompt_tokens * rates.input + usage.data.completion_tokens * rates.output) / 1_000_000;
      await this.db.llmRequest.update({where:{id:request.id},data:{status:cost > reserve ? 'pricing_exceeded' : 'completed',inputTokens:usage.data.prompt_tokens,outputTokens:usage.data.completion_tokens,estimatedCostUsd:cost,durationMs:Date.now()-started}});
      if (choices?.[0]?.finish_reason !== 'stop' || !raw) throw new EngineError('INCOMPLETE_OUTPUT','Model output is empty or incomplete; no automatic paid repair request',502,raw);
      return raw;
    }
    throw new EngineError('RETRIES_EXHAUSTED','Rate limit retries exhausted');
  }
}
