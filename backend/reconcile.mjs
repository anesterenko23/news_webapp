// Operator-only local CLI. Use ONLY after checking the provider usage/billing console.
import { loadConfig } from './dist/config.js';
import { createDatabase } from './dist/database.js';
const [requestId,input,output,cost,note]=process.argv.slice(2);
const inputTokens=Number(input),outputTokens=Number(output),estimatedCostUsd=Number(cost);
if (!requestId || !Number.isInteger(inputTokens) || inputTokens<0 || !Number.isInteger(outputTokens) || outputTokens<0 || !Number.isFinite(estimatedCostUsd) || estimatedCostUsd<0 || !note || note.length<8) throw new Error('Usage: node backend/reconcile.mjs REQUEST_ID INPUT_TOKENS OUTPUT_TOKENS CONFIRMED_COST_USD "Provider billing reconciliation note"');
const db=createDatabase(loadConfig());
try {
  await db.$transaction(async tx=> {
    const request=await tx.llmRequest.findUniqueOrThrow({where:{id:requestId},include:{run:true}});
    if (!['uncertain','reserved','pricing_exceeded'].includes(request.status)) throw new Error('Only unresolved requests can be reconciled');
    if(request.status==='reserved' && Date.now()-request.createdAt.getTime()<180000) throw new Error('Request may still be active; wait before reconciling');
    const audit={type:'operator_billing_reconciliation',requestId,at:new Date().toISOString(),previousStatus:request.status,previousCost:request.estimatedCostUsd,inputTokens,outputTokens,estimatedCostUsd,note};
    await tx.llmRequest.update({where:{id:requestId},data:{status:'reconciled',inputTokens,outputTokens,estimatedCostUsd}});
    await tx.processingRun.update({where:{id:request.runId},data:{warnings:JSON.stringify([...JSON.parse(request.run.warnings),audit]),...(request.run.status==='processing'?{status:'failed',error:'RECOVERED_INTERRUPTED_RUN: billing reconciled; explicit retry is available',finishedAt:new Date()}: {})}});
  });
  console.log('Provider usage reconciled and audit note saved. No model request was sent.');
} finally { await db.$disconnect(); }
