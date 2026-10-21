import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const previousDriver = process.env.DB_DRIVER;
const previousSqlitePath = process.env.SQLITE_PATH;
const previousSlug = process.env.MCP_SECRET_SLUG;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moneytor-sqlite-"));
const dbPath = path.join(dir, "moneytor.sqlite");
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_PATH = dbPath;
process.env.MCP_SECRET_SLUG ||= "sqlite-test-slug";

describe("sqlite driver", () => {
  let repo: typeof import("../src/repository.js");

  beforeAll(async () => {
    await import("../scripts/migrate.js");
    repo = await import("../src/repository.js");
  });

  beforeEach(async () => {
    const { pool } = await import("../src/db.js");
    const statements = [
      "DELETE FROM account_adjustments WHERE user_id = ?",
      "DELETE FROM transfers WHERE user_id = ?",
      "DELETE FROM transactions WHERE user_id = ?",
      "DELETE FROM budget_groups WHERE user_id = ?",
      "DELETE FROM budget_templates WHERE user_id = ?",
      "DELETE FROM pay_periods WHERE user_id = ?",
      "DELETE FROM categories WHERE user_id = ?",
      "DELETE FROM accounts WHERE user_id = ?"
    ];
    for (const sql of statements) {
      await pool.execute(sql, [1]);
    }
  });

  afterAll(async () => {
    await repo?.closePool();
    fs.rmSync(dir, { recursive: true, force: true });
    restore("DB_DRIVER", previousDriver);
    restore("SQLITE_PATH", previousSqlitePath);
    restore("MCP_SECRET_SLUG", previousSlug);
  });

  it("migrates the owner and ignores a duplicate category", async () => {
    await repo.addCategory(1, "Makan");
    await repo.addCategory(1, "makan");
    expect(await repo.listCategories(1)).toEqual(["Makan"]);
  });

  it("records a transaction, filters by tag, and buckets by month", async () => {
    await repo.addCategory(1, "Makan");
    const saved = await repo.addTransaction(1, {
      type: "expense",
      amount: 25000,
      category: "Makan",
      date: "2026-10-21",
      tags: ["kopi"],
      description: "pagi"
    });

    expect(saved.id).toBeGreaterThan(0);
    expect(await repo.listTransactions(1, { tag: "kopi" })).toHaveLength(1);
    expect(await repo.listTransactions(1, { tag: "lain" })).toHaveLength(0);

    const summary = await repo.getFinanceSummary(1, { period: "month", start_date: "2026-10-01", end_date: "2026-10-31" });
    expect(summary.totals.expense).toBe(25000);
    expect(summary.by_period.map((row) => row.period)).toEqual(["2026-10"]);
    expect(summary.by_account[0]).toMatchObject({ account: "uncategorized", total: 25000 });

    const day = await repo.getAverages(1, { period: "day", start_date: "2026-10-01", end_date: "2026-10-31" });
    expect(day.by_period[0]?.period).toBe("2026-10-21");
  });

  it("upserts budget groups and templates", async () => {
    const period = await repo.createPayPeriod(1, { period_start: "2026-10-01", salary_amount: 5000000 });
    await repo.setBudgetGroup(1, period.id, { name: "Makan", amount: 100, budget_type: "spending", categories: ["Makan"] });
    await repo.setBudgetGroup(1, period.id, { name: "makan", amount: 250, budget_type: "saving", categories: ["Makan", "Kopi"] });
    const groups = await repo.getBudgetGroups(1, period.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ amount: 250, budget_type: "saving", categories: ["Kopi", "Makan"] });

    await repo.saveBudgetTemplate(1, "Default", [{ name: "Makan", amount: 100, categories: ["Makan"] }]);
    await repo.saveBudgetTemplate(1, "default", [{ name: "Transport", amount: 80, categories: ["Transport"] }]);
    const templates = await repo.listBudgetTemplates(1);
    expect(templates).toHaveLength(1);
    expect(templates[0]?.groups[0]?.name).toBe("Transport");
  });

  it("keeps one default account, rejects case-variant names, and moves money", async () => {
    await repo.addAccount(1, { name: "Tunai", type: "cash", opening_balance: 0 });
    await repo.addAccount(1, { name: "BCA", type: "bank" });
    await expect(repo.addAccount(1, { name: "tunai", type: "cash" })).rejects.toThrow(/already exists/);

    await repo.addTransaction(1, { type: "income", amount: 1000, category: "Gaji", date: "2026-10-21", account: "Tunai" });
    await repo.transferBetweenAccounts(1, { from: "Tunai", to: "BCA", amount: 200, date: "2026-10-21" });
    const reconciled = await repo.reconcileAccount(1, "Tunai", 900, "cash count");

    const accounts = await repo.listAccounts(1);
    expect(accounts.map((account) => [account.name, account.is_default, account.balance])).toEqual([
      ["Tunai", true, 900],
      ["BCA", false, 200]
    ]);
    expect(reconciled).toMatchObject({ difference: 100, balance_before: 800, balance_after: 900 });
    expect(reconciled.adjustment_id).toBeGreaterThan(0);
  });
});

function restore(name: "DB_DRIVER" | "SQLITE_PATH" | "MCP_SECRET_SLUG", previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
