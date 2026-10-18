import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFile,readdir,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function testDatabase(){
 const path=fileURLToPath(new URL(`../.test-${randomUUID()}.db`,import.meta.url));const db=new PrismaClient({datasources:{db:{url:'file:'+path.replaceAll('\\','/')}}});
 const root=new URL('../prisma/migrations/',import.meta.url);
 for(const directory of (await readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){const sql=await readFile(new URL(directory.name+'/migration.sql',root),'utf8');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);}
 return {db,async clear(){for(const table of ['claimValidationDecision','claimEvidenceLink','claimRelationship','claimEvidence','claimParticipant','mergeCandidate','canonicalEventSource','eventRevision','verificationDecision','eventRelationship','canonicalParticipant','extractedClaim','canonicalEvent','reviewDecision','evidence','eventSource','relationship','eventParticipant','event','llmRequest','processingRun','article']as const)await db[table].deleteMany();},async close(){await db.$disconnect();for(const suffix of ['','-journal','-wal','-shm'])await unlink(path+suffix).catch(()=>{});}};
}
