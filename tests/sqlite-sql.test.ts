import { describe, expect, it } from "vitest";
import { adaptSql } from "../src/sqlite-sql.js";

describe("adaptSql", () => {
  it("leaves ordinary MySQL-compatible statements unchanged", () => {
    const sql = "SELECT name FROM categories WHERE user_id = ? ORDER BY name ASC";
    expect(adaptSql(sql)).toBe(sql);
  });

  it("rewrites insert ignore, upserts, dates, json, now, and row locks", () => {
    const budgetGroup = `INSERT INTO budget_groups (user_id, pay_period_id, name, amount, budget_type)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE amount = VALUES(amount), budget_type = VALUES(budget_type), updated_at = NOW()`;
    expect(adaptSql(budgetGroup)).toContain("ON CONFLICT(pay_period_id, name)");
    expect(adaptSql(budgetGroup)).not.toContain("ON DUPLICATE");

    const template = `INSERT INTO budget_templates (user_id, name, groups_json) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE groups_json = VALUES(groups_json), updated_at = NOW()`;
    expect(adaptSql(template)).toContain("ON CONFLICT(user_id, name)");

    expect(adaptSql("INSERT IGNORE INTO categories (user_id, name) VALUES (?, ?)")).toBe(
      "INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)"
    );
    expect(adaptSql("DATE_FORMAT(occurred_at, '%Y-%m-%d')")).toBe("strftime('%Y-%m-%d', occurred_at)");
    expect(adaptSql("DATE_FORMAT(occurred_at, '%Y-%m')")).toBe("strftime('%Y-%m', occurred_at)");
    expect(adaptSql("JSON_CONTAINS(tags_json, JSON_QUOTE(?), '$')")).toBe(
      "EXISTS (SELECT 1 FROM json_each(tags_json) WHERE json_each.value = ?)"
    );
    expect(adaptSql("UPDATE pay_periods SET updated_at = NOW() WHERE id = ?")).toBe(
      "UPDATE pay_periods SET updated_at = datetime('now') WHERE id = ?"
    );
    expect(adaptSql("SELECT id FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE")).toBe(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    );
  });
});
