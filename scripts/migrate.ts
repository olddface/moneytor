import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { config, type MysqlSettings } from "../src/config.js";

const migrationsDir = path.resolve("migrations");

if (config.driver === "sqlite") {
  await migrateSqlite(config.sqlitePath);
} else {
  await migrateMysql(config.mysql);
}

async function migrateMysql(settings: MysqlSettings): Promise<void> {
  const connection = await mysql.createConnection({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    multipleStatements: false
  });

  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT version FROM schema_migrations WHERE version = ? LIMIT 1",
        [file]
      );

      if (rows.length > 0) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);

      await connection.beginTransaction();
      try {
        for (const statement of statements) {
          await connection.query(statement);
        }
        await connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
        await connection.commit();
        console.log(`Applied ${file}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    await connection.end();
  }
}

async function migrateSqlite(filePath: string): Promise<void> {
  const { closeSqlite, openSqlite } = await import("../src/sqlite.js").catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DB_DRIVER=sqlite needs Node's built-in node:sqlite (Node.js 24, or Node.js 22 with --experimental-sqlite). ${detail}`
    );
  });
  const sqliteDir = path.join(migrationsDir, "sqlite");
  const db = openSqlite(filePath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = (await fs.readdir(sqliteDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const applied = db.prepare("SELECT version FROM schema_migrations WHERE version = ? LIMIT 1").get(file);
      if (applied) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(sqliteDir, file), "utf8");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
        db.exec("COMMIT");
        console.log(`Applied ${file}`);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    closeSqlite(db);
  }
}
