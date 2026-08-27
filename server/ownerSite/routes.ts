import type { Express, Request, Response } from "express";
import { and, asc, eq, gt } from "drizzle-orm";
import { getOwnerSiteSession } from "./auth";
import { getDb } from "../db";
import { auditLogs } from "../../drizzle/schema";

export function registerOwnerSiteRoutes(app: Express) {
  app.get("/api/owner-site/log-stream", async (req: Request, res: Response) => {
    const session = await getOwnerSiteSession(req);
    if (!session) {
      res.status(403).json({ error: "owner_only" });
      return;
    }
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
    let cursor = Number(req.query.after ?? 0);
    let closed = false;
    const send = (event: string, data: unknown) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const poll = async () => {
      const db = await getDb();
      if (!db || closed) return;
      const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.category, "runtime_console"), gt(auditLogs.id, cursor))).orderBy(asc(auditLogs.id)).limit(100);
      for (const row of rows) { cursor = row.id; send("log", row); }
    };
    const timer = setInterval(() => { void poll().catch(error => send("error", { message: error instanceof Error ? error.message : "stream_error" })); }, 2000);
    void poll().catch(error => send("error", { message: error instanceof Error ? error.message : "stream_error" }));
    req.on("close", () => { closed = true; clearInterval(timer); res.end(); });
  });
}
