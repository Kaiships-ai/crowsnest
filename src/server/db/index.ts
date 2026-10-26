import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { clockNow } from "@/server/lib/clock";
import * as schema from "./schema";

const dbPath = process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db";
if (dbPath !== ":memory:") mkdirSync(dbPath.substring(0, dbPath.lastIndexOf("/")) || ".", { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export const newId = () => randomUUID();
export const nowIso = () => clockNow().toISOString();
export * as tables from "./schema";
