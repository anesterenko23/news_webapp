import { loadConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { createApp } from "./app.js";
const config = loadConfig(),
  db = createDatabase(config),
  app = createApp(config, db);
await db.$connect();
await app.listen({ host: config.HOST, port: config.PORT });
console.log(
  "World Lens News Collection: http://" +
    config.HOST +
    ":" +
    config.PORT +
    "/collection",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
