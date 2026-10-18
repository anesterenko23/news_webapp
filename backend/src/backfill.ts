import { revalidateStoredClaims } from './revalidation.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { backfillLegacy } from './legacy-migration.js';
const db=createDatabase(loadConfig());
try{console.log('Legacy migration: '+JSON.stringify({legacy:await backfillLegacy(db),validation:await revalidateStoredClaims(db)}));}finally{await db.$disconnect();}
