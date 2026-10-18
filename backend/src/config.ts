import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
dotenv({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
const schema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.string().default("development"),
  ADMIN_API_TOKEN: z.string().default(""),
  COLLECTION_AUTO_ENABLED: z.enum(["true", "false"]).default("false"),
  COLLECTION_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(10)
    .max(1440)
    .default(30),
  COLLECTION_REQUEST_BUDGET: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(150),
  COLLECTION_MAX_ARTICLES: z.coerce
    .number()
    .int()
    .min(1)
    .max(2000)
    .default(200),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const result = schema.parse(env);
  if (
    (result.NODE_ENV !== "development" ||
      !["127.0.0.1", "::1", "localhost"].includes(result.HOST)) &&
    result.ADMIN_API_TOKEN.length < 32
  )
    throw new Error("Network mode requires ADMIN_API_TOKEN (32 characters)");
  return result;
}
