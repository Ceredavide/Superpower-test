import path from "node:path";
import { createServer } from "node:http";

import { createApp } from "./app/create-app";
import { prisma } from "./core/db";
import { env } from "./core/env";
import { PrismaStore } from "./store/prisma-store";

const app = createApp({
  store: new PrismaStore(prisma),
  sessionCookieName: env.SESSION_COOKIE_NAME,
  sessionTtlDays: env.SESSION_TTL_DAYS,
  clientOrigin: env.CLIENT_ORIGIN,
  staticAssetsPath: path.resolve(process.cwd(), "../client/dist")
});

const server = createServer(app);

server.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

async function shutdown() {
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
