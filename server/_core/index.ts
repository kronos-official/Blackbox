import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startTelegramRuntime } from "../telegram/runtimeBootstrap";
import { registerTelegramRoutes } from "../telegram/routes";
import { registerTelegramScheduledRoutes } from "../telegram/scheduledRoutes";
import { installRuntimeConsoleLogging } from "../telegram/runtimeConsoleLog";
import { registerOwnerSiteRoutes } from "../ownerSite/routes";
import { registerOwnerAuthRoutes } from "../ownerSite/authRoutes";

async function startServer() {
  installRuntimeConsoleLogging();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerTelegramRoutes(app);
  registerTelegramScheduledRoutes(app);
  registerOwnerSiteRoutes(app);
  registerOwnerAuthRoutes(app);
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "kronos-guard" });
  });
  app.get("/docs", (_req, res) => res.redirect(302, "/docs/README.md"));
  void initializeServiceRuntime();
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT ?? "undefined"}`);
  }

  // pella.app routes public traffic to the platform-provided PORT.
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on 0.0.0.0:${port}/`);
  });
}

/** Boots the Telegram runtime independently from HTTP binding, keeping startup testable. */
export async function initializeServiceRuntime() {
  await startTelegramRuntime();
}

if (process.env.NODE_ENV !== "test") startServer().catch(console.error);
