
import "dotenv/config";

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import prisma from "./lib/prisma.js";

const env = parseEnv(process.env);
const corsOrigins =
  env.CORS_ORIGINS.length > 0
    ? env.CORS_ORIGINS
    : env.NODE_ENV === "development"
      ? [
          "http://localhost:8081",
          "http://localhost:8082",
          "http://localhost:19006",
          "http://localhost:3000",
          "http://127.0.0.1:8081",
          "http://127.0.0.1:8082",
          "http://127.0.0.1:19006",
          "http://127.0.0.1:3000",
        ]
      : [];
const app = createApp({
  prisma,
  authConfig: {
    accessTokenSecret: env.JWT_ACCESS_SECRET,
  },
  corsOrigins,
});

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
  hostname: "0.0.0.0",
});

console.info(`Seroo API listening on port ${env.PORT}`);

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.info(`Received ${signal}; shutting down.`);

  server.close(async (error) => {
    if (error) {
      console.error(
        "HTTP server shutdown failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      process.exitCode = 1;
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error(
        "Prisma client shutdown failed",
        disconnectError instanceof Error ? disconnectError.name : "UnknownError",
      );
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
