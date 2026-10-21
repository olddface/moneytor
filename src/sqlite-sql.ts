// MySQL statements in repository.ts, rewritten only when DB_DRIVER=sqlite.
// Keep the patterns aligned with those queries; MySQL still receives the original SQL.

const budgetGroupUpsert =
  /INSERT INTO budget_groups \(user_id, pay_period_id, name, amount, budget_type\)\s+VALUES \(\?, \?, \?, \?, \?\)\s+ON DUPLICATE KEY UPDATE amount = VALUES\(amount\), budget_type = VALUES\(budget_type\), updated_at = NOW\(\)/g;

const budgetTemplateUpsert =
  /INSERT INTO budget_templates \(user_id, name, groups_json\) VALUES \(\?, \?, \?\)\s+ON DUPLICATE KEY UPDATE groups_json = VALUES\(groups_json\), updated_at = NOW\(\)/g;

export function adaptSql(sql: string): string {
  let out = sql.replace(
    budgetGroupUpsert,
    `INSERT INTO budget_groups (user_id, pay_period_id, name, amount, budget_type)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(pay_period_id, name) DO UPDATE SET amount = excluded.amount, budget_type = excluded.budget_type, updated_at = datetime('now')`
  );
  out = out.replace(
    budgetTemplateUpsert,
    `INSERT INTO budget_templates (user_id, name, groups_json) VALUES (?, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET groups_json = excluded.groups_json, updated_at = datetime('now')`
  );
  out = out.replaceAll("INSERT IGNORE INTO", "INSERT OR IGNORE INTO");
  out = out.replaceAll("DATE_FORMAT(occurred_at, '%Y-%m-%d')", "strftime('%Y-%m-%d', occurred_at)");
  out = out.replaceAll("DATE_FORMAT(occurred_at, '%Y-%m')", "strftime('%Y-%m', occurred_at)");
  out = out.replaceAll(
    "JSON_CONTAINS(tags_json, JSON_QUOTE(?), '$')",
    "EXISTS (SELECT 1 FROM json_each(tags_json) WHERE json_each.value = ?)"
  );
  out = out.replace(/\bNOW\(\)/g, "datetime('now')");
  out = out.replace(/\s+FOR\s+UPDATE\b/gi, "");
  return out;
}
