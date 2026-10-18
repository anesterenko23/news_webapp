import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const numeric = (fallback: number, min: number, max: number) => z.coerce.number().finite().min(min).max(max).default(fallback);
const schema = z.object({
  MISTRAL_API_KEY: z.string().default(''), MISTRAL_MODEL: z.string().min(1).default('ministral-8b-2512'),
  LLM_PROVIDER: z.literal('mistral').default('mistral'),
  LLM_MAX_OUTPUT_TOKENS: numeric(2000, 128, 8000).pipe(z.number().int()),
  LLM_TIMEOUT_MS: numeric(30000, 100, 120000).pipe(z.number().int()),
  LLM_MAX_RETRIES: numeric(2, 0, 4).pipe(z.number().int()), LLM_MONTHLY_BUDGET_USD: numeric(10, 0, 1000),
  LLM_INPUT_USD_PER_MILLION: z.coerce.number().positive().optional(), LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  LLM_PRICING_VERIFIED_AT: z.string().optional(), DATABASE_URL: z.string().default('file:./dev.db'),
  HOST: z.string().default('127.0.0.1'), PORT: numeric(3001, 1, 65535), NODE_ENV: z.string().default('development'),
  ADMIN_API_TOKEN: z.string().default(''),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.parse(env);
  if ((result.NODE_ENV !== 'development' || !['127.0.0.1','::1','localhost'].includes(result.HOST)) && result.ADMIN_API_TOKEN.length < 32) throw new Error('Network/production mode requires ADMIN_API_TOKEN with at least 32 characters');
  return result;
}
export function pricing(config: Config, now = new Date()) {
  const builtIn = config.MISTRAL_MODEL === 'ministral-8b-2512';
  const verifiedAt = config.LLM_PRICING_VERIFIED_AT ?? (builtIn ? '2026-10-18' : '');
  const input = config.LLM_INPUT_USD_PER_MILLION ?? (builtIn ? .15 : undefined);
  const output = config.LLM_OUTPUT_USD_PER_MILLION ?? (builtIn ? .15 : undefined);
  const age = now.getTime() - Date.parse(verifiedAt);
  if (!input || !output || !Number.isFinite(age) || age < -86400000 || age > 30 * 86400000) throw new Error('PRICING_UNCONFIRMED: verify model rates and LLM_PRICING_VERIFIED_AT before processing');
  return { input, output, verifiedAt };
}
