-- SQLite baseline. Equivalent to MySQL migrations 001 through 042 after they
-- have all been applied. Later MySQL migrations need a sibling file here;
-- this runner does not translate the MySQL scripts.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  email_verified_at TEXT,
  password_hash TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  provider_account_id TEXT NOT NULL COLLATE NOCASE,
  email_at_provider TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_social_user ON social_accounts (user_id);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS pay_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT,
  salary_amount REAL NOT NULL,
  salary_txn_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('estimated', 'active', 'closed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_pay_periods_status ON pay_periods (status);
CREATE INDEX IF NOT EXISTS idx_pp_user_status ON pay_periods (user_id, status);

CREATE TABLE IF NOT EXISTS budget_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pay_period_id INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  amount REAL NOT NULL,
  budget_type TEXT NOT NULL DEFAULT 'spending' CHECK (budget_type IN ('spending', 'saving')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pay_period_id, name)
);

CREATE INDEX IF NOT EXISTS idx_budget_groups_period ON budget_groups (pay_period_id);
CREATE INDEX IF NOT EXISTS idx_bg_user_period ON budget_groups (user_id, pay_period_id);

CREATE TABLE IF NOT EXISTS budget_group_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_group_id INTEGER NOT NULL REFERENCES budget_groups(id) ON DELETE CASCADE,
  category TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (budget_group_id, category)
);

CREATE INDEX IF NOT EXISTS idx_budget_group_categories_group ON budget_group_categories (budget_group_id);

CREATE TABLE IF NOT EXISTS budget_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  groups_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('cash', 'bank', 'ewallet', 'other')),
  description TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  default_owner INTEGER GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN user_id ELSE NULL END) VIRTUAL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name),
  UNIQUE (default_owner)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  category TEXT NOT NULL,
  description TEXT,
  occurred_at TEXT NOT NULL,
  account TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions (occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions (type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions (category, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_currency_date ON transactions (currency, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_user_occurred ON transactions (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_account_occurred ON transactions (account_id, occurred_at);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  occurred_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_user_date ON transfers (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS account_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount <> 0),
  occurred_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adjustments_account_date ON account_adjustments (account_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_adjustments_user ON account_adjustments (user_id);

CREATE TRIGGER IF NOT EXISTS transactions_touch_updated_at
AFTER UPDATE ON transactions
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE transactions SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS users_touch_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS pay_periods_touch_updated_at
AFTER UPDATE ON pay_periods
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE pay_periods SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS budget_groups_touch_updated_at
AFTER UPDATE ON budget_groups
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE budget_groups SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS budget_templates_touch_updated_at
AFTER UPDATE ON budget_templates
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE budget_templates SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS accounts_touch_updated_at
AFTER UPDATE ON accounts
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE accounts SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS transfers_touch_updated_at
AFTER UPDATE ON transfers
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE transfers SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

INSERT INTO users (id, email, is_owner, status, display_name)
VALUES (1, 'owner@moneytor.local', 1, 'active', 'Owner')
ON CONFLICT(id) DO UPDATE SET is_owner = 1;
