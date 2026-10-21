import dotenv from "dotenv";

dotenv.config();

export type MysqlSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type BaseConfig = {
  port: number;
  defaultCurrency: string;
  mcpSecretSlug: string;
  allowedCidrs: string[];
  trustProxy: boolean;
};

export type Config = BaseConfig & (
  | { driver: "mysql"; mysql: MysqlSettings }
  | { driver: "sqlite"; sqlitePath: string }
);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function optionalCsv(name: string): string[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function databaseDriver(): Config["driver"] {
  const value = (process.env.DB_DRIVER || "mysql").trim().toLowerCase();
  if (value === "mysql" || value === "sqlite") {
    return value;
  }
  throw new Error("DB_DRIVER must be mysql or sqlite");
}

function mysqlSettings(): MysqlSettings {
  return {
    host: required("MYSQL_HOST"),
    port: optionalNumber("MYSQL_PORT", 3306),
    user: required("MYSQL_USER"),
    password: required("MYSQL_PASSWORD"),
    database: required("MYSQL_DATABASE")
  };
}

function sqlitePath(): string {
  const value = process.env.SQLITE_PATH?.trim();
  return value ? value : "data/moneytor.sqlite";
}

const baseConfig: BaseConfig = {
  port: optionalNumber("PORT", 3000),
  defaultCurrency: normalizeCurrency(process.env.DEFAULT_CURRENCY || "IDR"),
  mcpSecretSlug: required("MCP_SECRET_SLUG"),
  allowedCidrs: optionalCsv("ALLOWED_CIDRS"),
  trustProxy: optionalBoolean("TRUST_PROXY", true)
};

const driver = databaseDriver();

export const config: Config = driver === "sqlite"
  ? { ...baseConfig, driver, sqlitePath: sqlitePath() }
  : { ...baseConfig, driver, mysql: mysqlSettings() };

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("DEFAULT_CURRENCY must be a 3-letter ISO currency code");
  }

  return normalized;
}
