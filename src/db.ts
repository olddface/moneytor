import mysql from "mysql2/promise";
import { config, type MysqlSettings } from "./config.js";

export interface DbConn {
  execute<T = unknown>(sql: string, params?: readonly unknown[]): Promise<[T, undefined]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface DbPool {
  execute<T = unknown>(sql: string, params?: readonly unknown[]): Promise<[T, undefined]>;
  getConnection(): Promise<DbConn>;
  end(): Promise<void>;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
}

function createMysqlPool(settings: MysqlSettings): DbPool {
  const pool = mysql.createPool({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    timezone: "Z"
  });

  return {
    execute<T = unknown>(sql: string, params?: readonly unknown[]): Promise<[T, undefined]> {
      return pool.execute(sql, params as never).then(([rows]) => [rows as T, undefined]);
    },
    async getConnection() {
      const conn = await pool.getConnection();
      return {
        execute<T = unknown>(sql: string, params?: readonly unknown[]): Promise<[T, undefined]> {
          return conn.execute(sql, params as never).then(([rows]) => [rows as T, undefined]);
        },
        beginTransaction: () => conn.beginTransaction(),
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        release: () => {
          conn.release();
        }
      };
    },
    end: () => pool.end()
  };
}

async function loadSqlite() {
  try {
    return await import("./sqlite.js");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DB_DRIVER=sqlite needs Node's built-in node:sqlite (Node.js 24, or Node.js 22 with --experimental-sqlite). ${detail}`
    );
  }
}

async function createSqlitePool(filePath: string): Promise<DbPool> {
  const { closeSqlite, executeSqlite, openSqlite } = await loadSqlite();
  const db = openSqlite(filePath);
  const mutex = new Mutex();

  return {
    async execute(sql, params) {
      const release = await mutex.acquire();
      try {
        return executeSqlite(db, sql, params);
      } finally {
        release();
      }
    },
    async getConnection() {
      const unlock = await mutex.acquire();
      let open = false;
      return {
        async execute(sql, params) {
          return executeSqlite(db, sql, params);
        },
        async beginTransaction() {
          db.exec("BEGIN IMMEDIATE");
          open = true;
        },
        async commit() {
          db.exec("COMMIT");
          open = false;
        },
        async rollback() {
          if (!open) return;
          db.exec("ROLLBACK");
          open = false;
        },
        release() {
          if (open) {
            try {
              db.exec("ROLLBACK");
            } catch {
              // The caller is already leaving this connection.
            }
            open = false;
          }
          unlock();
        }
      };
    },
    async end() {
      closeSqlite(db);
    }
  };
}

async function openPool(): Promise<DbPool> {
  if (config.driver === "sqlite") {
    return createSqlitePool(config.sqlitePath);
  }
  return createMysqlPool(config.mysql);
}

export const pool: DbPool = await openPool();
