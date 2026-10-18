import path from 'node:path';
import { context, plan, writeJson, ROOT } from './common.mjs';
const ctx = await context(), report = await plan(ctx);
await writeJson(path.join(ROOT, 'dry-run.json'), report);
const { jobs, frozen, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
