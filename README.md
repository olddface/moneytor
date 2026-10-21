# Moneytor MCP

Remote MCP server for tracking personal income and expenses from Claude.ai/gemini/and others. It exposes tools to add, list, update, delete, and summarize transactions stored in MySQL or SQLite.

## Requirements

- Node.js 20+ for MySQL. SQLite mode needs Node.js 24, or Node.js 22 with `--experimental-sqlite` (built-in `node:sqlite`).
- MySQL 5.7+ or 8+, or a local SQLite file
- Public HTTPS endpoint on your VPS
- Reverse proxy such as Nginx or Caddy

Remote clients such as Claude.ai, Gemini, and other AI apps need a reachable remote MCP endpoint. Local stdio MCP servers are for local clients, not those web connectors.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `DB_DRIVER`: `mysql` (default) or `sqlite`.
- `MYSQL_*`: MySQL connection for the `moneytor` database. Required when `DB_DRIVER=mysql`.
- `SQLITE_PATH`: SQLite file used when `DB_DRIVER=sqlite`. Defaults to `data/moneytor.sqlite`.
- `DEFAULT_CURRENCY`: default transaction currency, for example `IDR`.
- `MCP_SECRET_SLUG`: long random path segment for the MCP URL.
- `ALLOWED_CIDRS`: optional app-level IP allowlist. Keep `127.0.0.1/32` while testing locally.

For SQLite, set the driver and run migrate. `npm run migrate` creates the file and applies `migrations/sqlite`. Those scripts are the current schema; they are not translations of the MySQL files in `migrations/`.

```bash
# .env
DB_DRIVER=sqlite
SQLITE_PATH=./data/moneytor.sqlite
```

Create the MySQL database and user when `DB_DRIVER=mysql`. Then, for either driver, run:

```bash
npm run migrate
npm run build
npm start
```

The MCP endpoint is:

```text
https://your-domain.example/mcp/<MCP_SECRET_SLUG>
```

Minimal MySQL bootstrap:

```sql
CREATE DATABASE moneytor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'moneytor'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON moneytor.* TO 'moneytor'@'localhost';
FLUSH PRIVILEGES;
```

## Tools

- `add_transaction`: records one `income` or `expense` using `DEFAULT_CURRENCY`.
- `list_transactions`: fetches rows by date range, type, category, account, tag, limit, and offset.
- `get_finance_summary`: returns totals and breakdowns by category, account, and day/month.
- `update_transaction`: corrects an existing transaction.
- `delete_transaction`: deletes a mistaken transaction by `id`.

## Nginx Example

Prefer enforcing the Anthropic allowlist at the reverse proxy. Keep your own IP temporarily while testing.

```nginx
server {
  listen 443 ssl http2;
  server_name moneytor.example.com;

  ssl_certificate /etc/letsencrypt/live/moneytor.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/moneytor.example.com/privkey.pem;

  location /mcp/ {
    allow 160.79.104.0/21;
    deny all;

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /health {
    proxy_pass http://127.0.0.1:3000;
  }
}
```

## systemd Example

```ini
[Unit]
Description=Moneytor MCP
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/moneytor
EnvironmentFile=/opt/moneytor/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=moneytor
Group=moneytor

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now moneytor-mcp
sudo systemctl status moneytor-mcp
```

## Claude.ai Connector

In Claude.ai, add a custom connector with:

- Name: `Moneytor`
- URL: `https://your-domain.example/mcp/<MCP_SECRET_SLUG>`
- Authentication: no authentication

This project uses an authless connector because Claude.ai custom connectors do not support pasted static bearer tokens. Security comes from HTTPS, the secret endpoint path, and reverse-proxy IP allowlisting.
