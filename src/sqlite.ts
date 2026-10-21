import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { adaptSql } from "./sqlite-sql.js";

export function openSqlite(filePath: string): DatabaseSync {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function closeSqlite(db: DatabaseSync): void {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Already closed, or the file was opened read-only.
  }
  db.close();
}

export function executeSqlite<T>(db: DatabaseSync, sql: string, params?: readonly unknown[]): [T, undefined] {
  const adapted = adaptSql(sql);
  try {
    const stmt = db.prepare(adapted);
    const values = (params ?? []).map((value) => (value === undefined ? null : value)) as SQLInputValue[];
    const verb = adapted.trim().match(/^[a-zA-Z]+/)?.[0]?.toUpperCase() ?? "";
    if (verb === "SELECT" || verb === "WITH" || verb === "PRAGMA") {
      return [stmt.all(...values) as T, undefined];
    }
    const info = stmt.run(...values);
    return [{ insertId: Number(info.lastInsertRowid), affectedRows: Number(info.changes) } as T, undefined];
  } catch (error) {
    if (error instanceof Error && !error.message.includes("\nSQL:")) {
      error.message = `${error.message}\nSQL: ${adapted}`;
    }
    throw error;
  }
}
