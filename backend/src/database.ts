import { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
export function createDatabase(config: Pick<Config,'DATABASE_URL'>) {
  return new PrismaClient({datasources:{db:{url:config.DATABASE_URL}}});
}
export const eventInclude = { participants:true, relationships:true, evidence:true, sources:{include:{article:{select:{id:true,source:true,url:true,publishedAt:true,primarySourceId:true}}}}, decisions:{orderBy:{createdAt:'asc' as const}} };
